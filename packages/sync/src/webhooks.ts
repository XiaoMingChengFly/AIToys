import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { assertAdmin } from "./templates.ts";

/** 可以单独订阅的事件，键是事件类型。不选表示全部事件（包括这里没列的）。 */
export const WEBHOOK_EVENTS = {
  workItemCreated: "创建工作项",
  workItemCompleted: "工作项完成",
  workItemReopened: "工作项重新打开",
  nodeStarted: "节点开始",
  nodeCompleted: "节点完成",
  nodeRolledBack: "节点回滚",
  statusChanged: "状态流转",
  stageChanged: "阶段变化",
  fieldChanged: "字段修改",
  roleChanged: "角色人员变化",
  commentAdded: "发表评论",
  attachmentAdded: "上传附件",
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

const url = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, "请填写 http 或 https 开头的地址。");

const events = z
  .array(z.enum(Object.keys(WEBHOOK_EVENTS) as [WebhookEvent, ...WebhookEvent[]]))
  .max(50)
  .optional()
  .describe("为空表示全部事件");

/** 签名密钥由创建它的管理员在浏览器里随机生成。 */
const secret = z.string().min(32).max(128);

export const createWebhookArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string().trim().min(1).max(60),
  url,
  secret,
  events,
});
export const updateWebhookArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(60).optional(),
  url: url.optional(),
  events,
  enabled: z.boolean().optional(),
  /** 换一个新的签名密钥。 */
  secret: secret.optional(),
});
export const deleteWebhookArgs = z.object({ id: z.string() });

async function adminWebhook(tx: Transaction, id: string, userID: string) {
  const hook = await tx.run(zql.webhook.where("id", id).one());
  if (!hook) throw new Error("Webhook 不存在。");
  await assertAdmin(tx, hook.spaceId, userID);
  return hook;
}

const eventList = (list: readonly string[] | undefined) => (list?.length ? [...new Set(list)] : null);

/** 新建 Webhook。只有空间管理员可以。 */
export async function createWebhook(tx: Transaction, args: z.output<typeof createWebhookArgs>, userID: string) {
  await assertAdmin(tx, args.spaceId, userID);
  await tx.mutate.webhook.insert({
    id: args.id,
    spaceId: args.spaceId,
    name: args.name,
    url: args.url,
    secret: args.secret,
    events: eventList(args.events),
    enabled: true,
    createdBy: userID,
    createdAt: Date.now(),
  });
}

/** 修改 Webhook：名称、地址、订阅的事件、启用状态、签名密钥。只影响之后的事件。 */
export async function updateWebhook(tx: Transaction, args: z.output<typeof updateWebhookArgs>, userID: string) {
  await adminWebhook(tx, args.id, userID);
  await tx.mutate.webhook.update({
    id: args.id,
    ...(args.name !== undefined && { name: args.name }),
    ...(args.url !== undefined && { url: args.url }),
    ...(args.events !== undefined && { events: eventList(args.events) }),
    ...(args.enabled !== undefined && { enabled: args.enabled }),
    ...(args.secret !== undefined && { secret: args.secret }),
  });
}

/** 删除 Webhook 和它的推送记录。还在重试的推送发现它不在了就会停下。 */
export async function deleteWebhook(tx: Transaction, args: z.output<typeof deleteWebhookArgs>, userID: string) {
  await adminWebhook(tx, args.id, userID);
  for (const delivery of await tx.run(zql.webhookDelivery.where("webhookId", args.id)))
    await tx.mutate.webhookDelivery.delete({ id: delivery.id });
  await tx.mutate.webhook.delete({ id: args.id });
}
