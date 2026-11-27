import { createRootRoute, createRoute, Outlet, redirect, useNavigate, type AnyRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { router, routerFor } from "@/router";
import { openCloudAppPanel } from "@/features/cloud/open-cloud-app-panel";
import { useCloudApps } from "@/features/cloud/use-cloud-apps";
import { SETTINGS_TAB_KEYS, type SettingsTab } from "@/global/settings/settings-tabs";
import { look, fontSize, useTokens } from "../theme";
import { RouteErrorRecovery } from "../shell/RouteErrorRecovery";
import { lazyScreen } from "../kit/lazy";
import { Nothing } from "./mount";
import { RootLayout } from "./routes/root";

// Both routes bounce to /chat (root.tsx): Settings and Billing open as dialogs.
const BillingScreen = lazyScreen(() => import("../replace/global/billing/BillingScreen"), (module) => module.BillingScreen);
const SettingsApp = lazyScreen(() => import("../replace/app/settings/App"), (module) => module.SettingsApp);

type RootSearch = { dialog?: "auth" | "connect" };
type ChatSearch = { c?: string };
type SettingsSearch = { tab?: SettingsTab };

const isSettingsTab = (value: unknown): value is SettingsTab => (SETTINGS_TAB_KEYS as readonly unknown[]).includes(value);

function AppsStatus({ error }: { error: boolean }) {
  const t = useTokens();
  return (
    <col id="apps-screen-status" w="full" h="full" center role="status">
      <text {...look(fontSize.base, 400)} color={t.c.textWeak}>{error ? "Apps are unavailable right now." : "Opening app…"}</text>
    </col>
  );
}

const rootRoute = createRootRoute({
  validateSearch: (search: Record<string, unknown>): RootSearch =>
    search.dialog === "auth" || search.dialog === "connect" ? { dialog: search.dialog } : {},
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/chat" as never });
  },
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  validateSearch: (search: Record<string, unknown>): ChatSearch => (typeof search.c === "string" ? { c: search.c } : {}),
  component: Nothing,
});

const appsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/apps", component: Outlet });

function CloudAppDeepLink() {
  const { slug } = appSlugRoute.useParams();
  const navigate = useNavigate();
  const cloudApps = useCloudApps();
  const app = cloudApps.apps.find((candidate) => candidate.slug === slug);
  useEffect(() => {
    if (cloudApps.phase === "loading") return;
    if (cloudApps.phase === "ready" && app) openCloudAppPanel(app);
    void navigate({ to: "/chat" as never, replace: true });
  }, [app, cloudApps.phase, navigate]);
  return <AppsStatus error={cloudApps.phase === "error"} />;
}

const appSlugRoute = createRoute({ getParentRoute: () => appsRoute, path: "$slug", component: CloudAppDeepLink });

const billingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/billing", component: BillingScreen as unknown as () => null });

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (search: Record<string, unknown>): SettingsSearch => (isSettingsTab(search.tab) ? { tab: search.tab } : {}),
  component: SettingsApp as unknown as () => null,
});

const routeTree = rootRoute.addChildren([indexRoute, chatRoute, appsRoute.addChildren([appSlugRoute]), billingRoute, settingsRoute]);

/** desktop-ui's router (memory history, the persisted route) over the same route ids, drawn on Rune. */
export function appRouter(): AnyRouter {
  router.update({ ...router.options, defaultErrorComponent: RouteErrorRecovery, defaultNotFoundComponent: Nothing });
  return routerFor(routeTree as never) as unknown as AnyRouter;
}
