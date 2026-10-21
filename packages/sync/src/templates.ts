import {
  type Condition,
  type FlowDefinition,
  isStatusFlow,
  type StatusFlowDefinition,
  validateFlow,
  validateStatusFlow,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

/*
 * 空间配置：工作项类型、角色、字段、流程模板。都只有空间管理员能改。
 * 模板的版本发布后不可修改；在已发布的版本上编辑会自动开一个新的草稿版本。
 * 已经创建的工作项固定在创建时的版本上，不受新版本影响。
 */

const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^\s/]+$/, "键不能包含空格和斜杠。");

export const createTypeArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  key,
  name: z.string().min(1),
  /** node：节点流（需求、项目）；state：状态流（缺陷、任务）。 */
  flowMode: z.enum(["node", "state"]).default("node"),
});
export const createRoleArgs = z.object({ id: z.string(), typeId: z.string(), key, name: z.string().min(1) });
export const createFieldArgs = z.object({
  id: z.string(),
  typeId: z.string(),
  key,
  name: z.string().min(1),
  dataType: z.enum(["text", "number", "bool", "date", "select", "multiSelect", "user", "link", "relation"]),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).optional(),
});
export const createTemplateArgs = z.object({ id: z.string(), typeId: z.string(), key, name: z.string().min(1) });

export const condition: z.ZodType<Condition, Condition> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("equal"), field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
    z.object({ kind: z.literal("notEmpty"), field: z.string() }),
    z.object({ kind: z.literal("all"), items: z.array(condition) }),
    z.object({ kind: z.literal("any"), items: z.array(condition) }),
  ]),
);

export const flowDefinitionSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  nodes: z.array(
    z.object({
      key,
      name: z.string().min(1),
      completion: z.enum(["singleConfirm", "allConfirm", "auto", "subItemDriven"]),
      ownerRoles: z.array(z.string()),
      visibility: condition.optional(),
      gate: condition.optional(),
      stageOnArrival: z.string().min(1).optional(),
      form: z.array(z.object({ field: z.string(), required: z.boolean().optional() })).optional(),
      tasks: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
      duration: z.number().int().min(0).max(999).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});

export const statusFlowDefinitionSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  mode: z.literal("state"),
  statuses: z.array(
    z.object({ key, name: z.string().trim().min(1), category: z.enum(["todo", "doing", "done", "closed"]) }),
  ),
  transitions: z.array(
    z.object({ from: z.string(), to: z.string(), roles: z.array(z.string()).optional(), gate: condition.optional() }),
  ),
});

export const saveDraftArgs = z.object({
  templateId: z.string(),
  definition: z.union([statusFlowDefinitionSchema, flowDefinitionSchema]),
});
export const publishArgs = z.object({ versionId: z.string() });

/** 版本 id 由模板和版本号决定，浏览器乐观执行和服务端写的是同一行。 */
export function flowVersionId(templateId: string, version: number): string {
  return `${templateId}/v${version}`;
}

export async function assertAdmin(tx: Transaction, spaceId: string, userID: string) {
  const member = await tx.run(zql.spaceMember.where("spaceId", spaceId).where("userId", userID).one());
  if (!member?.isAdmin) throw new Error("只有空间管理员可以修改配置。");
}

/** 类型存在且当前用户是它所在空间的管理员。 */
async function adminType(tx: Transaction, typeId: string, userID: string) {
  const type = await tx.run(zql.workItemType.where("id", typeId).related("roles").related("fields").one());
  if (!type) throw new Error("工作项类型不存在。");
  await assertAdmin(tx, type.spaceId, userID);
  return type;
}

async function adminTemplate(tx: Transaction, templateId: string, userID: string) {
  const template = await tx.run(
    zql.flowTemplate
      .where("id", templateId)
      .related("versions", (v) => v.orderBy("version", "desc").limit(1))
      .one(),
  );
  if (!template) throw new Error("流程模板不存在。");
  const type = await adminType(tx, template.typeId, userID);
  return { template, type, latest: template.versions[0] };
}

export async function createType(tx: Transaction, args: z.output<typeof createTypeArgs>, userID: string) {
  await assertAdmin(tx, args.spaceId, userID);
  const existing = await tx.run(zql.workItemType.where("spaceId", args.spaceId));
  await tx.mutate.workItemType.insert({ ...args, sort: existing.length, createdAt: Date.now() });
}

export async function createRole(tx: Transaction, args: z.output<typeof createRoleArgs>, userID: string) {
  await adminType(tx, args.typeId, userID);
  await tx.mutate.roleDef.insert({ ...args, inheritFrom: null, createdAt: Date.now() });
}

export async function createField(tx: Transaction, args: z.output<typeof createFieldArgs>, userID: string) {
  const type = await adminType(tx, args.typeId, userID);
  const isOptions = args.dataType === "select" || args.dataType === "multiSelect";
  if (isOptions && !args.options?.length) throw new Error("选项字段至少要有一个选项。");
  await tx.mutate.fieldDef.insert({
    ...args,
    options: isOptions ? (args.options ?? []) : null,
    formula: null,
    required: false,
    sort: type.fields.length,
    createdAt: Date.now(),
  });
}

