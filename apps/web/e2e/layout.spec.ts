import { expect, test } from "@playwright/test";
import { choose, createItem, createSpace, openItems, openSettings, selectByName, signUp } from "./helpers";

test("admins lay out the detail page in tabs and sections, with hints and a separate create page", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `layout-${suffix}@example.com`);
  await createSpace(page, `布局 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("缺陷");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await page.getByRole("main").getByRole("link", { name: /^缺陷/ }).click();
  for (const name of ["严重程度", "复现步骤", "预计工时", "内部备注"]) {
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), "text");
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();

  const editor = page.getByRole("group").filter({ has: page.getByRole("button", { name: "保存布局" }) });
  // 默认「基本信息」页签里有一组「字段」：改名为「缺陷信息」，加一句提示，复现步骤挪到最前
  const fieldsSection = editor.getByRole("region", { name: "分组 字段" });
  await fieldsSection.getByLabel("分组名称").fill("缺陷信息");
  const section = editor.getByRole("region", { name: "分组 缺陷信息" });
  await section.getByRole("button", { name: "上移复现步骤" }).click();
  await choose(section.getByLabel("添加字段或控件"), "text:");
  await section.getByLabel("提示文字内容").fill("线上问题请先写复现步骤");
  // 内部备注不显示；新加一个「排期」页签放预计工时
  await choose(editor.getByLabel("设为不显示"), { label: "内部备注" });
  await section.getByRole("button", { name: "移除 预计工时" }).click();
  await editor.getByRole("button", { name: "添加页签" }).click();
  const newTab = editor.getByRole("region", { name: /^页签 页签/ });
  await newTab.getByLabel("页签名称").fill("排期");
  await choose(editor.getByRole("region", { name: "分组 分组 1" }).getByLabel("添加字段或控件"), {
    label: "预计工时",
  });
  await editor.getByRole("button", { name: "保存布局" }).click();
  await expect(editor.getByRole("button", { name: "保存布局" })).toBeDisabled();

  // 新建页：内部备注不出现，提示文字出现
  await openItems(page);
  await createItem(page, "登录页白屏", {
    label: "缺陷名称",
    before: async (dialog) => {
      await expect(dialog.getByLabel("内部备注")).toHaveCount(0);
      await expect(dialog.getByText("线上问题请先写复现步骤")).toBeVisible();
      await dialog.getByLabel("严重程度").fill("高");
    },
  });

  // 详情页：基本信息页签里是缺陷信息分组，排期页签里是预计工时
  const basic = page.getByRole("region", { name: "缺陷信息" });
  await expect(basic.getByRole("textbox").first()).toHaveAccessibleName("复现步骤");
  await expect(basic.getByLabel("严重程度")).toHaveValue("高");
  await expect(basic.getByText("线上问题请先写复现步骤")).toBeVisible();
  await expect(page.getByLabel("内部备注")).toHaveCount(0);
  await expect(page.getByLabel("预计工时")).toHaveCount(0);
  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: "排期" }).click();
  await expect(page.getByLabel("预计工时")).toBeVisible();
});
