import { randomUUID } from "node:crypto";
import { schema } from "@fp/db";
import { createTestDatabase } from "@fp/db/testing";
import { dayInTimeZone, dayToIso, oemV289 } from "@fp/engine";
import { cascadeSubItems, createMutatorRunner, matchRules, notify, runRule } from "@fp/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createServices, type Services } from "../src/app.ts";
import { importOemTemplate } from "../src/seed/oem.ts";

let services: Services;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  services = createServices(await createTestDatabase("fp_test_api"));
  app = createApp(services);
});

afterAll(() => services?.database.close());

async function signUp(email: string): Promise<{ cookie: string; userId: string }> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email.split("@")[0] }),
  });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
  const body = (await res.json()) as { user: { id: string } };
  return { cookie, userId: body.user.id };
}

describe("login + Zero mutators", () => {
  const spaceId = randomUUID();
  const workItemId = randomUUID();
  let owner: { cookie: string; userId: string };

  it("signs up and resolves the session from the cookie", async () => {
    owner = await signUp("pascal@example.com");
    const res = await app.request("/api/auth/get-session", { headers: { cookie: owner.cookie } });
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(owner.userId);

    // 会话存在 infra schema 里
    const sessions = await services.database.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, owner.userId));
    expect(sessions).toHaveLength(1);
  });

  it("space.create makes the creator an admin member", async () => {
    await services.zero.run("space.create", { id: spaceId, name: "oemtest" }, owner.userId);
    const [member] = await services.database.db
      .select()
      .from(schema.spaceMember)
      .where(eq(schema.spaceMember.spaceId, spaceId));
    expect(member).toMatchObject({ userId: owner.userId, isAdmin: true });
  });

  it("fieldValue.set writes the value and its event in one transaction", async () => {
    const { db } = services.database;
    await db.insert(schema.workItemType).values({ id: `${spaceId}-t`, spaceId, key: "project", name: "项目" });
    await db.insert(schema.workItem).values({
      id: workItemId,
      spaceId,
      typeId: `${spaceId}-t`,
      name: "OEM 项目",
      createdBy: owner.userId,
    });

    await services.zero.run("fieldValue.set", { workItemId, fieldKey: "needConceptTest", value: "是" }, owner.userId);
    await services.zero.run("fieldValue.set", { workItemId, fieldKey: "needConceptTest", value: "否" }, owner.userId);

    const [value] = await db
      .select()
      .from(schema.fieldValue)
      .where(and(eq(schema.fieldValue.workItemId, workItemId), eq(schema.fieldValue.fieldKey, "needConceptTest")));
    expect(value?.value).toBe("否");

    const events = await db.select().from(schema.eventLog).where(eq(schema.eventLog.workItemId, workItemId));
    expect(events.map((e) => [e.kind, e.payload, e.actor])).toEqual([
      ["fieldChanged", { fieldKey: "needConceptTest", from: null, to: "是" }, owner.userId],
      ["fieldChanged", { fieldKey: "needConceptTest", from: "是", to: "否" }, owner.userId],
    ]);
    const outbox = await db.select().from(schema.outbox);
    expect(outbox.map((o) => o.stream)).toEqual([`work_item:${workItemId}`, `work_item:${workItemId}`]);
  });

  it("rejects writes from someone outside the space and leaves no event behind", async () => {
    const stranger = await signUp("stranger@example.com");
    await expect(
      services.zero.run("fieldValue.set", { workItemId, fieldKey: "x", value: 1 }, stranger.userId),
    ).rejects.toThrow("没有权限");
    expect(await services.database.db.$count(schema.eventLog)).toBe(2);
  });

  it("serves named queries to logged-in users only", async () => {
    const body = JSON.stringify(["transform", [{ id: "q1", name: "workItems.bySpace", args: [{ spaceId }] }]]);
    const url = "/api/zero/query?schema=zero_0&appID=zero";
    const anonymous = await app.request(url, { method: "POST", body });
    expect(anonymous.status).toBe(401);

    const res = await app.request(url, { method: "POST", body, headers: { cookie: owner.cookie } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { userID: string; queries: { id: string; ast: { table: string } }[] };
    expect(json.userID).toBe(owner.userId);
    expect(json.queries.map((q) => [q.id, q.ast.table])).toEqual([["q1", "work_item"]]);
    // 权限过滤被写进了发给 zero-cache 的查询里
    expect(JSON.stringify(json.queries[0]?.ast)).toContain(owner.userId);
  });
});

