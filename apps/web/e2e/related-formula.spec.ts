import { expect, test } from "@playwright/test";
import { choose, createItem, createSpace, openItems, openSettings, selectByName, signUp } from "./helpers";

test("a formula checks whether related work items exist", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `related-${suffix}@example.com`);
  await createSpace(page, `跨工作项公式 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("立项");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await page.getByRole("main").getByRole("link", { name: /^立项/ }).click();

  await page.getByLabel("新关联名称").fill("关联风险");
  await choose(page.getByLabel("关联到"), { label: "立项" });
  await page.getByRole("button", { name: "添加关联" }).click();
  await expect(page.getByRole("list", { name: "关联列表" })).toContainText("关联风险");
  await page.getByLabel("新字段名称").fill("是否存在关联风险");
  await choose(selectByName(page, "dataType"), "formula");
  await page.getByLabel("公式", { exact: true }).fill('COUNT(RELATED("关联风险")) > 0');
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: 'COUNT(RELATED("关联风险")) > 0' })).toBeVisible();

  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await openItems(page);
  await createItem(page, "包材风险", { label: "立项名称" });
  await openItems(page);
  await createItem(page, "面霜立项", { label: "立项名称" });
  const flag = page.getByRole("region", { name: "字段" }).getByLabel("是否存在关联风险");
  await expect(flag).toHaveValue("否");

  const group = page.getByRole("main").getByRole("region", { name: "关联风险" });
  await choose(group.getByLabel("添加关联风险"), { label: "包材风险" });
  await expect(flag).toHaveValue("是", { timeout: 15_000 });
});
