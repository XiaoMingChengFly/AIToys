import { expect, test } from "@playwright/test";

test("an automation rule fills a field on new work items through the Temporal worker", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`automation-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("空间名称").fill(`自动化 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`自动化 ${suffix}`).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pascal" })).toBeVisible();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await expect(page.getByText("新建工作项")).toBeVisible();

  // 新建规则：工作项创建后，把“关联需求SKU流程”填成 SKU-AUTO
  await page.getByRole("link", { name: "自动化" }).click();
  await expect(page.getByText("还没有自动化规则。")).toBeVisible();
  await page.getByLabel("规则名称").fill("创建后填 SKU");
  await page.getByLabel("触发时机").selectOption("工作项创建后");
  await page.getByRole("button", { name: "添加动作" }).click();
  const action = page.getByRole("group", { name: "动作 1" });
  await action.getByLabel("动作类型").selectOption("修改字段");
  await action.getByRole("combobox", { name: "字段", exact: true }).selectOption("关联需求SKU流程");
  await action.getByLabel("设为").fill("SKU-AUTO");
  await page.getByRole("button", { name: "保存规则" }).click();
  const rule = page.getByRole("region", { name: "创建后填 SKU" });
  await expect(rule).toContainText("工作项创建后，把「关联需求SKU流程」设为 SKU-AUTO");

  // 创建工作项：事件经 Outbox → Temporal → worker 执行规则，字段值同步回页面
  await page.getByRole("link", { name: `自动化 ${suffix}` }).click();
  await page.getByLabel("项目名称").fill("新品 G");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: "新品 G" })).toBeVisible();
  await expect(page.getByLabel("关联需求SKU流程")).toHaveValue("SKU-AUTO", { timeout: 30_000 });

  // 执行记录
  await page.getByRole("link", { name: "返回空间" }).click();
  await page.getByRole("link", { name: "自动化" }).click();
  await expect(rule.getByRole("list", { name: "执行记录" })).toContainText("成功");
  await expect(rule.getByRole("list", { name: "执行记录" })).toContainText("新品 G");

  // 停用后新的工作项不再被修改
  await rule.getByLabel("启用").uncheck();
  await expect(rule.getByLabel("启用")).not.toBeChecked();
});
