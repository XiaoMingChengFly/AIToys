import { expect, test } from "@playwright/test";

test("sign up, import OEM, create a project and see its flow", async ({ page }) => {
  const suffix = Date.now();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`pascal-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("heading", { name: "我的空间" })).toBeVisible();

  await page.getByLabel("空间名称").fill(`OEM 验收 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`OEM 验收 ${suffix}`).click();

  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await expect(page.getByText("新建项目（OEM）")).toBeVisible();

  await page.getByLabel("项目名称").fill("新品 A");
  await page.getByRole("button", { name: "创建" }).click();

  await expect(page.getByRole("heading", { name: "新品 A" })).toBeVisible();
  await expect(page.getByText("概念阶段")).toBeVisible();
  const panel = page.locator("aside");
  await expect(panel.getByText("需求立项提案")).toBeVisible();
  await expect(panel.getByText("负责人：Pascal")).toBeVisible();

  // 刷新后数据仍在：来自服务端，而不只是浏览器里的乐观写入
  await page.reload();
  await expect(page.locator("aside").getByText("需求立项提案")).toBeVisible();
  await page.getByRole("link", { name: "返回空间" }).click();
  await expect(page.getByRole("link", { name: "新品 A" })).toBeVisible();
});
