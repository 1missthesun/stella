import { useCallback, useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";

const DEVELOPER_RESOURCE_PREVIEWS_KEY = "stella-developer-resource-previews";

const DEVELOPER_RESOURCE_PREVIEWS_CHANGED_EVENT =
  "stella:developer-resource-previews-changed";

const getDeveloperResourcePreviewsEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  return uiState.getItem(DEVELOPER_RESOURCE_PREVIEWS_KEY) === "true";
};

export const setDeveloperResourcePreviewsEnabled = (enabled: boolean) => {
  uiState.setItem(DEVELOPER_RESOURCE_PREVIEWS_KEY, enabled ? "true" : "false");
  window.dispatchEvent(
    new CustomEvent(DEVELOPER_RESOURCE_PREVIEWS_CHANGED_EVENT, {
      detail: { enabled },
    }),
  );
};

export const useDeveloperResourcePreviewsEnabled = (): boolean => {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const stopExternal = uiState.onExternalChange(onStoreChange);
    window.addEventListener(
      DEVELOPER_RESOURCE_PREVIEWS_CHANGED_EVENT,
      onStoreChange,
    );
    return () => {
      stopExternal();
      window.removeEventListener(
        DEVELOPER_RESOURCE_PREVIEWS_CHANGED_EVENT,
        onStoreChange,
      );
    };
  }, []);

  return useSyncExternalStore(
    subscribe,
    getDeveloperResourcePreviewsEnabled,
    () => false,
  );
};
