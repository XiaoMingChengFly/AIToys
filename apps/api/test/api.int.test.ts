import { randomUUID } from "node:crypto";
import { schema } from "@fp/db";
import { createTestDatabase } from "@fp/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createServices, type Services } from "../src/app.ts";

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
