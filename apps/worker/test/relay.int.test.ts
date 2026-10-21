import { randomUUID } from "node:crypto";
import { appendEvents, connect, type Database, schema } from "@fp/db";
import { createTestDatabase } from "@fp/db/testing";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { createActivities } from "../src/activities.ts";
import { OutboxRelay } from "../src/relay.ts";
import { streamWorkflowId } from "../src/shared.ts";
import { workflowsPath } from "../src/worker.ts";

const temporalAddress = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
// workflow id 由工作项 id 决定，每次运行用不同的工作项，避免撞上上一次测试留在 Temporal 里的 workflow
const run = randomUUID().slice(0, 8);
const w1Id = `w1-${run}`;
const w2Id = `w2-${run}`;

let database: Database;
let connection: Connection;
let client: Client;

beforeAll(async () => {
  database = connect(await createTestDatabase("fp_test_worker"));
  connection = await Connection.connect({ address: temporalAddress });
  client = new Client({ connection });
  await database.db.insert(schema.user).values({ id: "u1", name: "Pascal", email: "pascal@example.com" });
  await database.db.insert(schema.space).values({ id: "s1", name: "oemtest" });
  await database.db.insert(schema.workItemType).values({ id: "t1", spaceId: "s1", key: "project", name: "项目" });
  for (const id of [w1Id, w2Id])
    await database.db.insert(schema.workItem).values({ id, spaceId: "s1", typeId: "t1", name: id, createdBy: "u1" });
  await database.db.insert(schema.automationRule).values({
    id: "r1",
    spaceId: "s1",
    name: "需求评审进行中时建评审管理",
    trigger: { kind: "nodeStarted" },
    actions: [],
  });
});

afterAll(async () => {
  await connection?.close();
  await database?.close();
});

async function append(workItemId: string, kind: string): Promise<number> {
  const [id] = await database.db.transaction((tx) =>
    appendEvents(tx, [{ spaceId: "s1", workItemId, kind, payload: {} }]),
  );
  return id as number;
}

describe("outbox relay → Temporal", () => {
  it("delivers each stream's events in order to one workflow, exactly once", async () => {
    const taskQueue = `test-${randomUUID()}`;
    const processed: { eventId: number; matchedRuleIds: string[] }[] = [];
    const activities = createActivities(database);
    const nativeConnection = await NativeConnection.connect({ address: temporalAddress });
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath,
      activities: {
        async processEvent(eventId: number) {
          const result = await activities.processEvent(eventId);
          processed.push(result);
          return result;
        },
      },
    });

    const relay = new OutboxRelay(database, client, { taskQueue, log: () => {} });
    const w1 = [await append(w1Id, "nodeStarted"), await append(w1Id, "fieldChanged")];
    const w2 = [await append(w2Id, "nodeStarted")];
    w1.push(await append(w1Id, "nodeCompleted"));

    const handles = [w1Id, w2Id].map((id) => client.workflow.getHandle(streamWorkflowId(`work_item:${id}`)));
    onTestFinished(() => Promise.all(handles.map((h) => h.terminate("test done").catch(() => {}))).then(() => {}));

    await worker.runUntil(async () => {
      expect(await relay.dispatchBatch()).toBe(4);

      // 模拟中继在标记 dispatched 之前崩溃：同一条事件被再投递一次，workflow 必须丢弃它
      await database.db
        .update(schema.outbox)
        .set({ dispatchedAt: null })
        .where(eq(schema.outbox.eventId, w1[0] as number));
      expect(await relay.dispatchBatch()).toBe(1);

      await expect.poll(() => processed.length, { timeout: 30_000 }).toBe(4);
      // 给重复信号留出被处理的时间，确认它没有触发第五次处理
      await new Promise((r) => setTimeout(r, 1000));
    });
    await nativeConnection.close();

    expect(processed.map((p) => p.eventId).filter((id) => w1.includes(id))).toEqual(w1);
    expect(processed.map((p) => p.eventId).filter((id) => w2.includes(id))).toEqual(w2);
    expect(processed).toHaveLength(4);
    expect(processed.find((p) => p.eventId === w2[0])?.matchedRuleIds).toEqual(["r1"]);
    expect(await database.db.$count(schema.outbox, isNull(schema.outbox.dispatchedAt))).toBe(0);

    expect((await handles[0]?.describe())?.status.name).toBe("RUNNING");
  });

  it("keeps a failed event and everything after it in the same stream for the next round", async () => {
    await database.db.update(schema.outbox).set({ dispatchedAt: new Date() });
    const a1 = await append(w1Id, "a1");
    const a2 = await append(w1Id, "a2");
    const b1 = await append(w2Id, "b1");

    const signalled: string[] = [];
    const flaky = {
      workflow: {
        async signalWithStart(_: string, options: { workflowId: string; signalArgs: [{ eventId: number }] }) {
          const { eventId } = options.signalArgs[0];
          if (eventId === a1) throw new Error("Temporal 不可用");
          signalled.push(`${options.workflowId}#${eventId}`);
        },
      },
    } as unknown as Client;

    const relay = new OutboxRelay(database, flaky, { taskQueue: "unused", log: () => {} });
    expect(await relay.dispatchBatch()).toBe(1);
    expect(signalled).toEqual([`stream:work_item:${w2Id}#${b1}`]);

    const pending = await database.db
      .select()
      .from(schema.outbox)
      .where(isNull(schema.outbox.dispatchedAt))
      .orderBy(schema.outbox.id);
    expect(pending.map((r) => [r.eventId, r.attempts, r.lastError])).toEqual([
      [a1, 1, "Temporal 不可用"],
      [a2, 0, null],
    ]);
  });
});
