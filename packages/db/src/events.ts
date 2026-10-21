import { sql } from "drizzle-orm";
import type { Tx } from "./client.ts";
import { eventLog, outbox } from "./schema.ts";

/** 中继程序 LISTEN 的频道。事务提交时才会真正发出通知。 */
export const OUTBOX_CHANNEL = "fp_outbox";

export interface NewEvent {
  spaceId: string;
  workItemId?: string | null;
  kind: string;
  payload: Record<string, unknown>;
  actor?: string | null;
  causedBy?: number | null;
}

/** 事件归属的处理流：有工作项按工作项，否则按空间。同一个流的事件严格按顺序处理。 */
export function streamOf(event: Pick<NewEvent, "spaceId" | "workItemId">): string {
  return event.workItemId ? `work_item:${event.workItemId}` : `space:${event.spaceId}`;
}

/**
 * 在调用方的事务里追加事件：写 event_log、写 outbox、通知中继。
 * 业务修改和事件要么一起提交，要么一起回滚，事件不会丢也不会多。
 */
export async function appendEvents(tx: Tx, events: NewEvent[]): Promise<number[]> {
  if (events.length === 0) return [];
  const rows = await tx
    .insert(eventLog)
    .values(
      events.map((e) => ({
        spaceId: e.spaceId,
        workItemId: e.workItemId ?? null,
        kind: e.kind,
        payload: e.payload,
        fieldKey: e.kind === "fieldChanged" && typeof e.payload.fieldKey === "string" ? e.payload.fieldKey : null,
        actor: e.actor ?? null,
        causedBy: e.causedBy ?? null,
      })),
    )
    .returning({ id: eventLog.id });
  const ids = rows.map((r) => r.id);
  await tx.insert(outbox).values(events.map((e, i) => ({ eventId: ids[i] as number, stream: streamOf(e) })));
  await tx.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, '')`);
  return ids;
}
