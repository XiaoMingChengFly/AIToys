import { expect, test } from "@playwright/test";

test("the space gantt shows one bar per work item and expands into its nodes", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`space-gantt-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("空间名称").fill(`排期总览 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`排期总览 ${suffix}`).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pascal" })).toBeVisible();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  for (const name of ["新品 E", "新品 F"]) {
    await page.getByLabel("项目名称").fill(name);
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("link", { name: "返回空间" }).click();
  }

  await page.getByRole("tab", { name: "甘特图" }).click();
  const chart = page.getByRole("img", { name: "甘特图" });
  await expect(chart).toBeVisible();
  const itemE = page.getByRole("button", { name: "新品 E" });
  await expect(itemE).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "新品 F" })).toBeVisible();
  await expect(page.getByTitle("需求立项提案")).toHaveCount(0);

  await itemE.click();
  await expect(itemE).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTitle("需求立项提案")).toHaveCount(1);
  await expect(page.getByTitle("财务分析（需求立项）")).toBeVisible();

  await itemE.click();
  await expect(page.getByTitle("需求立项提案")).toHaveCount(0);
});
