import { expect, test } from "@playwright/test";

test("a sub-item-driven node completes once its sub-items are done", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`sub-items-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("空间名称").fill(`子工作项 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`子工作项 ${suffix}`).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pascal" })).toBeVisible();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();

  // 新品走到“需求评审”：它由子工作项驱动
  await page.getByLabel("项目名称").fill("新品 S");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: "新品 S" })).toBeVisible();
  const panel = page.locator("aside");
  await panel.getByLabel("关联需求SKU流程").fill("SKU-S");
  await panel.getByLabel("关联需求SKU流程").blur();
  await panel.getByRole("region", { name: "需求立项提案" }).getByRole("button", { name: "确认完成" }).click();
  await panel.getByRole("region", { name: "财务分析（需求立项）" }).getByRole("button", { name: "确认完成" }).click();
  const review = panel.getByRole("region", { name: "需求评审" });
  await expect(review).toContainText("还没有子工作项");

  // 配一个只有一个节点的“任务”类型，用来做子工作项
  await page.getByRole("link", { name: "返回空间" }).click();
  await page.getByLabel("新类型名称").fill("任务");
  await page.getByRole("button", { name: "新建类型" }).click();
  await page.getByRole("link", { name: "任务", exact: true }).click();
  await page.getByLabel("新角色名称").fill("处理人");
  await page.getByRole("button", { name: "添加角色" }).click();
  await page.getByLabel("新模板名称").fill("任务流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "任务流程" }).click();
  await page.locator(".react-flow__node", { hasText: "开始" }).click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await panel.getByLabel("节点名称").fill("处理");
  await panel.getByLabel("处理人").check();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.getByRole("link", { name: "返回任务" }).click();
  await page.getByRole("link", { name: "返回空间" }).click();
  await page.getByRole("link", { name: "新品 S" }).click();

  // 在需求评审下建子工作项
  await review.getByLabel("子工作项类型").selectOption({ label: "任务" });
  await review.getByLabel("子工作项名称").fill("包材打样");
  await review.getByRole("button", { name: "新建" }).click();
  const children = review.getByRole("list", { name: "需求评审的子工作项" });
  await expect(children.getByRole("listitem")).toHaveText(["包材打样进行中"]);

  // 子工作项完成后，worker 自动完成需求评审，流程走到下一个节点
  await children.getByRole("link", { name: "包材打样" }).click();
  await expect(page.getByRole("heading", { name: "包材打样" })).toBeVisible();
  await panel.getByRole("region", { name: "处理" }).getByRole("button", { name: "确认完成" }).click();
  await expect(page.locator("header")).toContainText("已完成");
  await page.getByRole("link", { name: "上级工作项：新品 S" }).click();
  await expect(panel.getByRole("region", { name: "产品入库预排期" })).toBeVisible({ timeout: 30_000 });
  await expect(review).toHaveCount(0);
});
