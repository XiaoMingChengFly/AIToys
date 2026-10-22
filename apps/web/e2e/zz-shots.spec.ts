import { expect, test } from "@playwright/test";
test("screenshots", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const out = process.env.SHOTS ?? ".";
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("semi-preview@example.com");
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "我的空间" })).toBeVisible();
  await page.goto("/items/ada46690-1af4-4086-b0b4-6032bc83eef0");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/detail.png`, fullPage: true });
});
