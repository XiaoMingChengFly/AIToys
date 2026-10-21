import { expect, request, test } from "@playwright/test";
import { API_URL, createSpace, signUp } from "./helpers";

test("a personal token calls the open API until it is deleted", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `open-api-${suffix}@example.com`);
  await createSpace(page, `接口 ${suffix}`);

  await page.getByRole("button", { name: "账号" }).click();
  await page.getByRole("menuitem", { name: "开放接口" }).click();
  await expect(page.getByRole("heading", { name: "开放接口" })).toBeVisible();
  await expect(page.getByRole("list", { name: "令牌列表" })).toContainText("还没有令牌");

  await page.getByLabel("令牌名称").fill("同步脚本");
  await page.getByRole("button", { name: "创建令牌" }).click();
  const token = await page.getByRole("region", { name: "新令牌" }).getByLabel("令牌").inputValue();
  expect(token).toMatch(/^fp_/);
  const list = page.getByRole("list", { name: "令牌列表" });
  await expect(list).toContainText("同步脚本");
  await expect(list).toContainText(token.slice(0, 10));
  await expect(list).not.toContainText(token);

  const api = await request.newContext({ baseURL: API_URL });
  const spaces = await api.get("/open-api/v1/spaces", { headers: { authorization: `Bearer ${token}` } });
  expect(spaces.ok()).toBe(true);
  expect(await spaces.json()).toEqual([expect.objectContaining({ name: `接口 ${suffix}` })]);
  await page.reload();
  await expect(list).not.toContainText("从未使用");

  await page.getByRole("button", { name: "删除令牌 同步脚本" }).click();
  await expect(list).toContainText("还没有令牌");
  const after = await api.get("/open-api/v1/spaces", { headers: { authorization: `Bearer ${token}` } });
  expect(after.status()).toBe(401);
});
