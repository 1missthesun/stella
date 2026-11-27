import { lazy, Suspense } from "react";
import { translateNow } from "@/shared/i18n";
import type { DisplayTabSpec } from "@/features/workspace-display/types";
import type { WelcomeDemoId } from "./open-welcome-demo";

const WelcomeDemoView = lazy(() => import("./WelcomeDemoView"));

const TITLE_KEYS: Record<WelcomeDemoId, string> = {
  errands: "features.welcomeDemos.errands.title",
  customize: "features.welcomeDemos.customize.title",
  memory: "features.welcomeDemos.memory.title",
};

export const welcomeDemoTabId = (id: WelcomeDemoId): string =>
  `welcome-demo:${id}`;

/** `run` remounts the demo, so it starts again from its first poster. */
export const welcomeDemoTabSpec = (
  id: WelcomeDemoId,
  run: number,
): DisplayTabSpec => ({
  id: welcomeDemoTabId(id),
  kind: "demo",
  title: translateNow(TITLE_KEYS[id]),
  render: () => (
    <Suspense fallback={null}>
      <WelcomeDemoView key={run} id={id} />
    </Suspense>
  ),
});
