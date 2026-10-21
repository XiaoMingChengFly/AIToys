import type { CalendarConfig, FlowDefinition, NodeState, WorkItemStatus } from "@fp/engine";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/*
 * 表结构对应设计文档「核心概念与数据模型」：配置层描述一类工作项长什么样、怎么流转，实例层记录工作项走到哪了。
 * 业务表的主键是客户端生成的文本 id（UUIDv7），这样 Zero 的乐观写入不用等服务端分配。
 * 事件流水和 Outbox 用自增 bigint，顺序就是发生顺序。
 */

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export type FlowMode = "node" | "state";
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
export type Cardinality = "one" | "many";
export type RoleMemberSource = "manual" | "inherited";

/** 角色继承：沿 relationFieldKey 找到关联工作项，复制它的 parentRoleKey 角色成员。 */
export interface RoleInheritance {
  relationFieldKey: string;
  parentRoleKey: string;
}

/** 不同步给前端的内部表放在 infra schema；Zero 的 publication 只包含 public schema。 */
export const infra = pgSchema("infra");

// ───────────── 登录（Better Auth 的核心表） ─────────────

/** 用户要显示名字和头像，放在 public 同步给前端；会话、凭据放在 infra，不进 Zero。 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = infra.table("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = infra.table("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = infra.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────── 配置层 ─────────────

export const space = pgTable("space", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  /** 工作日历：节假日和调休，排期按它数工作日。 */
  calendar: jsonb("calendar").$type<CalendarConfig>().notNull().default({ holidays: [], extraWorkdays: [] }),
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
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    flowMode: text("flow_mode").$type<FlowMode>().notNull().default("node"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("work_item_type_space_key").on(t.spaceId, t.key)],
);

export const fieldDef = pgTable(
  "field_def",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    dataType: text("data_type").$type<FieldDataType>().notNull(),
    /** 选项类字段的候选值。 */
    options: jsonb("options").$type<{ value: string; label: string; color?: string }[]>(),
    /** 非空即公式字段，值由公式引擎计算后缓存在 field_value。 */
    formula: text("formula"),
    required: boolean("required").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("field_def_type_key").on(t.typeId, t.key)],
);

export const roleDef = pgTable(
  "role_def",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    inheritFrom: jsonb("inherit_from").$type<RoleInheritance>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("role_def_type_key").on(t.typeId, t.key)],
);

export const relationDef = pgTable("relation_def", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id),
  fromTypeId: text("from_type_id")
    .notNull()
    .references(() => workItemType.id),
  toTypeId: text("to_type_id")
    .notNull()
    .references(() => workItemType.id),
  /** 在 from 类型上承载这条关联的字段键，如“关联项目”。 */
  fieldKey: text("field_key").notNull(),
  name: text("name").notNull(),
  cardinality: text("cardinality").$type<Cardinality>().notNull(),
  createdAt: createdAt(),
});

export const flowTemplate = pgTable(
  "flow_template",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** 新建工作项默认用的版本。为空表示还没有发布过。 */
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("flow_template_type_key").on(t.typeId, t.key)],
);

/** 流程模板的不可变快照。整张图存在 definition 里，整体校验、整体发布。 */
export const flowVersion = pgTable(
  "flow_version",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => flowTemplate.id),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<FlowDefinition>().notNull(),
    /** 为空表示草稿；发布后不可再改。 */
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    publishedBy: text("published_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("flow_version_template_version").on(t.templateId, t.version)],
);

export const automationRule = pgTable("automation_rule", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").$type<{ kind: string } & Record<string, unknown>>().notNull(),
  conditions: jsonb("conditions").$type<unknown>(),
  actions: jsonb("actions").$type<unknown[]>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────── 实例层 ─────────────

export const workItem = pgTable(
  "work_item",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    /** 创建时锁定的流程版本。状态流类型为空。 */
    flowVersionId: text("flow_version_id").references(() => flowVersion.id),
    name: text("name").notNull(),
    stage: text("stage"),
    status: text("status").$type<WorkItemStatus | "terminated">().notNull().default("inProgress"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("work_item_space_type").on(t.spaceId, t.typeId), index("work_item_status").on(t.status)],
);

export const fieldValue = pgTable(
  "field_value",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    value: jsonb("value").$type<unknown>(),
    /** 公式字段的结果计算时间；普通字段为空。 */
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.fieldKey] })],
);

