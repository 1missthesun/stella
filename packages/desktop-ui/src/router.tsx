import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteErrorRecovery } from "./shell/RouteErrorRecovery";

export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/chat"] }),
  defaultPreload: "intent",
  defaultPreloadDelay: 0,
  defaultPreloadStaleTime: Number.POSITIVE_INFINITY,
  scrollRestoration: false,
  defaultErrorComponent: RouteErrorRecovery,
});

if (import.meta.hot) {
  import.meta.hot.accept("./routeTree.gen.ts", (newModule) => {
    const next = (newModule as { routeTree?: unknown } | undefined)?.routeTree;
    if (!next) return;
    router.update({ routeTree: next as typeof routeTree });
    void router.invalidate();
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
