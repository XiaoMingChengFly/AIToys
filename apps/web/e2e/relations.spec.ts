import { expect, test } from "@playwright/test";

test("define a relation on a type and link two work items with it", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`relations-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("空间名称").fill(`关联 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`关联 ${suffix}`).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pascal" })).toBeVisible();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();

  // 在“项目”类型上定义“前置项目”：可以关联多个项目
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.getByLabel("新关联名称").fill("前置项目");
  await page.getByLabel("关联到").selectOption({ label: "项目" });
  await page.getByRole("button", { name: "添加关联" }).click();
  await expect(page.getByRole("list", { name: "关联列表" })).toContainText("前置项目→ 项目（多个）");
  await page.getByRole("link", { name: "返回空间" }).click();

  for (const name of ["新品 A", "新品 B"]) {
    await page.getByLabel("项目名称").fill(name);
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("link", { name: "返回空间" }).click();
  }

  // 新品 B 的前置项目选新品 A
  await page.getByRole("link", { name: "新品 B" }).click();
  const group = page.locator("aside").getByRole("region", { name: "前置项目" });
  await group.getByLabel("添加前置项目").selectOption({ label: "新品 A" });
  await expect(group.getByRole("link", { name: "新品 A" })).toBeVisible();

  // 新品 A 上能看到反向关联，点回新品 B 后取消关联
  await group.getByRole("link", { name: "新品 A" }).click();
  await expect(page.getByRole("heading", { name: "新品 A" })).toBeVisible();
  const backlinks = page.locator("aside").getByRole("region", { name: "被关联" });
  await expect(backlinks).toContainText("新品 B（前置项目）");
  await backlinks.getByRole("link", { name: "新品 B" }).click();
  await expect(page.getByRole("heading", { name: "新品 B" })).toBeVisible();
  await group.getByRole("button", { name: "取消关联 新品 A" }).click();
  await expect(group.getByRole("link", { name: "新品 A" })).toHaveCount(0);

  // 刷新后仍然是取消后的状态：服务端也执行了
  await page.reload();
  await expect(group.getByLabel("添加前置项目")).toBeVisible();
  await expect(group.getByRole("link", { name: "新品 A" })).toHaveCount(0);
});