/** 新模板带一个草稿 v1：节点流只有“开始”节点；状态流是“待处理 → 处理中 → 已完成”的常用流转。 */
export async function createTemplate(tx: Transaction, args: z.output<typeof createTemplateArgs>, userID: string) {
  const type = await adminType(tx, args.typeId, userID);
  const now = Date.now();
  await tx.mutate.flowTemplate.insert({ ...args, currentVersionId: null, createdAt: now });
  const definition: FlowDefinition | StatusFlowDefinition =
    type.flowMode === "state"
      ? {
          key: args.key,
          version: 1,
          mode: "state",
          statuses: [
            { key: "todo", name: "待处理", category: "todo" },
            { key: "doing", name: "处理中", category: "doing" },
            { key: "done", name: "已完成", category: "done" },
          ],
          transitions: [
            { from: "todo", to: "doing" },
            { from: "doing", to: "done" },
            { from: "done", to: "doing" },
          ],
        }
      : {
          key: args.key,
          version: 1,
          nodes: [{ key: "start", name: "开始", completion: "auto", ownerRoles: [], position: { x: 0, y: 0 } }],
          edges: [],
        };
  await tx.mutate.flowVersion.insert({
    id: flowVersionId(args.id, 1),
    templateId: args.id,
    version: 1,
    definition,
    publishedAt: null,
    publishedBy: null,
    createdAt: now,
  });
}

/** 保存草稿：最新版本是草稿就覆盖它，已发布就开一个新版本。返回草稿的版本 id。 */
export async function saveDraft(tx: Transaction, args: z.output<typeof saveDraftArgs>, userID: string) {
  const { template, latest, type } = await adminTemplate(tx, args.templateId, userID);
  if (isStatusFlow(args.definition) !== (type.flowMode === "state"))
    throw new Error(type.flowMode === "state" ? "这个类型用状态流。" : "这个类型用节点流。");
  if (latest && !latest.publishedAt) {
    const definition = { ...args.definition, key: template.key, version: latest.version };
    await tx.mutate.flowVersion.update({ id: latest.id, definition });
    return latest.id;
  }
  const version = (latest?.version ?? 0) + 1;
  const id = flowVersionId(template.id, version);
  await tx.mutate.flowVersion.insert({
    id,
    templateId: template.id,
    version,
    definition: { ...args.definition, key: template.key, version },
    publishedAt: null,
    publishedBy: null,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * 模板引用的角色和字段必须在工作项类型里存在。引擎的 validateFlow 只看图本身，这里补上和类型配置的对照。
 */
export function checkReferences(
  definition: FlowDefinition | StatusFlowDefinition,
  roleKeys: readonly string[],
  fieldKeys: readonly string[],
): string[] {
  const errors: string[] = [];
  const roles = new Set(roleKeys);
  const fields = new Set(fieldKeys);
  const fieldsOf = (c: Condition): string[] =>
    c.kind === "all" || c.kind === "any" ? c.items.flatMap(fieldsOf) : [c.field];
  if (isStatusFlow(definition)) {
    const name = (key: string) => definition.statuses.find((s) => s.key === key)?.name ?? key;
    for (const t of definition.transitions) {
      const label = `「${name(t.from)} → ${name(t.to)}」`;
      for (const role of t.roles ?? []) if (!roles.has(role)) errors.push(`流转${label}的角色「${role}」不存在。`);
      for (const field of t.gate ? fieldsOf(t.gate) : [])
        if (!fields.has(field)) errors.push(`流转${label}的条件用到的字段「${field}」不存在。`);
    }
    return errors;
  }
  for (const node of definition.nodes) {
    for (const role of node.ownerRoles)
      if (!roles.has(role)) errors.push(`节点「${node.name}」的负责角色「${role}」不存在。`);
    for (const c of [node.visibility, node.gate])
      for (const field of c ? fieldsOf(c) : [])
        if (!fields.has(field)) errors.push(`节点「${node.name}」的条件用到的字段「${field}」不存在。`);
    for (const { field } of node.form ?? [])
      if (!fields.has(field)) errors.push(`节点「${node.name}」的完成表单用到的字段「${field}」不存在。`);
  }
  return errors;
}

/** 发布草稿：通过校验后成为模板的当前版本，之后新建的工作项都用它。 */
export async function publishVersion(tx: Transaction, args: z.output<typeof publishArgs>, userID: string) {
  const version = await tx.run(zql.flowVersion.where("id", args.versionId).one());
  if (!version) throw new Error("版本不存在。");
  if (version.publishedAt) throw new Error("这个版本已经发布过了。");
  const { latest, type } = await adminTemplate(tx, version.templateId, userID);
  if (latest?.id !== version.id) throw new Error("只能发布最新的草稿。");

  const definition = version.definition;
  const errors = [
    ...(isStatusFlow(definition) ? validateStatusFlow(definition) : validateFlow(definition)).errors,
    ...checkReferences(
      definition,
      type.roles.map((r) => r.key),
      type.fields.map((f) => f.key),
    ),
  ];
  if (errors.length > 0) throw new Error(`流程还有问题，不能发布：${errors.join("；")}`);

  const now = Date.now();
  await tx.mutate.flowVersion.update({ id: version.id, publishedAt: now, publishedBy: userID });
  await tx.mutate.flowTemplate.update({ id: version.templateId, currentVersionId: version.id });
}