describe("workItem.create with OEM v289", () => {
  const spaceId = randomUUID();
  let npd: { cookie: string; userId: string };
  let finance: { cookie: string; userId: string };
  let dev: { cookie: string; userId: string };
  let typeId: string;

  beforeAll(async () => {
    npd = await signUp(`npd-${spaceId}@example.com`);
    finance = await signUp(`finance-${spaceId}@example.com`);
    dev = await signUp(`dev-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "OEM 验收" }, npd.userId);
    await services.database.db.insert(schema.spaceMember).values([
      { spaceId, userId: finance.userId },
      { spaceId, userId: dev.userId },
    ]);
    ({ typeId } = await importOemTemplate(services.database.db, spaceId));
  });

  async function create(fields: Record<string, string>) {
    const id = randomUUID();
    await services.zero.run(
      "workItem.create",
      {
        id,
        typeId,
        name: "新品 A",
        fields,
        roles: { NPD: [npd.userId], 财务BP负责人: [finance.userId], 开发: [dev.userId] },
      },
      npd.userId,
    );
    const { db } = services.database;
    const [item] = await db.select().from(schema.workItem).where(eq(schema.workItem.id, id));
    const nodes = await db.select().from(schema.nodeInstance).where(eq(schema.nodeInstance.workItemId, id));
    const events = await db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, id))
      .orderBy(schema.eventLog.id);
    return { id, item, node: (key: string) => nodes.find((n) => n.nodeKey === key), nodes, events };
  }

  const { F } = oemV289;
  const fields = {
    [F.needPhaseOut]: "是",
    [F.needLaunchPlan]: "是",
    [F.needConceptTest]: "否",
    [F.needVideo]: "是",
    [F.needFiling]: "是",
  };

  it("completes the start node, opens 需求立项提案 for its three owners and sets the stage", async () => {
    const { item, node, nodes, events } = await create(fields);
    expect(item).toMatchObject({ stage: "概念阶段", status: "inProgress", createdBy: npd.userId });
    expect(nodes).toHaveLength(48);
    expect(node("start")?.state).toBe("completed");
    expect(node("doing")).toMatchObject({
      state: "inProgress",
      owners: [npd.userId, finance.userId, dev.userId],
    });
    expect(node("doing")?.actualStart).toBeInstanceOf(Date);
    expect(node("state_51")?.state).toBe("notStarted");

    expect(events[0]).toMatchObject({ kind: "workItemCreated", actor: npd.userId });
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["nodeStarted", "stageChanged", "nodeCompleted"]));
    expect(events.find((e) => e.kind === "nodeCompleted")?.payload).toEqual({ node: "start", by: null });
    // 每条事件都进了 outbox，交给 Temporal
    const outbox = await services.database.db.select().from(schema.outbox);
    for (const e of events) expect(outbox.some((o) => o.eventId === e.id)).toBe(true);
  });

  it("skips the phase-out branch when its switch is off", async () => {
    const { node } = await create({ ...fields, [F.needPhaseOut]: "否", [F.needLaunchPlan]: "否" });
    for (const key of ["state_53", "state_54", "state_55", "state_56", "state_0"])
      expect(node(key)?.state).toBe("skipped");
  });

  it("refuses users outside the space", async () => {
    const stranger = await signUp(`stranger-${spaceId}@example.com`);
    await expect(
      services.zero.run("workItem.create", { id: randomUUID(), typeId, name: "x" }, stranger.userId),
    ).rejects.toThrow("没有权限");
  });

  async function reload(id: string) {
    const { db } = services.database;
    const [item] = await db.select().from(schema.workItem).where(eq(schema.workItem.id, id));
    const nodes = await db.select().from(schema.nodeInstance).where(eq(schema.nodeInstance.workItemId, id));
    const confirmations = await db.select().from(schema.nodeConfirmation);
    const events = await db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, id))
      .orderBy(schema.eventLog.id);
    return {
      item,
      node: (key: string) => nodes.find((n) => n.nodeKey === key),
      confirmedBy: (key: string) =>
        confirmations.filter((c) => c.nodeInstanceId === `${id}/${key}`).map((c) => c.userId),
      events,
    };
  }

  it("needs all three owners to confirm 需求立项提案, then starts 财务分析", async () => {
    const { id } = await create({ ...fields, [F.linkedSku]: "SKU-001" });
    const confirm = (userId: string) => services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, userId);

    await confirm(npd.userId);
    let now = await reload(id);
    expect(now.node("doing")?.state).toBe("inProgress");
    expect(now.confirmedBy("doing")).toEqual([npd.userId]);

    await confirm(finance.userId);
    await confirm(dev.userId);
    now = await reload(id);
    expect(now.node("doing")).toMatchObject({ state: "completed", actualEnd: expect.any(Date) });
    expect(now.node("state_51")).toMatchObject({ state: "inProgress", actualStart: expect.any(Date) });

    const kinds = now.events.map((e) => [e.kind, (e.payload as { node?: string }).node, e.actor]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["nodeConfirmed", "doing", npd.userId],
        ["nodeCompleted", "doing", dev.userId],
        ["nodeStarted", "state_51", null],
      ]),
    );
  });

  it("refuses a confirm from someone who is not an owner and writes nothing", async () => {
    const { id } = await create(fields);
    const outsider = await signUp(`member-${randomUUID()}@example.com`);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: outsider.userId });
    const before = (await reload(id)).events.length;
    await expect(
      services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, outsider.userId),
    ).rejects.toThrow("负责人");
    expect((await reload(id)).events).toHaveLength(before);
  });

  it("rolls back to 需求立项提案: clears its confirmations and reopens it, later nodes go back to not started", async () => {
    const { id } = await create({ ...fields, [F.linkedSku]: "SKU-001" });
    for (const u of [npd, finance, dev])
      await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, u.userId);

    await services.zero.run("node.rollback", { workItemId: id, nodeKey: "doing" }, npd.userId);
    const now = await reload(id);
    expect(now.node("doing")).toMatchObject({ state: "inProgress", actualEnd: null });
    expect(now.confirmedBy("doing")).toEqual([]);
    expect(now.node("state_51")).toMatchObject({ state: "notStarted", actualStart: null });
    expect(now.events.at(-1)?.kind).toBe("nodeRolledBack");
  });

  it("changing a role re-assigns the open nodes it owns and drops the replaced owner's confirmation", async () => {
    const { id } = await create({ ...fields, [F.linkedSku]: "SKU-001" });
    await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, finance.userId);
    await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, dev.userId);

    // 开发换成 NPD 本人：需求立项提案的负责人变成 NPD 和财务，开发的确认作废
    await services.zero.run("role.set", { workItemId: id, roleKey: "开发", userIds: [npd.userId] }, npd.userId);
    const now = await reload(id);
    expect(now.node("doing")?.owners).toEqual([npd.userId, finance.userId]);
    expect(now.confirmedBy("doing")).toEqual([finance.userId]);
    expect(now.events.at(-1)).toMatchObject({
      kind: "roleChanged",
      payload: { roleKey: "开发", from: [dev.userId], to: [npd.userId] },
    });

    await services.zero.run("node.confirm", { workItemId: id, nodeKey: "doing" }, npd.userId);
    expect((await reload(id)).node("doing")?.state).toBe("completed");
  });

  it("only accepts space members in roles", async () => {
    const stranger = await signUp(`role-${randomUUID()}@example.com`);
    const { id } = await create(fields);
    await expect(
      services.zero.run("role.set", { workItemId: id, roleKey: "开发", userIds: [stranger.userId] }, npd.userId),
    ).rejects.toThrow("空间成员");
  });

  it("plans every node on create and re-plans downstream when a node's dates are set by hand", async () => {
    const { id } = await create({ ...fields, [F.linkedSku]: "SKU-001" });
    const day = (ms: Date | null | undefined) => (ms ? ms.toISOString().slice(0, 10) : null);
    let now = await reload(id);
    const today = dayToIso(dayInTimeZone(Date.now(), "Asia/Shanghai"));
    expect(day(now.node("start")?.plannedStart)).toBe(today);
    const financeStart = now.node("state_51")?.plannedStart as Date;
    expect(financeStart.getTime()).toBeGreaterThan((now.node("doing")?.plannedEnd as Date).getTime());

    // 需求立项提案手动定到 12 月，后面的财务分析跟着顺延到它之后的第一个工作日
    await services.zero.run(
      "node.setPlan",
      { workItemId: id, nodeKey: "doing", start: "2026-12-01", end: "2026-12-04" },
      npd.userId,
    );
    now = await reload(id);
    expect(now.node("doing")).toMatchObject({ plannedPinned: true });
    expect(day(now.node("doing")?.plannedEnd)).toBe("2026-12-04");
    expect(day(now.node("state_51")?.plannedStart)).toBe("2026-12-07"); // 12-04 是周五
    expect(now.events.at(-1)).toMatchObject({ kind: "nodePlanChanged", payload: { node: "doing" } });

    // 取消手动日期，回到自动排期
    await services.zero.run("node.setPlan", { workItemId: id, nodeKey: "doing" }, npd.userId);
    now = await reload(id);
    expect(now.node("doing")?.plannedPinned).toBe(false);
    expect(now.node("state_51")?.plannedStart).toEqual(financeStart);
  });

  it("refuses plan changes from someone who does not own the node", async () => {
    const { id } = await create(fields);
    const outsider = await signUp(`plan-${randomUUID()}@example.com`);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: outsider.userId });
    await expect(
      services.zero.run(
        "node.setPlan",
        { workItemId: id, nodeKey: "doing", start: "2026-12-01", end: "2026-12-02" },
        outsider.userId,
      ),
    ).rejects.toThrow("负责人");
  });

  it("re-plans the space's work items when the admin changes the work calendar", async () => {
    const { id } = await create({ ...fields, [F.linkedSku]: "SKU-002" });
    const day = (ms: Date | null | undefined) => (ms ? ms.toISOString().slice(0, 10) : null);
    await services.zero.run(
      "node.setPlan",
      { workItemId: id, nodeKey: "doing", start: "2026-12-01", end: "2026-12-04" },
      npd.userId,
    );
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-07");

    // 12-07（周一）放假：财务分析顺延到 12-08
    const setCalendar = (holidays: string[], extraWorkdays: string[], userId = npd.userId) =>
      services.zero.run("space.setCalendar", { spaceId, holidays, extraWorkdays }, userId);
    await setCalendar(["2026-12-07"], []);
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-08");
    // 12-05（周六）调休上班：财务分析提前到 12-05
    await setCalendar(["2026-12-07"], ["2026-12-05"]);
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-05");

    const [space] = await services.database.db.select().from(schema.space).where(eq(schema.space.id, spaceId));
    expect(space?.calendar).toEqual({ holidays: ["2026-12-07"], extraWorkdays: ["2026-12-05"] });
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.spaceId, spaceId))
      .orderBy(schema.eventLog.id);
    expect(events.at(-1)).toMatchObject({ kind: "calendarChanged", workItemId: null });

    await expect(setCalendar([], [], finance.userId)).rejects.toThrow("管理员");
    await expect(setCalendar(["2026-12-05"], ["2026-12-05"])).rejects.toThrow("既放假又调休");
    await setCalendar([], []);
    expect(day((await reload(id)).node("state_51")?.plannedStart)).toBe("2026-12-07");
  });

  it("re-evaluates node visibility when a switch field changes", async () => {
    const { id } = await create(fields);
    expect((await reload(id)).node("state_53")?.state).toBe("notStarted");

    await services.zero.run("fieldValue.set", { workItemId: id, fieldKey: F.needPhaseOut, value: "否" }, npd.userId);
    const now = await reload(id);
    expect(now.node("state_53")?.state).toBe("skipped");
    const changed = now.events.findIndex((e) => e.kind === "fieldChanged");
    const skipped = now.events.slice(changed + 1).map((e) => [e.kind, (e.payload as { node: string }).node]);
    expect(skipped).toContainEqual(["nodeSkipped", "state_53"]);
  });
});

describe("POST /api/spaces/:spaceId/members", () => {
  it("lets the space admin add a registered user by email", async () => {
    const spaceId = randomUUID();
    const admin = await signUp(`admin-${spaceId}@example.com`);
    const colleague = await signUp(`colleague-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "成员" }, admin.userId);
    const add = (cookie: string, email: string) =>
      app.request(`/api/spaces/${spaceId}/members`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

    expect((await add(colleague.cookie, `colleague-${spaceId}@example.com`)).status).toBe(403);
    expect((await add(admin.cookie, "nobody@example.com")).status).toBe(404);
    const ok = await add(admin.cookie, `Colleague-${spaceId}@example.com`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ userId: colleague.userId, name: `colleague-${spaceId}` });
    expect((await add(admin.cookie, `colleague-${spaceId}@example.com`)).status).toBe(409);
  });
});