export const roleMember = pgTable(
  "role_member",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    source: text("source").$type<RoleMemberSource>().notNull().default("manual"),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.roleKey, t.userId] })],
);

export const relation = pgTable(
  "relation",
  {
    id: text("id").primaryKey(),
    relationDefId: text("relation_def_id")
      .notNull()
      .references(() => relationDef.id),
    fromId: text("from_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("relation_def_from_to").on(t.relationDefId, t.fromId, t.toId),
    // 公式和角色继承需要从子工作项反查父工作项
    index("relation_to").on(t.toId),
  ],
);

export const nodeInstance = pgTable(
  "node_instance",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    /** 按节点键对应流程定义，不按名称。 */
    nodeKey: text("node_key").notNull(),
    state: text("state").$type<NodeState>().notNull().default("notStarted"),
    owners: jsonb("owners").$type<string[]>().notNull().default([]),
    plannedStart: timestamp("planned_start", { withTimezone: true, mode: "date" }),
    plannedEnd: timestamp("planned_end", { withTimezone: true, mode: "date" }),
    actualStart: timestamp("actual_start", { withTimezone: true, mode: "date" }),
    actualEnd: timestamp("actual_end", { withTimezone: true, mode: "date" }),
    /** 计划日期被人手动改过，排期重算时不覆盖。 */
    plannedPinned: boolean("planned_pinned").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("node_instance_work_item_node").on(t.workItemId, t.nodeKey)],
);

export const nodeConfirmation = pgTable(
  "node_confirmation",
  {
    nodeInstanceId: text("node_instance_id")
      .notNull()
      .references(() => nodeInstance.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.nodeInstanceId, t.userId] })],
);

/** 所有状态变化的流水。只追加不修改；审计、动态、自动化、Webhook 都从这里取事件。 */
export const eventLog = pgTable(
  "event_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    workItemId: text("work_item_id").references(() => workItem.id),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** 操作人；系统和自动化写入时为空。 */
    actor: text("actor"),
    /** 引发本事件的上游事件，用于追踪自动化连锁和做循环保护。 */
    causedBy: bigint("caused_by", { mode: "number" }),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("event_log_work_item").on(t.workItemId, t.id)],
);

export const automationRun = pgTable(
  "automation_run",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => eventLog.id),
    /** 执行这条规则的 Temporal workflow，方便从执行记录跳到 Temporal UI。 */
    workflowId: text("workflow_id").notNull(),
    status: text("status").$type<"running" | "succeeded" | "failed" | "skipped">().notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("automation_run_rule_event").on(t.ruleId, t.eventId)],
);

/**
 * 事务性 Outbox：和业务写入、event_log 在同一个事务里插入，中继程序把它按顺序交给 Temporal。
 * stream 决定顺序和归属：同一个 stream 的事件由同一个 Temporal workflow 依次处理。
 * 投递失败的行留在原处，attempts 和 last_error 记录原因，下一轮从它开始重试，保证同一个 stream 不乱序。
 */
export const outbox = infra.table(
  "outbox",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => eventLog.id),
    stream: text("stream").notNull(),
    createdAt: createdAt(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_pending").on(t.id).where(sql`${t.dispatchedAt} is null`)],
);

