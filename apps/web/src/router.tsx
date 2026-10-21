import { createRootRoute, createRoute, createRouter, Link, Navigate, Outlet } from "@tanstack/react-router";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Button } from "@/components/ui/button";
import { FlowDemo } from "@/flow-demo/FlowDemo";
import { authClient } from "@/lib/auth";
import { ZeroRoot } from "@/lib/zero";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { LoginPage } from "@/pages/LoginPage";
import { SpacePage } from "@/pages/SpacePage";
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
  if (isPending) return <p className="p-6 text-sm text-slate-500">加载中…</p>;
  if (!session) return <Navigate to="/login" />;
  return (
    <ZeroRoot userID={session.user.id}>
      <div className="flex h-screen flex-col bg-slate-50">
        <nav className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-2 text-sm">
          <Link to="/" className="font-semibold">
            飞书项目复刻
          </Link>
          <div className="flex items-center gap-3">
            <NotificationsBell />
            <span className="text-slate-500">{session.user.name}</span>
            <Button variant="ghost" size="sm" onClick={() => authClient.signOut()}>
              退出
            </Button>
          </div>
        </nav>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </ZeroRoot>
  );
}

const spacesRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: SpacesPage });
const spaceRoute = createRoute({ getParentRoute: () => appRoute, path: "/spaces/$spaceId", component: SpacePage });
const automationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/automations",
  component: AutomationsPage,
});
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
  appRoute.addChildren([spacesRoute, spaceRoute, automationsRoute, itemRoute, typeRoute, templateRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