describe("POST /api/spaces/:spaceId/import-oem", () => {
  it("lets the space admin import once and refuses everyone else", async () => {
    const spaceId = randomUUID();
    const admin = await signUp(`admin-${spaceId}@example.com`);
    const other = await signUp(`other-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "演示" }, admin.userId);
    const url = `/api/spaces/${spaceId}/import-oem`;

    expect((await app.request(url, { method: "POST", headers: { cookie: other.cookie } })).status).toBe(403);
    const ok = await app.request(url, { method: "POST", headers: { cookie: admin.cookie } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ typeId: `${spaceId}/project`, templateId: `${spaceId}/project/oem` });
    expect((await app.request(url, { method: "POST", headers: { cookie: admin.cookie } })).status).toBe(409);
  });
});

describe("configuring a type and its flow template", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/bug`;
  const templateId = `${typeId}/default`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);

  const definition = (ownerRole: string) => ({
    key: "ignored",
    version: 0,
    nodes: [
      { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
      { key: "fix", name: "修复", completion: "singleConfirm", ownerRoles: [ownerRole], position: { x: 200, y: 0 } },
      {
        key: "verify",
        name: "验证",
        completion: "singleConfirm",
        ownerRoles: ["qa"],
        visibility: { kind: "equal", field: "needQa", value: "是" },
        stageOnArrival: "验证中",
      },
    ],
    edges: [
      { from: "start", to: "fix" },
      { from: "fix", to: "verify" },
    ],
  });

  beforeAll(async () => {
    admin = await signUp(`cfg-admin-${spaceId}@example.com`);
    member = await signUp(`cfg-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "配置" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
  });

  it("only lets space admins change configuration", async () => {
    await expect(
      run("workItemType.create", { id: typeId, spaceId, key: "bug", name: "缺陷" }, member.userId),
    ).rejects.toThrow("空间管理员");
  });

  it("creates a type with roles, fields and a template that starts as a draft", async () => {
    await run("workItemType.create", { id: typeId, spaceId, key: "bug", name: "缺陷" });
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" });
    await run("roleDef.create", { id: `${typeId}/role/qa`, typeId, key: "qa", name: "测试" });
    await run("fieldDef.create", {
      id: `${typeId}/field/needQa`,
      typeId,
      key: "needQa",
      name: "需要测试",
      dataType: "select",
      options: [
        { value: "是", label: "是" },
        { value: "否", label: "否" },
      ],
    });
    await run("flowTemplate.create", { id: templateId, typeId, key: "default", name: "默认流程" });

    const versions = await services.database.db
      .select()
      .from(schema.flowVersion)
      .where(eq(schema.flowVersion.templateId, templateId));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, publishedAt: null });
  });

  it("refuses to publish a draft that references a missing role", async () => {
    await run("flowTemplate.saveDraft", { templateId, definition: definition("pm") });
    await expect(run("flowTemplate.publish", { versionId: `${templateId}/v1` })).rejects.toThrow(
      "负责角色「pm」不存在",
    );
  });

  it("publishes a valid draft, and work items use it", async () => {
    await run("flowTemplate.saveDraft", { templateId, definition: definition("dev") });
    await run("flowTemplate.publish", { versionId: `${templateId}/v1` });
    const [template] = await services.database.db
      .select()
      .from(schema.flowTemplate)
      .where(eq(schema.flowTemplate.id, templateId));
    expect(template?.currentVersionId).toBe(`${templateId}/v1`);

    const id = randomUUID();
    await run("workItem.create", {
      id,
      typeId,
      name: "登录报错",
      fields: { needQa: "否" },
      roles: { dev: [member.userId] },
    });
    const nodes = await services.database.db
      .select()
      .from(schema.nodeInstance)
      .where(eq(schema.nodeInstance.workItemId, id));
    const state = Object.fromEntries(nodes.map((n) => [n.nodeKey, [n.state, n.owners]]));
    expect(state).toEqual({
      start: ["completed", []],
      fix: ["inProgress", [member.userId]],
      verify: ["skipped", []],
    });
  });

  it("editing a published template opens a new draft and leaves the published version alone", async () => {
    await run("flowTemplate.saveDraft", { templateId, definition: definition("qa") });
    const versions = await services.database.db
      .select()
      .from(schema.flowVersion)
      .where(eq(schema.flowVersion.templateId, templateId))
      .orderBy(schema.flowVersion.version);
    expect(versions.map((v) => [v.version, v.publishedAt !== null, v.definition.nodes[1]?.ownerRoles])).toEqual([
      [1, true, ["dev"]],
      [2, false, ["qa"]],
    ]);
    await expect(run("flowTemplate.publish", { versionId: `${templateId}/v1` })).rejects.toThrow("已经发布过");
  });
});

describe("automation rules", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let typeId: string;
  const { F } = oemV289;

  beforeAll(async () => {
    admin = await signUp(`auto-admin-${spaceId}@example.com`);
    member = await signUp(`auto-member-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "自动化" }, admin.userId);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    ({ typeId } = await importOemTemplate(services.database.db, spaceId));
  });

  async function createItem() {
    const id = randomUUID();
    await services.zero.run(
      "workItem.create",
      { id, typeId, name: "新品 X", fields: { [F.needPhaseOut]: "是" }, roles: {} },
      admin.userId,
    );
    return id;
  }
  const eventsOf = (workItemId: string) =>
    services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, workItemId))
      .orderBy(schema.eventLog.id);
  const runsOf = (ruleId: string) =>
    services.database.db.select().from(schema.automationRun).where(eq(schema.automationRun.ruleId, ruleId));

  it("only lets space admins manage rules", async () => {
    const rule = {
      id: randomUUID(),
      spaceId,
      name: "x",
      trigger: { kind: "workItemCreated" },
      actions: [{ type: "setField", field: F.linkedSku, value: "A" }],
    };
    await expect(services.zero.run("automation.create", rule, member.userId)).rejects.toThrow("管理员");
    await expect(services.zero.run("automation.create", { ...rule, actions: [] }, admin.userId)).rejects.toThrow(
      "至少要有一个动作",
    );
  });

  it("runs a matching rule once, as its creator, and its own writes do not trigger rules again", async () => {
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "需求立项提案开始时填 SKU",
        trigger: { kind: "nodeStarted", typeId, node: "doing" },
        condition: { kind: "equal", field: F.needPhaseOut, value: "是" },
        actions: [{ type: "setField", field: F.linkedSku, value: "SKU-AUTO" }],
      },
      admin.userId,
    );
    const id = await createItem();
    const started = (await eventsOf(id)).find((e) => e.kind === "nodeStarted" && e.payload.node === "doing");
    if (!started) throw new Error("没有 nodeStarted 事件");
    // 其他事件（比如 workItemCreated）不触发这条规则
    const created = (await eventsOf(id)).find((e) => e.kind === "workItemCreated");
    expect(await matchRules(services.database, created?.id as number)).not.toContain(ruleId);
    expect(await matchRules(services.database, started.id)).toEqual([ruleId]);

    const runner = createMutatorRunner(services.database);
    expect(await runRule(runner, ruleId, started.id, "wf-1")).toBe("succeeded");
    const [value] = await services.database.db
      .select()
      .from(schema.fieldValue)
      .where(and(eq(schema.fieldValue.workItemId, id), eq(schema.fieldValue.fieldKey, F.linkedSku)));
    expect(value?.value).toBe("SKU-AUTO");

    const changed = (await eventsOf(id)).at(-1);
    expect(changed).toMatchObject({ kind: "fieldChanged", actor: admin.userId, causedBy: started.id });
    expect(await matchRules(services.database, changed?.id as number)).toEqual([]);

    // 重试不会重复执行
    expect(await runRule(runner, ruleId, started.id, "wf-1")).toBe("succeeded");
    expect(await runsOf(ruleId)).toHaveLength(1);
    expect((await eventsOf(id)).filter((e) => e.kind === "fieldChanged")).toHaveLength(1);

    // 停用后不再匹配
    await services.zero.run(
      "automation.update",
      {
        id: ruleId,
        name: "需求立项提案开始时填 SKU",
        enabled: false,
        trigger: { kind: "nodeStarted", typeId, node: "doing" },
        actions: [{ type: "setField", field: F.linkedSku, value: "SKU-AUTO" }],
      },
      admin.userId,
    );
    expect(await matchRules(services.database, started.id)).toEqual([]);
  });

  it("records a failed run and rolls back every action when one is refused", async () => {
    const ruleId = randomUUID();
    await services.zero.run(
      "automation.create",
      {
        id: ruleId,
        spaceId,
        name: "创建后填 SKU 并完成财务分析",
        trigger: { kind: "workItemCreated" },
        actions: [
          { type: "setField", field: F.linkedSku, value: "SKU-ROLLBACK" },
          { type: "confirmNode", node: "state_51" },
        ],
      },
      admin.userId,
    );
    const id = await createItem();
    const created = (await eventsOf(id)).find((e) => e.kind === "workItemCreated");
    expect(await matchRules(services.database, created?.id as number)).toContain(ruleId);
    const runner = createMutatorRunner(services.database);
    expect(await runRule(runner, ruleId, created?.id as number, "wf-2")).toBe("failed");
    const [run] = await runsOf(ruleId);
    expect(run).toMatchObject({ status: "failed", workflowId: "wf-2" });
    expect(run?.error).toBeTruthy();
    const values = await services.database.db
      .select()
      .from(schema.fieldValue)
      .where(and(eq(schema.fieldValue.workItemId, id), eq(schema.fieldValue.fieldKey, F.linkedSku)));
    expect(values).toEqual([]);

    await services.zero.run("automation.delete", { id: ruleId }, admin.userId);
    expect(await runsOf(ruleId)).toEqual([]);
  });
});

