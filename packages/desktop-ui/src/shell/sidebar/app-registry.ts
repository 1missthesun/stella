import type { AppMetadata } from "@/app/_shared/app-metadata";

type AppMetadataModule = { default: AppMetadata };

const APP_MODULES = import.meta.glob<AppMetadataModule>(
  "../../app/*/metadata.ts",
  { eager: true },
);
const computeSnapshot = (
  modules: Record<string, AppMetadataModule>,
): AppMetadata[] =>
  Object.values(modules)
    .map((m) => m.default)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
let cachedSnapshot = computeSnapshot(APP_MODULES);
const subscribers = new Set<() => void>();
export const subscribe = (cb: () => void) => {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
};
export const getSnapshot = (): AppMetadata[] => cachedSnapshot;
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (!newModule) return;
    const next = (
      newModule as { getSnapshot?: () => AppMetadata[] }
    ).getSnapshot?.();
    if (!next) return;
    cachedSnapshot = next;
    for (const cb of subscribers) {
      try {
        cb();
      } catch {
        // Subscribers throwing should never break the registry.
      }
    }
  });
}
