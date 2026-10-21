import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type { Activities } from "./activities.ts";
import { EVENT_SIGNAL, type StreamEvent, type StreamWorkflowInput } from "./shared.ts";

const { processEvent } = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: { initialInterval: "1 second", maximumInterval: "1 minute" },
});

export const eventSignal = defineSignal<[StreamEvent]>(EVENT_SIGNAL);

/** 没有新事件多久之后结束；下一个事件到来时中继会用 signalWithStart 重新启动。 */
const IDLE_TIMEOUT = "1 hour";
/** 处理这么多事件后换一个新的运行，控制单次运行的历史长度。 */
const EVENTS_PER_RUN = 500;

/**
 * 一个事件流（一个工作项或一个空间）对应一个长期运行的 workflow，按 event_log 的顺序逐条处理事件。
 * 同一个工作项上的流程推进和自动化因此天然串行，不会互相踩。
 */
export async function streamWorkflow(input: StreamWorkflowInput): Promise<void> {
  const pending = [...input.pending];
  // 中继按 id 顺序投递同一个 stream 的事件，所以不大于已收到最大 id 的信号都是重复投递
  let lastSeenEventId = input.lastSeenEventId;

  setHandler(eventSignal, (event) => {
    if (event.eventId <= lastSeenEventId) return;
    lastSeenEventId = event.eventId;
    pending.push(event);
  });

  for (let processed = 0; ; ) {
    if (!(await condition(() => pending.length > 0, IDLE_TIMEOUT))) return;
    const next = pending.shift() as StreamEvent;
    await processEvent(next.eventId);
    processed++;

    if (processed >= EVENTS_PER_RUN || workflowInfo().continueAsNewSuggested) {
      await condition(allHandlersFinished);
      await continueAsNew<typeof streamWorkflow>({ stream: input.stream, lastSeenEventId, pending });
    }
  }
}
