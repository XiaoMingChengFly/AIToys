import { expect, test } from "@playwright/test";
import { createItem, createSpace, openItems, openSettings, signUp } from "./helpers";

test("admins group, order and hide fields on the detail page", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `layout-${suffix}@example.com`);
  await createSpace(page, `布局 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("缺陷");
  await page.getByLabel("流程方式").selectOption("state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await page.getByRole("main").getByRole("link", { name: /^缺陷/ }).click();
  for (const name of ["严重程度", "复现步骤", "预计工时", "内部备注"]) {
    await page.getByLabel("新字段名称").fill(name);
    await page.locator("select[name=dataType]").selectOption("text");
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();

  // 默认所有字段一组；改成「基本信息」「排期」两组，备注不显示，排期默认收起
  const layout = page.getByRole("group").filter({ has: page.getByRole("button", { name: "保存布局" }) });
  await layout.getByLabel("分组名称").fill("基本信息");
  await layout.getByRole("button", { name: "添加分组" }).click();
  await layout.getByLabel("分组名称").nth(1).fill("排期");
  await layout.getByLabel("预计工时所在分组").selectOption({ label: "排期" });
  await layout.getByLabel("内部备注所在分组").selectOption({ label: "不显示" });
  await layout.getByRole("region", { name: "分组 排期" }).getByLabel("默认收起").check();
  await layout.getByRole("button", { name: "上移复现步骤" }).click();
  await layout.getByRole("button", { name: "保存布局" }).click();
  await expect(layout.getByRole("button", { name: "保存布局" })).toBeDisabled();
  await expect(layout.getByRole("region", { name: "不显示的字段" })).toContainText("内部备注");

  // 新建表单按布局排，隐藏的字段不出现
  await openItems(page);
  await createItem(page, "登录页白屏", {
    label: "缺陷名称",
    before: async (dialog) => {
      await expect(dialog.getByLabel("内部备注")).toHaveCount(0);
      await dialog.getByLabel("严重程度").fill("高");
    },
  });

  const basic = page.getByRole("region", { name: "基本信息" });
  await expect(basic.getByRole("textbox")).toHaveCount(2);
  await expect(basic.getByRole("textbox").first()).toHaveAccessibleName("复现步骤");
  await expect(basic.getByLabel("严重程度")).toHaveValue("高");
  await expect(page.getByLabel("内部备注")).toHaveCount(0);
  const schedule = page.getByRole("region", { name: "排期" });
  await expect(schedule.getByLabel("预计工时")).toHaveCount(0);
  await schedule.getByRole("button", { name: "展开排期" }).click();
  await expect(schedule.getByLabel("预计工时")).toBeVisible();
});
