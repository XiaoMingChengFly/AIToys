import { dayInTimeZone, dayToIso, WorkCalendar } from "@fp/engine";
import { expect, test } from "@playwright/test";

test("a holiday in the space calendar re-plans its work items", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill("Pascal");
  await page.getByLabel("邮箱").fill(`calendar-${suffix}@example.com`);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("空间名称").fill(`日历 ${suffix}`);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByText(`日历 ${suffix}`).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pascal" })).toBeVisible();
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await page.getByLabel("项目名称").fill("新品 D");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: "新品 D" })).toBeVisible();

  const startOf = (name: string) => page.getByRole("row", { name, exact: true }).getByLabel("计划开始");
  const today = dayInTimeZone(Date.now(), "Asia/Shanghai");
  const firstDay = new WorkCalendar().onOrAfter(today);
  await page.getByRole("tab", { name: "甘特图" }).click();
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(firstDay));

  // 把需求立项提案开始的那天设成假期
  await page.getByRole("link", { name: "返回空间" }).click();
  await page.getByLabel("日历日期").fill(dayToIso(firstDay));
  await page.getByLabel("这天").selectOption("放假");
  await page.getByRole("button", { name: "加入日历" }).click();
  const holidays = page.getByRole("list", { name: "节假日" });
  await expect(holidays).toContainText(dayToIso(firstDay));

  await page.getByRole("link", { name: "新品 D" }).click();
  await page.getByRole("tab", { name: "甘特图" }).click();
  const withHoliday = new WorkCalendar({ holidays: [firstDay] });
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(withHoliday.onOrAfter(firstDay + 1)));

  // 移除假期，排期恢复
  await page.getByRole("link", { name: "返回空间" }).click();
  await holidays.getByRole("button", { name: `移除 ${dayToIso(firstDay)}` }).click();
  await expect(page.getByText("没有设置节假日")).toBeVisible();
  await page.getByRole("link", { name: "新品 D" }).click();
  await page.getByRole("tab", { name: "甘特图" }).click();
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(firstDay));
});
