import { expect, request, test } from "@playwright/test";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

test("filter the work item list and save the filter as a view", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const colleague = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { origin: "http://localhost:5173" },
  });
  const signUp = await colleague.post("/api/auth/sign-up/email", {
    data: { email: `lin-view-${suffix}@example.com`, password: "correct-horse-battery", name: "Lin" },
  });
  expect(signUp.ok()).toBe(true);

  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`views-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("空间名称").fill(`视图 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`视图 ${suffix}`).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pascal" })).toBeVisible();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await page.getByLabel("按邮箱添加成员").fill(`lin-view-${suffix}@example.com`);
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Lin" })).toBeVisible();

  // 新品 H 只有 Pascal；新品 I 的开发加上 Lin
  for (const [name, withLin] of [
    ["新品 H", false],
    ["新品 I", true],
  ] as const) {
    await page.getByLabel("项目名称").fill(name);
    if (withLin) {
      await page.getByText("角色和负责人").click();
      await page.getByRole("button", { name: "开发：Lin" }).click();
    }
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("link", { name: "返回空间" }).click();
  }

  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: "新品 H" })).toBeVisible();
  await expect(table.getByRole("link", { name: "新品 I" })).toBeVisible();

  await page.getByLabel("按参与人筛选").selectOption("Lin");
  await expect(table.getByRole("link", { name: "新品 H" })).toHaveCount(0);
  await expect(table.getByRole("link", { name: "新品 I" })).toBeVisible();

  await page.getByLabel("视图名称").fill("Lin 参与的");
  await page.getByRole("button", { name: "保存为视图" }).click();
  const views = page.getByRole("tablist", { name: "视图" });
  await expect(views.getByRole("tab", { name: "Lin 参与的" })).toHaveAttribute("aria-selected", "true");

  await views.getByRole("tab", { name: "全部" }).click();
  await expect(table.getByRole("link", { name: "新品 H" })).toBeVisible();
  await views.getByRole("tab", { name: "Lin 参与的" }).click();
  await expect(table.getByRole("link", { name: "新品 H" })).toHaveCount(0);
  await expect(page.getByLabel("按参与人筛选")).toHaveValue(/.+/);

  // 状态筛选：没有已完成的工作项
  await page.getByLabel("按状态筛选").selectOption("已完成");
  await expect(page.getByText("没有符合条件的工作项。")).toBeVisible();

  await views.getByRole("button", { name: "删除视图 Lin 参与的" }).click();
  await expect(views.getByRole("tab", { name: "Lin 参与的" })).toHaveCount(0);
});
