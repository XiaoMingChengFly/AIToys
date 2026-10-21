import type { FlowDefinition, NodeState, WorkItemStatus } from "@fp/engine";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/**
 * 所有 id 都是客户端生成的文本 id（uuid v7），这样 Zero 可以先在本地乐观写入再同步。
 * 时间统一 timestamptz；Zero 端按毫秒数读取。
 */
const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

// ───────────── 登录（Better Auth 的核心表） ─────────────

export const user = pgTable("user", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable("session", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = pgTable("account", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable("verification", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────── 配置层：一类工作项长什么样、怎么流转 ─────────────

export const space = pgTable("space", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  createdAt: createdAt(),
});

export const spaceMember = pgTable(
  "space_member",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    isAdmin: boolean("is_admin").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

export const workItemType = pgTable(
  "work_item_type",
  {
    id: id(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** node = 节点流，state = 状态流 */
    flowMode: text("flow_mode").$type<"node" | "state">().notNull().default("node"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex().on(t.spaceId, t.key)],
);

export type FieldDataType =
  | "text"
  | "number"
  | "bool"
  | "date"
  | "select"
  | "multiSelect"
  | "user"
  | "link"
  | "relation"
  | "formula";

export const fieldDef = pgTable(
  "field_def",
  {
    id: id(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    dataType: text("data_type").$type<FieldDataType>().notNull(),
    options: jsonb("options").$type<{ value: string; label: string; color?: string }[]>(),
    /** 非空即公式字段 */
    formula: text("formula"),
    required: boolean("required").notNull().default(false),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex().on(t.typeId, t.key)],
);

export const roleDef = pgTable(
  "role_def",
  {
    id: id(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** 角色继承：从哪个关联字段指向的工作项的哪个角色复制成员 */
    inherit: jsonb("inherit").$type<{ relationFieldKey: string; parentRoleKey: string } | null>(),
  },
  (t) => [uniqueIndex().on(t.typeId, t.key)],
);

export const relationDef = pgTable("relation_def", {
  id: id(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  fromTypeId: text("from_type_id")
    .notNull()
    .references(() => workItemType.id, { onDelete: "cascade" }),
  toTypeId: text("to_type_id")
    .notNull()
    .references(() => workItemType.id, { onDelete: "cascade" }),
  /** 关联在“从”这一侧显示成哪个字段，如 评审管理.关联项目 */
  fieldKey: text("field_key").notNull(),
  name: text("name").notNull(),
  cardinality: text("cardinality").$type<"one" | "many">().notNull().default("one"),
});

export const flowTemplate = pgTable("flow_template", {
  id: id(),
  typeId: text("type_id")
    .notNull()
    .references(() => workItemType.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  /** 新建工作项默认用的版本 */
  currentVersionId: text("current_version_id"),
  createdAt: createdAt(),
});

/** 流程模板的不可变快照。发布后不改，改动只能发新版本。 */
export const flowVersion = pgTable(
  "flow_version",
  {
    id: id(),
    templateId: text("template_id")
      .notNull()
      .references(() => flowTemplate.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<FlowDefinition>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => user.id),
  },
  (t) => [uniqueIndex().on(t.templateId, t.version)],
);

export const automationRule = pgTable("automation_rule", {
  id: id(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** 触发器、条件、动作，结构见 packages/engine 的自动化定义 */
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────── 实例层：某个工作项现在走到哪了 ─────────────

export const workItem = pgTable(
  "work_item",
  {
    id: id(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    flowVersionId: text("flow_version_id").references(() => flowVersion.id),
    name: text("name").notNull(),
    stage: text("stage"),
    status: text("status").$type<WorkItemStatus | "terminated">().notNull().default("inProgress"),
    /** 字段值，按字段键索引；公式字段的结果也缓存在这里 */
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.spaceId, t.typeId), index().on(t.status)],
);

export const roleMember = pgTable(
  "role_member",
  {
    id: id(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** manual = 手动指定；inherited = 角色继承来的，随父工作项变化 */
    source: text("source").$type<"manual" | "inherited">().notNull().default("manual"),
  },
  (t) => [uniqueIndex().on(t.workItemId, t.roleKey, t.userId)],
);

export const relation = pgTable(
  "relation",
  {
    id: id(),
    defId: text("def_id")
      .notNull()
      .references(() => relationDef.id, { onDelete: "cascade" }),
    fromId: text("from_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
  },
  (t) => [index().on(t.fromId), index().on(t.toId)],
);

export const nodeInstance = pgTable(
  "node_instance",
  {
    id: id(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    state: text("state").$type<NodeState>().notNull().default("notStarted"),
    owners: jsonb("owners").$type<string[]>().notNull().default([]),
    confirmations: jsonb("confirmations").$type<string[]>().notNull().default([]),
    plannedStart: timestamp("planned_start", { withTimezone: true }),
    plannedEnd: timestamp("planned_end", { withTimezone: true }),
    actualStart: timestamp("actual_start", { withTimezone: true }),
    actualEnd: timestamp("actual_end", { withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.workItemId, t.nodeKey)],
);

// ───────────── 事件：审计、动态、自动化、Webhook 都消费这一份 ─────────────

export const eventLog = pgTable(
  "event_log",
  {
    id: id(),
    workItemId: text("work_item_id").references(() => workItem.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workItemId, t.createdAt)],
);

/**
 * Outbox：和业务数据在同一个事务里写入的“待投递事件”。
 * 中继程序取出未投递的行交给 Temporal，确认后写 sent_at。下游按 event_id 去重。
 */
export const outbox = pgTable(
  "outbox",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_pending_idx").on(t.seq).where(sql`sent_at is null`)],
);

export const automationRun = pgTable(
  "automation_run",
  {
    id: id(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    status: text("status").$type<"running" | "succeeded" | "failed" | "skipped">().notNull(),
    error: text("error"),
    startedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.ruleId, t.eventId)],
);

/** 工作项的向量表示，用于 AI 检索。不同步到前端。 */
export const workItemEmbedding = pgTable(
  "work_item_embedding",
  {
    workItemId: text("work_item_id")
      .primaryKey()
      .references(() => workItem.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index("work_item_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

