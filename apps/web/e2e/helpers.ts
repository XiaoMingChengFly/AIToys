import { expect, type Page, request } from "@playwright/test";

export const API_URL = process.env.API_URL ?? "http://localhost:3000";
export const PASSWORD = "correct-horse-battery";

/** 用接口注册一个同事账号（不影响当前页面的登录态）。 */
export async function registerColleague(email: string, name: string) {
  const api = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { origin: process.env.WEB_URL ?? "http://localhost:5173" },
  });
  const res = await api.post("/api/auth/sign-up/email", { data: { email, password: PASSWORD, name } });
  expect(res.ok()).toBe(true);
}

/** 在登录页注册并登录，停在“我的空间”。 */
export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("heading", { name: "我的空间" })).toBeVisible();
}

/** 新建空间并进入它的工作项页。等自己的管理员身份同步下来，否则客户端会先以为自己不是管理员。 */
export async function createSpace(page: Page, name: string) {
  await page.getByRole("button", { name: "新建空间" }).first().click();
  await page.getByRole("dialog").getByLabel("空间名称").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("button", { name: "导入 OEM 模板" })).toBeVisible();
}

/** 导入 OEM 模板，等“项目”类型出现在左侧导航。 */
export async function importOem(page: Page) {
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await expect(page.getByRole("button", { name: "新建工作项" })).toBeVisible();
}

/** 注册、建空间、导入 OEM，一步到位。 */
export async function oemSpace(page: Page, user: string, email: string, space: string) {
  await signUp(page, user, email);
  await createSpace(page, space);
  await importOem(page);
}

/** 打开新建工作项的弹窗，填名称（和可选的角色），创建后停在工作项页。 */
export async function createItem(
  page: Page,
  name: string,
  options: { label?: string; roles?: string[]; before?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void> } = {},
) {
  await page.getByRole("button", { name: /^新建/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(options.label ?? "项目名称").fill(name);
  if (options.roles?.length) {
    await dialog.getByText("角色和负责人").click();
    for (const role of options.roles) {
      const [roleName] = role.split("：");
      await dialog.getByRole("button", { name: `设置${roleName}` }).click();
      await page.getByRole("button", { name: role }).click();
      await page.keyboard.press("Escape");
    }
  }
  await options.before?.(dialog);
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** 在空间设置里按邮箱加成员。 */
export async function addMember(page: Page, email: string, name: string) {
  await openSettings(page);
  await page.getByLabel("按邮箱添加成员").fill(email);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByRole("list", { name: "成员列表" }).getByText(name, { exact: true })).toBeVisible();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "主导航" });

/** 左侧导航：全部工作项、自动化、空间设置。 */
export async function openItems(page: Page) {
  await nav(page).getByRole("link", { name: "全部工作项" }).click();
  await expect(page.getByRole("heading", { name: "全部工作项" })).toBeVisible();
}
export async function openSettings(page: Page) {
  await nav(page).getByRole("link", { name: "空间设置" }).click();
  await expect(page.getByRole("heading", { name: "空间设置" })).toBeVisible();
}
export async function openAutomations(page: Page) {
  await nav(page).getByRole("link", { name: "自动化" }).click();
  await expect(page.getByRole("heading", { name: "自动化" })).toBeVisible();
}
