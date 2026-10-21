import { expect, request, test } from "@playwright/test";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

test("comment with a mention, and both people get notified", async ({ page, browser }) => {
  const suffix = `${Date.now()}`;
  const linEmail = `lin-comment-${suffix}@example.com`;
  const colleague = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { origin: "http://localhost:5173" },
  });
  const signUp = await colleague.post("/api/auth/sign-up/email", {
    data: { email: linEmail, password: "correct-horse-battery", name: "Lin" },
  });
  expect(signUp.ok()).toBe(true);

  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`comments-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("空间名称").fill(`评论 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`评论 ${suffix}`).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pascal" })).toBeVisible();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await page.getByLabel("按邮箱添加成员").fill(linEmail);
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Lin" })).toBeVisible();
  await page.getByLabel("项目名称").fill("新品 J");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: "新品 J" })).toBeVisible();

  // Pascal 是需求立项提案的负责人：worker 处理 nodeStarted 事件后给他发通知
  const bell = page.getByRole("button", { name: /^通知/ });
  await expect(bell).toHaveAccessibleName(/未读/, { timeout: 30_000 });
  await bell.click();
  await expect(page.getByRole("list", { name: "通知列表" })).toContainText("「新品 J」的节点「需求立项提案」轮到你了");
  await page.getByRole("button", { name: "全部已读" }).click();
  await expect(bell).toHaveAccessibleName("通知");
  await bell.click();

  // 评论并提及 Lin
  await page.getByLabel("评论内容").fill("配方先按 A 方案走");
  await page.getByRole("button", { name: "@Lin" }).click();
  await page.getByRole("button", { name: "发表评论" }).click();
  await expect(page.getByRole("list", { name: "评论列表" })).toContainText("配方先按 A 方案走");
  await expect(page.getByLabel("评论内容")).toHaveValue("");

  // Lin 登录后看到提及通知，点开跳到工作项
  const linContext = await browser.newContext();
  const lin = await linContext.newPage();
  await lin.goto("/login");
  await lin.getByLabel("邮箱").fill(linEmail);
  await lin.getByLabel("密码").fill("correct-horse-battery");
  await lin.getByRole("button", { name: "登录", exact: true }).click();
  const linBell = lin.getByRole("button", { name: /^通知/ });
  await expect(linBell).toHaveAccessibleName("通知（1 条未读）", { timeout: 30_000 });
  await linBell.click();
  await lin.getByRole("button", { name: /Pascal 在「新品 J」的评论里提到了你/ }).click();
  await expect(lin.getByRole("heading", { name: "新品 J" })).toBeVisible();
  await expect(lin.getByRole("list", { name: "评论列表" })).toContainText("配方先按 A 方案走");
  await expect(linBell).toHaveAccessibleName("通知");
  await linContext.close();
});
