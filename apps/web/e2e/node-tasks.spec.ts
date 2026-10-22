import { expect, test } from "@playwright/test";
import { createItem, createSpace, openItems, openSettings, signUp } from "./helpers";

test("a node's tasks and completion form gate its confirm", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `tasks-${suffix}@example.com`);
  await createSpace(page, `子任务 ${suffix}`);
  await openSettings(page);

  // 类型：一个角色、一个文本字段；流程：开始 → 开发（预置子任务“自测”，完成表单要填版本号）
  await page.getByLabel("新类型名称").fill("需求");
  await page.getByRole("button", { name: "新建类型" }).click();
  await page.getByRole("main").getByRole("link", { name: /^需求/ }).click();
  await page.getByLabel("新角色名称").fill("开发");
  await page.getByRole("button", { name: "添加角色" }).click();
  await page.getByLabel("新字段名称").fill("版本号");
  await page.locator("select[name=dataType]").selectOption("text");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "版本号", exact: true })).toBeVisible();
  await page.getByLabel("新模板名称").fill("默认流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认流程" }).click();

  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const editor = page.getByRole("main");
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await editor.getByLabel("节点名称").fill("开发");
  await editor.getByLabel("开发", { exact: true }).check();
  await editor.getByLabel("添加表单字段").selectOption("版本号");
  await expect(editor.getByLabel("版本号必填")).toBeChecked();
  await editor.getByLabel("预置子任务名称").fill("自测");
  await editor.getByRole("button", { name: "添加", exact: true }).click();
  await expect(node("开发")).toContainText("有表单 · 1 个子任务");
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await openItems(page);
  await createItem(page, "导出报表", { label: "需求名称" });
  const current = page.getByRole("main").getByRole("region", { name: "开发" });
  const tasks = current.getByRole("list", { name: "开发的子任务" });
  await expect(tasks.getByText("自测")).toBeVisible();

  // 加一个子任务并指派给自己
  await current.getByLabel("给开发添加子任务").fill("写文档");
  await current.getByLabel("给开发添加子任务").press("Enter");
  await expect(tasks.getByText("写文档")).toBeVisible();
  await current.getByRole("button", { name: "写文档的负责人" }).click();
  await page.getByRole("button", { name: "Pascal" }).click();
  await expect(current.getByRole("button", { name: "写文档的负责人" })).toHaveAttribute("title", "Pascal");
  await page.keyboard.press("Escape");

  // 子任务没做完不能确认
  await current.getByRole("button", { name: "确认完成" }).click();
  await page.getByRole("dialog").getByLabel("版本号").fill("1.0");
  await page.getByRole("dialog").getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("还有 2 个子任务没完成");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  await current.getByLabel("完成子任务：自测").check();
  await current.getByLabel("完成子任务：写文档").check();
  await expect(current.getByText("2/2")).toBeVisible();

  // 填完成表单后节点完成，版本号写进字段
  await current.getByRole("button", { name: "确认完成" }).click();
  await page.getByRole("dialog").getByLabel("版本号").fill("1.0");
  await page.getByRole("dialog").getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("流程已走完。")).toBeVisible();
  await expect(page.getByRole("main").getByPlaceholder("未填写")).toHaveValue("1.0");

  // 完成的节点上，子任务只读
  await node("开发").click();
  await expect(page.getByLabel("完成子任务：自测")).toBeDisabled();
});
