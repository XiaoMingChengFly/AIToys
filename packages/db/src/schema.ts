import type {
  AutomationAction,
  AutomationTrigger,
  CalendarConfig,
  Condition,
  FlowDefinition,
  NodeState,
  StatusFlowDefinition,
  WorkItemStatus,
} from "@fp/engine";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
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

/**
 * 存任意 JSON 值的列（字段值可以是字符串、数字、数组……）。
 * postgres.js 读出 jsonb 时已经解析过一次，drizzle 自带的 jsonb 会对字符串再 JSON.parse 一次，
 * 把文本 "1.0" 读成数字 1、"true" 读成布尔值。这里读出时原样返回。
 */
const jsonValue = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => value,
});

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

export type SpaceRole = "admin" | "member" | "guest";

export const spaceMember = pgTable(
  "space_member",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 空间角色：管理员能改配置和管理成员；成员能建、改工作项；访客只能查看和评论。 */
    role: text("role").$type<SpaceRole>().notNull().default("member"),
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
    /** 能看到这个字段的工作项角色（角色键）；为空时所有人可见。空间管理员总是可见。 */
    viewRoles: jsonb("view_roles").$type<string[]>(),
    /** 能修改这个字段的工作项角色；为空时能改工作项的人都能改。空间管理员总是可以。 */
    editRoles: jsonb("edit_roles").$type<string[]>(),
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
    /** 节点流（FlowDefinition）或状态流（StatusFlowDefinition，mode 为 "state"），看类型的 flowMode。 */
    definition: jsonb("definition").$type<FlowDefinition | StatusFlowDefinition>().notNull(),
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
  trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
  /** 触发后按工作项字段求值的条件，为空表示不加条件。 */
  conditions: jsonb("conditions").$type<Condition | null>(),
  actions: jsonb("actions").$type<AutomationAction[]>().notNull(),
  /** 规则以创建人的身份执行动作，权限和他手动操作一样。 */
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** 工作项列表的筛选条件。各项之间是“且”，同一项里的多个值是“或”；为空表示不限。 */
export interface WorkItemFilter {
  typeIds?: string[];
  statuses?: WorkItemStatus[];
  stages?: string[];
  /** 在任一角色里的成员。 */
  memberIds?: string[];
}

/** 保存下来的工作项视图：空间成员都能看到和使用。 */
export const savedView = pgTable("saved_view", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filter: jsonb("filter").$type<WorkItemFilter>().notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: createdAt(),
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
    /** 创建时锁定的流程版本（节点流或状态流）。 */
    flowVersionId: text("flow_version_id").references(() => flowVersion.id),
    name: text("name").notNull(),
    /** 节点流：当前阶段；状态流：当前状态的名称（列表、筛选、视图按它显示）。 */
    stage: text("stage"),
    /** 状态流的当前状态键。节点流为空。 */
    flowStatus: text("flow_status"),
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
    value: jsonValue("value"),
    /** 公式字段的结果计算时间；普通字段为空。 */
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }),
    /** 字段配了可见角色时为 true，只同步给 field_viewer 里的人和空间管理员。 */
    restricted: boolean("restricted").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.fieldKey] })],
);

/**
 * 受限字段的可见名单：工作项上担任字段可见（或可改）角色的人。
 * 由 mutator 在角色成员、字段权限变化时维护；查询靠它过滤受限字段的值。
 */
export const fieldViewer = pgTable(
  "field_viewer",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.fieldKey, t.userId] })],
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
    /** 自定义关联的定义。子工作项关系没有定义，用 parentNodeKey 标识。 */
    relationDefId: text("relation_def_id").references(() => relationDef.id),
    /** 子工作项关系：from 是父工作项，to 是为它的这个“子工作项驱动”节点建的子工作项。 */
    parentNodeKey: text("parent_node_key"),
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
    index("relation_from").on(t.fromId),
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

/** 节点上的子任务：拆给具体的人、带截止日期的待办。节点有未完成的子任务时不能确认完成。 */
export const nodeTask = pgTable(
  "node_task",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    name: text("name").notNull(),
    assigneeId: text("assignee_id").references(() => user.id),
    /** 截止日期（空间时区那天的 0 点，和节点的计划日期一样）。 */
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true, mode: "date" }),
    doneBy: text("done_by").references(() => user.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("node_task_work_item").on(t.workItemId, t.nodeKey), index("node_task_assignee").on(t.assigneeId)],
);

/** 工作项下的评论。提及的人会收到通知（由事件流里的通知 activity 生成）。 */
export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("comment_work_item").on(t.workItemId, t.createdAt)],
);

/** 站内通知。每条事件给每个人最多一条，重试不会重复。 */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id").references(() => workItem.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"mentioned" | "nodeAssigned" | "taskAssigned">().notNull(),
    /** 列表里显示的一句话，生成时写好，避免前端再拼。 */
    text: text("text").notNull(),
    eventId: bigint("event_id", { mode: "number" }).notNull(),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("notification_event_user").on(t.eventId, t.userId),
    index("notification_user").on(t.userId, t.createdAt),
  ],
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
  views: many(savedView),
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
  /** 从这个类型出发的自定义关联。 */
  relationDefs: many(relationDef, { relationName: "fromType" }),
}));

export const fieldDefRelations = relations(fieldDef, ({ one }) => ({
  type: one(workItemType, { fields: [fieldDef.typeId], references: [workItemType.id] }),
}));

export const roleDefRelations = relations(roleDef, ({ one }) => ({
  type: one(workItemType, { fields: [roleDef.typeId], references: [workItemType.id] }),
}));

export const relationDefRelations = relations(relationDef, ({ one }) => ({
  fromType: one(workItemType, {
    fields: [relationDef.fromTypeId],
    references: [workItemType.id],
    relationName: "fromType",
  }),
  toType: one(workItemType, { fields: [relationDef.toTypeId], references: [workItemType.id], relationName: "toType" }),
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

export const savedViewRelations = relations(savedView, ({ one }) => ({
  space: one(space, { fields: [savedView.spaceId], references: [space.id] }),
  creator: one(user, { fields: [savedView.createdBy], references: [user.id] }),
}));

export const automationRuleRelations = relations(automationRule, ({ one, many }) => ({
  space: one(space, { fields: [automationRule.spaceId], references: [space.id] }),
  creator: one(user, { fields: [automationRule.createdBy], references: [user.id] }),
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
  comments: many(comment),
  tasks: many(nodeTask),
}));

export const nodeTaskRelations = relations(nodeTask, ({ one }) => ({
  workItem: one(workItem, { fields: [nodeTask.workItemId], references: [workItem.id] }),
  assignee: one(user, { fields: [nodeTask.assigneeId], references: [user.id] }),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  workItem: one(workItem, { fields: [comment.workItemId], references: [workItem.id] }),
  author: one(user, { fields: [comment.authorId], references: [user.id] }),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, { fields: [notification.userId], references: [user.id] }),
  workItem: one(workItem, { fields: [notification.workItemId], references: [workItem.id] }),
}));

export const fieldValueRelations = relations(fieldValue, ({ one, many }) => ({
  workItem: one(workItem, { fields: [fieldValue.workItemId], references: [workItem.id] }),
  viewers: many(fieldViewer),
}));

export const fieldViewerRelations = relations(fieldViewer, ({ one }) => ({
  fieldValue: one(fieldValue, {
    fields: [fieldViewer.workItemId, fieldViewer.fieldKey],
    references: [fieldValue.workItemId, fieldValue.fieldKey],
  }),
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
