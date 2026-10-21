import { expect, type Page, request, test } from "@playwright/test";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

/** 注册并登录，建一个空间，导入 OEM 模板，停在空间页。 */
async function signUpWithOemSpace(page: Page, name: string, suffix: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(`${name.toLowerCase()}-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("heading", { name: "我的空间" })).toBeVisible();

  await page.getByLabel("空间名称").fill(`OEM 验收 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`OEM 验收 ${suffix}`).click();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await expect(page.getByText("新建工作项")).toBeVisible();
}

test("sign up, import OEM, create a project and see its flow", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await signUpWithOemSpace(page, "Pascal", suffix);

  await page.getByLabel("项目名称").fill("新品 A");
  await page.getByRole("button", { name: "创建" }).click();

  await expect(page.getByRole("heading", { name: "新品 A" })).toBeVisible();
  await expect(page.getByText("概念阶段")).toBeVisible();
  const panel = page.locator("aside");
  await expect(panel.getByText("需求立项提案")).toBeVisible();
  await expect(panel.getByText("负责人：Pascal")).toBeVisible();

  // 卡点：关联需求 SKU 没填时不能确认
  await panel.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("alert")).toContainText("流转条件还没满足");
  await panel.getByLabel("关联需求SKU流程").fill("SKU-001");
  await panel.getByLabel("关联需求SKU流程").blur();
  await panel.getByRole("region", { name: "需求立项提案" }).getByRole("button", { name: "确认完成" }).click();
  await expect(panel.getByText("财务分析（需求立项）")).toBeVisible();
  await expect(panel.getByRole("region", { name: "需求立项提案" })).toHaveCount(0);

  // 在流程图上选中已完成的节点，回滚到它
  await page.locator(".react-flow__node", { hasText: "需求立项提案" }).click();
  await panel.getByRole("button", { name: "回滚到此节点" }).click();
  await expect(panel.getByRole("region", { name: "需求立项提案" })).toBeVisible();
  await expect(panel.getByText("财务分析（需求立项）")).toHaveCount(0);

  // 刷新后数据仍在：来自服务端，而不只是浏览器里的乐观写入
  await page.reload();
  await expect(page.locator("aside").getByText("需求立项提案")).toBeVisible();
  await page.getByRole("link", { name: "返回空间" }).click();
  await expect(page.getByRole("link", { name: "新品 A" })).toBeVisible();
});

test("add a colleague to the space and assign them a role", async ({ page }) => {
  const suffix = `${Date.now()}`;
  // 同事用自己的账号注册（不影响当前页面的登录态）
  const colleague = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { origin: "http://localhost:5173" },
  });
  const signUp = await colleague.post("/api/auth/sign-up/email", {
    data: { email: `lin-${suffix}@example.com`, password: "correct-horse-battery", name: "Lin" },
  });
  expect(signUp.ok()).toBe(true);

  await signUpWithOemSpace(page, "Pascal", suffix);
  await page.getByLabel("按邮箱添加成员").fill(`lin-${suffix}@example.com`);
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Lin" })).toBeVisible();

  await page.getByLabel("项目名称").fill("新品 B");
  await page.getByText("角色和负责人").click();
  await page.getByRole("button", { name: "开发：Pascal" }).click();
  await page.getByRole("button", { name: "开发：Lin" }).click();
  await page.getByRole("button", { name: "创建" }).click();

  const panel = page.locator("aside");
  const proposal = panel.getByRole("region", { name: "需求立项提案" });
  await expect(proposal.getByText("负责人：Pascal、Lin")).toBeVisible();

  // 在工作项上把开发换回 Pascal，进行中的节点负责人跟着变
  await panel.getByRole("button", { name: "开发：Lin" }).click();
  await expect(proposal.getByText("负责人：Pascal", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "开发：Lin" })).toHaveAttribute("aria-pressed", "false");
});