describe("saved views", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };

  beforeAll(async () => {
    admin = await signUp(`view-admin-${spaceId}@example.com`);
    member = await signUp(`view-member-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "视图" }, admin.userId);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
  });

  const viewsOf = () =>
    services.database.db.select().from(schema.savedView).where(eq(schema.savedView.spaceId, spaceId));

  it("lets members save views with only the conditions that have values", async () => {
    const id = randomUUID();
    await services.zero.run(
      "view.create",
      { id, spaceId, name: "进行中", filter: { statuses: ["inProgress"], typeIds: [] } },
      member.userId,
    );
    expect(await viewsOf()).toMatchObject([{ id, name: "进行中", filter: { statuses: ["inProgress"] } }]);
    expect((await viewsOf())[0]?.filter).not.toHaveProperty("typeIds");
  });

  it("refuses outsiders, and only the creator or an admin can delete", async () => {
    const outsider = await signUp(`view-outsider-${randomUUID()}@example.com`);
    await expect(
      services.zero.run("view.create", { id: randomUUID(), spaceId, name: "x", filter: {} }, outsider.userId),
    ).rejects.toThrow("不是空间成员");

    const id = randomUUID();
    await services.zero.run("view.create", { id, spaceId, name: "管理员的", filter: {} }, admin.userId);
    await expect(services.zero.run("view.delete", { id }, member.userId)).rejects.toThrow("创建人或空间管理员");
    const [mine] = await viewsOf();
    await services.zero.run("view.delete", { id: mine?.id as string }, admin.userId);
    await services.zero.run("view.delete", { id }, admin.userId);
    expect(await viewsOf()).toEqual([]);
  });
});

describe("comments and notifications", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let itemId: string;
  const { F } = oemV289;

  beforeAll(async () => {
    admin = await signUp(`note-admin-${spaceId}@example.com`);
    member = await signUp(`note-member-${spaceId}@example.com`);
    await services.zero.run("space.create", { id: spaceId, name: "通知" }, admin.userId);
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    const { typeId } = await importOemTemplate(services.database.db, spaceId);
    itemId = randomUUID();
    await services.zero.run(
      "workItem.create",
      { id: itemId, typeId, name: "新品 N", fields: { [F.needPhaseOut]: "是" }, roles: { NPD: [member.userId] } },
      admin.userId,
    );
  });

  const eventsOf = () =>
    services.database.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.workItemId, itemId))
      .orderBy(schema.eventLog.id);
  const inbox = (userId: string) =>
    services.database.db.select().from(schema.notification).where(eq(schema.notification.userId, userId));

  it("tells a node's owners when it starts", async () => {
    const started = (await eventsOf()).find((e) => e.kind === "nodeStarted" && e.payload.node === "doing");
    expect(await notify(services.database, started?.id as number)).toBeGreaterThan(0);
    expect(await inbox(member.userId)).toMatchObject([
      { kind: "nodeAssigned", workItemId: itemId, text: "「新品 N」的节点「需求立项提案」轮到你了", readAt: null },
    ]);
  });

  it("posts a comment, notifies the people it mentions once, and only space members can be mentioned", async () => {
    const outsider = await signUp(`note-outsider-${randomUUID()}@example.com`);
    await expect(
      services.zero.run(
        "comment.create",
        { id: randomUUID(), workItemId: itemId, body: "看一下", mentions: [outsider.userId] },
        admin.userId,
      ),
    ).rejects.toThrow("只能提及空间成员");
    await expect(
      services.zero.run(
        "comment.create",
        { id: randomUUID(), workItemId: itemId, body: "x", mentions: [] },
        outsider.userId,
      ),
    ).rejects.toThrow("没有权限");

    const id = randomUUID();
    await services.zero.run(
      "comment.create",
      { id, workItemId: itemId, body: "@成员 看一下配方", mentions: [member.userId, admin.userId] },
      admin.userId,
    );
    const [saved] = await services.database.db.select().from(schema.comment).where(eq(schema.comment.id, id));
    expect(saved).toMatchObject({ authorId: admin.userId, mentions: [member.userId] });
    const event = (await eventsOf()).at(-1);
    expect(event).toMatchObject({ kind: "commentAdded", payload: { commentId: id, mentions: [member.userId] } });

    await notify(services.database, event?.id as number);
    await notify(services.database, event?.id as number);
    const mentioned = (await inbox(member.userId)).filter((n) => n.kind === "mentioned");
    expect(mentioned).toHaveLength(1);
    expect(mentioned[0]?.text).toContain("评论里提到了你");
    expect(await inbox(admin.userId)).toEqual([]);
  });

  it("marks only your own notifications read", async () => {
    const ids = (await inbox(member.userId)).map((n) => n.id);
    await services.zero.run("notification.markRead", { ids }, admin.userId);
    expect((await inbox(member.userId)).every((n) => n.readAt === null)).toBe(true);
    await services.zero.run("notification.markRead", { ids }, member.userId);
    expect((await inbox(member.userId)).every((n) => n.readAt !== null)).toBe(true);
  });
});

describe("sub-items driving a node", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const projectType = `${spaceId}/project`;
  const taskType = `${spaceId}/task`;
  const parentId = randomUUID();

  async function defineType(typeId: string, key: string, name: string, nodes: unknown[], edges: unknown[]) {
    await run("workItemType.create", { id: typeId, spaceId, key, name });
    await run("roleDef.create", { id: `${typeId}/role/owner`, typeId, key: "owner", name: "负责人" });
    await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认流程" });
    await run("flowTemplate.saveDraft", {
      templateId: `${typeId}/default`,
      definition: { key, version: 0, nodes, edges },
    });
    await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` });
  }
  const nodeState = async (workItemId: string, nodeKey: string) =>
    (
      await services.database.db
        .select()
        .from(schema.nodeInstance)
        .where(and(eq(schema.nodeInstance.workItemId, workItemId), eq(schema.nodeInstance.nodeKey, nodeKey)))
    )[0]?.state;
  /** worker 收到子工作项完成事件时做的事。 */
  async function cascade(childId: string) {
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, childId), eq(schema.eventLog.kind, "workItemCompleted")));
    const runner = createMutatorRunner(services.database);
    for (const e of events) await cascadeSubItems(runner, e.id);
  }

  beforeAll(async () => {
    admin = await signUp(`sub-admin-${spaceId}@example.com`);
    member = await signUp(`sub-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "子工作项" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    await defineType(
      projectType,
      "project",
      "项目",
      [
        { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
        { key: "build", name: "开发", completion: "subItemDriven", ownerRoles: ["owner"] },
        { key: "accept", name: "验收", completion: "singleConfirm", ownerRoles: ["owner"] },
      ],
      [
        { from: "start", to: "build" },
        { from: "build", to: "accept" },
      ],
    );
    await defineType(
      taskType,
      "task",
      "任务",
      [
        { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
        { key: "work", name: "处理", completion: "singleConfirm", ownerRoles: ["owner"] },
      ],
      [{ from: "start", to: "work" }],
    );
    await run("workItem.create", {
      id: parentId,
      typeId: projectType,
      name: "官网改版",
      fields: {},
      roles: { owner: [member.userId] },
    });
  });

  it("only creates sub-items under an in-progress sub-item-driven node", async () => {
    await expect(
      run("workItem.createSubItem", { id: randomUUID(), parentId, nodeKey: "accept", typeId: taskType, name: "x" }),
    ).rejects.toThrow("不是由子工作项驱动");
    const outsider = await signUp(`sub-outsider-${randomUUID()}@example.com`);
    await expect(
      run(
        "workItem.createSubItem",
        { id: randomUUID(), parentId, nodeKey: "build", typeId: taskType, name: "x" },
        outsider.userId,
      ),
    ).rejects.toThrow("没有权限");
    // 子工作项驱动的节点，负责人不能手动确认
    await expect(run("node.confirm", { workItemId: parentId, nodeKey: "build" }, member.userId)).rejects.toThrow(
      "只有超管可以手动完成",
    );
  });

  it("completes the parent node once every sub-item is done, and then starts the next node", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    await run("workItem.createSubItem", { id: a, parentId, nodeKey: "build", typeId: taskType, name: "首页" });
    await run("workItem.createSubItem", { id: b, parentId, nodeKey: "build", typeId: taskType, name: "详情页" });

    const relations = await services.database.db
      .select()
      .from(schema.relation)
      .where(eq(schema.relation.fromId, parentId));
    expect(relations.map((r) => [r.toId, r.parentNodeKey, r.relationDefId]).sort()).toEqual(
      [
        [a, "build", null],
        [b, "build", null],
      ].sort(),
    );
    // 子工作项的角色默认是父节点的负责人
    const [owners] = await services.database.db
      .select()
      .from(schema.nodeInstance)
      .where(and(eq(schema.nodeInstance.workItemId, a), eq(schema.nodeInstance.nodeKey, "work")));
    expect(owners?.owners).toEqual([member.userId]);
    const created = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, parentId), eq(schema.eventLog.kind, "subItemCreated")));
    expect(created).toHaveLength(2);

    await run("node.confirm", { workItemId: a, nodeKey: "work" }, member.userId);
    await cascade(a);
    expect(await nodeState(parentId, "build")).toBe("inProgress");

    await run("node.confirm", { workItemId: b, nodeKey: "work" }, member.userId);
    await cascade(b);
    await cascade(b); // 重试不会出错，也不会重复推进
    expect(await nodeState(parentId, "build")).toBe("completed");
    expect(await nodeState(parentId, "accept")).toBe("inProgress");
    const completed = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, parentId), eq(schema.eventLog.kind, "nodeCompleted")));
    expect(completed.filter((e) => e.payload.node === "build")).toHaveLength(1);

    await expect(
      run("workItem.createSubItem", { id: randomUUID(), parentId, nodeKey: "build", typeId: taskType, name: "x" }),
    ).rejects.toThrow("不在进行中");
  });
});

describe("custom relations between work items", () => {
  const spaceId = randomUUID();
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  const run = (name: string, args: unknown, userId = admin.userId) => services.zero.run(name, args, userId);
  const needType = `${spaceId}/need`;
  const skuType = `${spaceId}/sku`;
  const [need, skuA, skuB, otherNeed] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const linksOf = (fromId: string) =>
    services.database.db.select().from(schema.relation).where(eq(schema.relation.fromId, fromId));

  beforeAll(async () => {
    admin = await signUp(`rel-admin-${spaceId}@example.com`);
    member = await signUp(`rel-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "关联" });
    await services.database.db.insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    for (const [typeId, key, name] of [
      [needType, "need", "需求"],
      [skuType, "sku", "SKU"],
    ] as const) {
      await run("workItemType.create", { id: typeId, spaceId, key, name });
      await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认" });
      await run("flowTemplate.saveDraft", {
        templateId: `${typeId}/default`,
        definition: {
          key,
          version: 0,
          nodes: [
            { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
            { key: "do", name: "处理", completion: "singleConfirm", ownerRoles: [] },
          ],
          edges: [{ from: "start", to: "do" }],
        },
      });
      await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` });
    }
    for (const [id, typeId, name] of [
      [need, needType, "新需求"],
      [otherNeed, needType, "另一个需求"],
      [skuA, skuType, "SKU-A"],
      [skuB, skuType, "SKU-B"],
    ] as const)
      await run("workItem.create", { id, typeId, name, fields: {}, roles: {} });
  });

  it("only lets space admins define relations, between types of the same space", async () => {
    await expect(
      run(
        "relationDef.create",
        { id: randomUUID(), fromTypeId: needType, toTypeId: skuType, name: "关联 SKU", cardinality: "many" },
        member.userId,
      ),
    ).rejects.toThrow("空间管理员");
    await run("relationDef.create", {
      id: `${needType}/rel/skus`,
      fromTypeId: needType,
      toTypeId: skuType,
      name: "关联 SKU",
      cardinality: "many",
    });
    await run("relationDef.create", {
      id: `${needType}/rel/main`,
      fromTypeId: needType,
      toTypeId: skuType,
      name: "主 SKU",
      cardinality: "one",
    });
    await expect(
      run("relationDef.create", {
        id: randomUUID(),
        fromTypeId: needType,
        toTypeId: skuType,
        name: "关联 SKU",
        cardinality: "many",
      }),
    ).rejects.toThrow("已经存在");
  });

  it("links items of the right types, once each, and replaces a single relation", async () => {
    const add = (relationDefId: string, toId: string, userId = member.userId) =>
      run("relation.add", { id: randomUUID(), relationDefId, fromId: need, toId }, userId);
    await add(`${needType}/rel/skus`, skuA);
    await add(`${needType}/rel/skus`, skuB);
    await expect(add(`${needType}/rel/skus`, skuA)).rejects.toThrow("已经关联过");
    await expect(add(`${needType}/rel/skus`, otherNeed)).rejects.toThrow("对应类型");
    const outsider = await signUp(`rel-outsider-${randomUUID()}@example.com`);
    await expect(add(`${needType}/rel/skus`, skuA, outsider.userId)).rejects.toThrow("没有权限");

    await add(`${needType}/rel/main`, skuA);
    await add(`${needType}/rel/main`, skuB);
    const links = await linksOf(need);
    expect(links.map((r) => [r.relationDefId, r.toId]).sort()).toEqual(
      [
        [`${needType}/rel/skus`, skuA],
        [`${needType}/rel/skus`, skuB],
        [`${needType}/rel/main`, skuB],
      ].sort(),
    );
    const events = await services.database.db
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, need), eq(schema.eventLog.kind, "relationAdded")));
    expect(events.at(-1)?.payload).toEqual({ relationDefId: `${needType}/rel/main`, toId: skuB, replaced: [skuA] });
  });

  it("removes one relation, and deleting a definition removes its relations", async () => {
    const main = (await linksOf(need)).find((r) => r.relationDefId === `${needType}/rel/main`);
    await run("relation.remove", { id: main?.id }, member.userId);
    expect((await linksOf(need)).filter((r) => r.relationDefId === `${needType}/rel/main`)).toEqual([]);

    await expect(run("relationDef.delete", { id: `${needType}/rel/skus` }, member.userId)).rejects.toThrow(
      "空间管理员",
    );
    await run("relationDef.delete", { id: `${needType}/rel/skus` });
    expect(await linksOf(need)).toEqual([]);
  });
});

describe("node tasks and completion forms", () => {
  const spaceId = randomUUID();
  const typeId = `${spaceId}/req`;
  let admin: { cookie: string; userId: string };
  let member: { cookie: string; userId: string };
  let itemId: string;
  const run = (name: string, args: unknown, userId = member.userId) => services.zero.run(name, args, userId);
  const db = () => services.database.db;
  const tasksOf = () =>
    db().select().from(schema.nodeTask).where(eq(schema.nodeTask.workItemId, itemId)).orderBy(schema.nodeTask.id);
  const nodeState = async (nodeKey: string) =>
    (
      await db()
        .select()
        .from(schema.nodeInstance)
        .where(eq(schema.nodeInstance.id, `${itemId}/${nodeKey}`))
    )[0]?.state;

  beforeAll(async () => {
    admin = await signUp(`task-admin-${spaceId}@example.com`);
    member = await signUp(`task-member-${spaceId}@example.com`);
    await run("space.create", { id: spaceId, name: "子任务" }, admin.userId);
    await db().insert(schema.spaceMember).values({ spaceId, userId: member.userId });
    await run("workItemType.create", { id: typeId, spaceId, key: "req", name: "需求" }, admin.userId);
    await run("roleDef.create", { id: `${typeId}/role/dev`, typeId, key: "dev", name: "开发" }, admin.userId);
    for (const key of ["版本号", "备注"])
      await run(
        "fieldDef.create",
        { id: `${typeId}/field/${key}`, typeId, key, name: key, dataType: "text" },
        admin.userId,
      );
    await run("flowTemplate.create", { id: `${typeId}/default`, typeId, key: "default", name: "默认" }, admin.userId);
    await run(
      "flowTemplate.saveDraft",
      {
        templateId: `${typeId}/default`,
        definition: {
          key: "default",
          version: 0,
          nodes: [
            { key: "start", name: "开始", completion: "auto", ownerRoles: [] },
            {
              key: "dev",
              name: "开发",
              completion: "singleConfirm",
              ownerRoles: ["dev"],
              tasks: ["写代码", "自测"],
              form: [{ field: "版本号", required: true }, { field: "备注" }],
            },
            { key: "done", name: "上线", completion: "singleConfirm", ownerRoles: ["dev"] },
          ],
          edges: [
            { from: "start", to: "dev" },
            { from: "dev", to: "done" },
          ],
        },
      },
      admin.userId,
    );
    await run("flowTemplate.publish", { versionId: `${typeId}/default/v1` }, admin.userId);
    itemId = randomUUID();
    await run("workItem.create", { id: itemId, typeId, name: "导出报表", fields: {}, roles: { dev: [member.userId] } });
  });

  it("refuses to publish a form that uses a missing field", async () => {
    const templateId = `${typeId}/broken`;
    await run("flowTemplate.create", { id: templateId, typeId, key: "broken", name: "坏的" }, admin.userId);
    await run(
      "flowTemplate.saveDraft",
      {
        templateId,
        definition: {
          key: "broken",
          version: 0,
          nodes: [{ key: "a", name: "A", completion: "singleConfirm", ownerRoles: [], form: [{ field: "不存在" }] }],
          edges: [],
        },
      },
      admin.userId,
    );
    await expect(run("flowTemplate.publish", { versionId: `${templateId}/v1` }, admin.userId)).rejects.toThrow(
      "完成表单用到的字段「不存在」不存在",
    );
  });

  it("creates the template's preset tasks with the work item", async () => {
    expect((await tasksOf()).map((t) => [t.nodeKey, t.name, t.done])).toEqual([
      ["dev", "写代码", false],
      ["dev", "自测", false],
    ]);
  });

  it("adds, assigns and ticks tasks, and tells the assignee", async () => {
    const outsider = await signUp(`task-outsider-${randomUUID()}@example.com`);
    const id = randomUUID();
    await expect(
      run("task.create", { id, workItemId: itemId, nodeKey: "dev", name: "x", assigneeId: outsider.userId }),
    ).rejects.toThrow("空间成员");
    await expect(
      run("task.create", { id, workItemId: itemId, nodeKey: "dev", name: "x" }, outsider.userId),
    ).rejects.toThrow("没有权限");

    await run(
      "task.create",
      { id, workItemId: itemId, nodeKey: "dev", name: "写文档", assigneeId: member.userId, due: "2026-11-02" },
      admin.userId,
    );
    const created = (await tasksOf()).find((t) => t.id === id);
    expect(created).toMatchObject({ assigneeId: member.userId, createdBy: admin.userId });
    expect(created?.dueDate?.toISOString()).toBe("2026-11-02T00:00:00.000Z");

    const [event] = await db()
      .select()
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.workItemId, itemId), eq(schema.eventLog.kind, "taskCreated")));
    await notify(services.database, event?.id as number);
    const inbox = await db().select().from(schema.notification).where(eq(schema.notification.userId, member.userId));
    expect(inbox.map((n) => [n.kind, n.text])).toContainEqual([
      "taskAssigned",
      "task-admin-" + spaceId + " 在「导出报表」给你分配了子任务「写文档」",
    ]);

    await run("task.update", { id, name: "写使用文档", due: null });
    expect((await tasksOf()).find((t) => t.id === id)).toMatchObject({ name: "写使用文档", dueDate: null });
  });

  it("blocks the confirm until every task is done and the form's required fields are filled", async () => {
    await expect(run("node.confirm", { workItemId: itemId, nodeKey: "dev" })).rejects.toThrow("3 个子任务没完成");
    for (const t of await tasksOf()) await run("task.setDone", { id: t.id, done: true });
    expect((await tasksOf()).every((t) => t.done && t.doneBy === member.userId)).toBe(true);

    await expect(run("node.confirm", { workItemId: itemId, nodeKey: "dev" })).rejects.toThrow("必填项");
    await expect(
      run("node.confirm", { workItemId: itemId, nodeKey: "dev", values: { 版本号: "1.0", 其它: "x" } }),
    ).rejects.toThrow("不在节点「开发」的完成表单里");
    // 被拒绝的确认什么也没写
    expect(await db().select().from(schema.fieldValue).where(eq(schema.fieldValue.workItemId, itemId))).toEqual([]);

    await run("node.confirm", { workItemId: itemId, nodeKey: "dev", values: { 版本号: "1.0", 备注: "首版" } });
    expect(await nodeState("dev")).toBe("completed");
    expect(await nodeState("done")).toBe("inProgress");
    const values = await db().select().from(schema.fieldValue).where(eq(schema.fieldValue.workItemId, itemId));
    expect(Object.fromEntries(values.map((v) => [v.fieldKey, v.value]))).toEqual({ 版本号: "1.0", 备注: "首版" });
    const kinds = (
      await db().select().from(schema.eventLog).where(eq(schema.eventLog.workItemId, itemId)).orderBy(schema.eventLog.id)
    ).map((e) => e.kind);
    expect(kinds.slice(-4)).toEqual(["fieldChanged", "fieldChanged", "nodeCompleted", "nodeStarted"]);
  });

  it("freezes a completed node's tasks until the node is rolled back", async () => {
    const [task] = await tasksOf();
    await expect(run("task.setDone", { id: task?.id, done: false })).rejects.toThrow("已完成");
    await run("node.rollback", { workItemId: itemId, nodeKey: "dev" });
    await run("task.setDone", { id: task?.id, done: false });
    await run("task.delete", { id: task?.id });
    expect((await tasksOf()).map((t) => t.id)).not.toContain(task?.id);
  });
});
