import { type Database, OUTBOX_CHANNEL, schema } from "@fp/db";
import type { Client } from "@temporalio/client";
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  EVENT_SIGNAL,
  STREAM_WORKFLOW,
  type StreamEvent,
  type StreamWorkflowInput,
  streamWorkflowId,
} from "./shared.ts";

/** 同一时刻只允许一个中继在投递，否则同一个 stream 的事件可能乱序。值是任意固定数字。 */
const LEADER_LOCK_KEY = 7_281_001;

export interface RelayOptions {
  taskQueue: string;
  batchSize?: number;
  /** 没有收到 NOTIFY 时多久轮询一次，兜底用。 */
  pollIntervalMs?: number;
  log?: (message: string) => void;
}

type OutboxRow = typeof schema.outbox.$inferSelect;

/**
 * Outbox 中继：把 infra.outbox 里未投递的事件按 id 顺序用 signalWithStart 交给对应 stream 的 workflow。
 *
 * 保证：
 * - 不丢：先投递成功再标记 dispatched_at，进程崩溃后重启会重新投递。
 * - 同一个 stream 不乱序：单个领导者投递；某个 stream 投递失败时，本轮跳过它后面的所有事件。
 * - 重复投递无害：workflow 按事件 id 去重，activity 本身也要可重试。
 */
export class OutboxRelay {
  private readonly database: Database;
  private readonly client: Client;
  private readonly taskQueue: string;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly log: (message: string) => void;
  private wake: (() => void) | null = null;
  /** 投递过程中收到的 NOTIFY，下一次 sleep 直接返回。 */
  private notified = false;

  constructor(database: Database, client: Client, options: RelayOptions) {
    this.database = database;
    this.client = client;
    this.taskQueue = options.taskQueue;
    this.batchSize = options.batchSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.log = options.log ?? console.log;
  }

  /** 投递一批，返回成功投递的条数。 */
  async dispatchBatch(): Promise<number> {
    const { db } = this.database;
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(isNull(schema.outbox.dispatchedAt))
      .orderBy(asc(schema.outbox.id))
      .limit(this.batchSize);

    const byStream = new Map<string, OutboxRow[]>();
    for (const row of rows) byStream.set(row.stream, [...(byStream.get(row.stream) ?? []), row]);
    const results = await Promise.all([...byStream.values()].map((streamRows) => this.dispatchStream(streamRows)));
    return results.reduce((a, b) => a + b, 0);
  }

  private async dispatchStream(rows: OutboxRow[]): Promise<number> {
    const { db } = this.database;
    const done: number[] = [];
    for (const row of rows) {
      try {
        await this.signal(row);
        done.push(row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(schema.outbox)
          .set({ attempts: sql`${schema.outbox.attempts} + 1`, lastError: message })
          .where(eq(schema.outbox.id, row.id));
        this.log(`投递 outbox ${row.id}（${row.stream}）失败：${message}`);
        break;
      }
    }
    if (done.length > 0)
      await db.update(schema.outbox).set({ dispatchedAt: new Date() }).where(inArray(schema.outbox.id, done));
    return done.length;
  }

  private async signal(row: OutboxRow): Promise<void> {
    const start: StreamWorkflowInput = { stream: row.stream, lastSeenEventId: 0, pending: [] };
    const event: StreamEvent = { eventId: row.eventId };
    await this.client.workflow.signalWithStart(STREAM_WORKFLOW, {
      workflowId: streamWorkflowId(row.stream),
      taskQueue: this.taskQueue,
      args: [start],
      signal: EVENT_SIGNAL,
      signalArgs: [event],
    });
  }

  /** 持续运行直到 signal 被中止：抢领导者锁，然后在 NOTIFY 或轮询到期时投递。 */
  async run(signal: AbortSignal): Promise<void> {
    const leader = await this.database.sql.reserve();
    try {
      while (!signal.aborted) {
        const [row] = await leader`select pg_try_advisory_lock(${LEADER_LOCK_KEY}) as locked`;
        if (row?.locked) break;
        await this.sleep(this.pollIntervalMs, signal);
      }
      if (signal.aborted) return;
      this.log("Outbox 中继已成为领导者，开始投递。");

      const listener = await this.database.sql.listen(OUTBOX_CHANNEL, () => {
        this.notified = true;
        this.wake?.();
      });
      try {
        while (!signal.aborted) {
          let dispatched = 0;
          this.notified = false;
          try {
            dispatched = await this.dispatchBatch();
          } catch (error) {
            this.log(`Outbox 中继出错：${error instanceof Error ? error.message : String(error)}`);
          }
          if (dispatched < this.batchSize) await this.sleep(this.pollIntervalMs, signal);
        }
      } finally {
        await listener.unlisten();
      }
    } finally {
      await leader`select pg_advisory_unlock_all()`;
      leader.release();
    }
  }

  /** 等到超时、NOTIFY 或中止，三者谁先到都返回。 */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (this.notified || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
      this.wake = done;
    });
  }
}
