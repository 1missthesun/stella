import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { viewAtom } from "@/platform/view-state/view-state";
import type { routeTree } from "./routeTree.gen";
import { RouteErrorRecovery } from "./shell/RouteErrorRecovery";

type AppRoutes = typeof routeTree;

const shownRoute = viewAtom(
  "route",
  "/chat",
  (value) => typeof value === "string" && value.startsWith("/"),
);

/**
 * Created without the routes: the route modules load again when the
 * interface changes, and the router, with its history, has to outlive them.
 */
export const router = createRouter({
  routeTree: createRootRoute() as unknown as AppRoutes,
  history: createMemoryHistory({ initialEntries: [shownRoute.get()] }),
  defaultPreload: "intent",
  defaultPreloadDelay: 0,
  defaultPreloadStaleTime: Number.POSITIVE_INFINITY,
  scrollRestoration: false,
  defaultErrorComponent: RouteErrorRecovery,
});

router.subscribe("onResolved", ({ toLocation }) => {
  shownRoute.set(toLocation.href);
});

let routed = false;

/** The router, showing `routes`. */
export const routerFor = (routes: AppRoutes) => {
  if (router.routeTree === routes) return router;
  router.update({ ...router.options, routeTree: routes });
  if (routed) void router.invalidate();
  routed = true;
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