/** 工作项的向量表示，用于 AI 检索。不同步到前端。 */
export const workItemEmbedding = infra.table(
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

// ───────────── 关系（Drizzle 查询和 Zero schema 共用） ─────────────

export const userRelations = relations(user, ({ many }) => ({
  spaces: many(spaceMember),
}));

export const spaceRelations = relations(space, ({ many }) => ({
  members: many(spaceMember),
  workItemTypes: many(workItemType),
  workItems: many(workItem),
  automationRules: many(automationRule),
}));

export const spaceMemberRelations = relations(spaceMember, ({ one }) => ({
  space: one(space, { fields: [spaceMember.spaceId], references: [space.id] }),
  user: one(user, { fields: [spaceMember.userId], references: [user.id] }),
}));

export const workItemTypeRelations = relations(workItemType, ({ one, many }) => ({
  space: one(space, { fields: [workItemType.spaceId], references: [space.id] }),
  fields: many(fieldDef),
  roles: many(roleDef),
  flowTemplates: many(flowTemplate),
  workItems: many(workItem),
}));

export const fieldDefRelations = relations(fieldDef, ({ one }) => ({
  type: one(workItemType, { fields: [fieldDef.typeId], references: [workItemType.id] }),
}));

export const roleDefRelations = relations(roleDef, ({ one }) => ({
  type: one(workItemType, { fields: [roleDef.typeId], references: [workItemType.id] }),
}));

export const relationDefRelations = relations(relationDef, ({ one }) => ({
  fromType: one(workItemType, { fields: [relationDef.fromTypeId], references: [workItemType.id] }),
  toType: one(workItemType, { fields: [relationDef.toTypeId], references: [workItemType.id] }),
}));

export const flowTemplateRelations = relations(flowTemplate, ({ one, many }) => ({
  type: one(workItemType, { fields: [flowTemplate.typeId], references: [workItemType.id] }),
  versions: many(flowVersion, { relationName: "versions" }),
  currentVersion: one(flowVersion, {
    fields: [flowTemplate.currentVersionId],
    references: [flowVersion.id],
    relationName: "currentVersion",
  }),
}));

export const flowVersionRelations = relations(flowVersion, ({ one }) => ({
  template: one(flowTemplate, {
    fields: [flowVersion.templateId],
    references: [flowTemplate.id],
    relationName: "versions",
  }),
}));

export const automationRuleRelations = relations(automationRule, ({ one, many }) => ({
  space: one(space, { fields: [automationRule.spaceId], references: [space.id] }),
  runs: many(automationRun),
}));

export const workItemRelations = relations(workItem, ({ one, many }) => ({
  space: one(space, { fields: [workItem.spaceId], references: [space.id] }),
  type: one(workItemType, { fields: [workItem.typeId], references: [workItemType.id] }),
  flowVersion: one(flowVersion, { fields: [workItem.flowVersionId], references: [flowVersion.id] }),
  fieldValues: many(fieldValue),
  roleMembers: many(roleMember),
  nodes: many(nodeInstance),
  outgoing: many(relation, { relationName: "from" }),
  incoming: many(relation, { relationName: "to" }),
  events: many(eventLog),
}));

export const fieldValueRelations = relations(fieldValue, ({ one }) => ({
  workItem: one(workItem, { fields: [fieldValue.workItemId], references: [workItem.id] }),
}));

export const roleMemberRelations = relations(roleMember, ({ one }) => ({
  workItem: one(workItem, { fields: [roleMember.workItemId], references: [workItem.id] }),
  user: one(user, { fields: [roleMember.userId], references: [user.id] }),
}));

export const relationRelations = relations(relation, ({ one }) => ({
  def: one(relationDef, { fields: [relation.relationDefId], references: [relationDef.id] }),
  from: one(workItem, { fields: [relation.fromId], references: [workItem.id], relationName: "from" }),
  to: one(workItem, { fields: [relation.toId], references: [workItem.id], relationName: "to" }),
}));

export const nodeInstanceRelations = relations(nodeInstance, ({ one, many }) => ({
  workItem: one(workItem, { fields: [nodeInstance.workItemId], references: [workItem.id] }),
  confirmations: many(nodeConfirmation),
}));

export const nodeConfirmationRelations = relations(nodeConfirmation, ({ one }) => ({
  node: one(nodeInstance, { fields: [nodeConfirmation.nodeInstanceId], references: [nodeInstance.id] }),
}));

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  workItem: one(workItem, { fields: [eventLog.workItemId], references: [workItem.id] }),
}));

export const automationRunRelations = relations(automationRun, ({ one }) => ({
  rule: one(automationRule, { fields: [automationRun.ruleId], references: [automationRule.id] }),
  event: one(eventLog, { fields: [automationRun.eventId], references: [eventLog.id] }),
}));
