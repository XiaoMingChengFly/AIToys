import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { FlowDemo } from "@/flow-demo/FlowDemo";
import { authClient } from "@/lib/auth";
import { ZeroRoot } from "@/lib/zero";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { LoginPage } from "@/pages/LoginPage";
import { MyWorkPage } from "@/pages/MyWorkPage";
import { SpacePage } from "@/pages/SpacePage";
import { SpaceSettingsPage } from "@/pages/SpaceSettingsPage";
import { SpacesPage } from "@/pages/SpacesPage";
import { TemplateEditorPage } from "@/pages/TemplateEditorPage";
import { TypePage } from "@/pages/TypePage";
import { WorkItemPage } from "@/pages/WorkItemPage";

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });

/** 不需要登录的引擎演示页：纯前端点着走 OEM 流程。 */
const demoRoute = createRoute({ getParentRoute: () => rootRoute, path: "/demo", component: FlowDemo });

/** 需要登录的部分：没登录跳到登录页；登录后挂上 Zero。 */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout });

function AppLayout() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <p className="p-6 text-sm text-fg-subtle">加载中…</p>;
  if (!session) return <Navigate to="/login" />;
  return (
    <ZeroRoot userID={session.user.id}>
      <AppShell user={session.user}>
        <Outlet />
      </AppShell>
    </ZeroRoot>
  );
}

const spacesRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: SpacesPage });
/** 空间的工作项列表；?type= 只看一种类型（左侧导航里的类型入口）。 */
const spaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId",
  component: SpacePage,
  validateSearch: (search: Record<string, unknown>): { type?: string } =>
    typeof search.type === "string" ? { type: search.type } : {},
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/settings",
  component: SpaceSettingsPage,
});
const automationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/automations",
  component: AutomationsPage,
});
const myWorkRoute = createRoute({ getParentRoute: () => appRoute, path: "/my-work", component: MyWorkPage });
const itemRoute = createRoute({ getParentRoute: () => appRoute, path: "/items/$itemId", component: WorkItemPage });
const typeRoute = createRoute({ getParentRoute: () => appRoute, path: "/types/$typeId", component: TypePage });
const templateRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/templates/$templateId",
  component: TemplateEditorPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  demoRoute,
  appRoute.addChildren([
    spacesRoute,
    myWorkRoute,
    spaceRoute,
    settingsRoute,
    automationsRoute,
    itemRoute,
    typeRoute,
    templateRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
