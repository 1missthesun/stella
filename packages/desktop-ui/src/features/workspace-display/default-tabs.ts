export const CHAT_DISPLAY_TAB_ID = "chat";
export const HOME_DISPLAY_TAB_ID = "home";
export const TRASH_DISPLAY_TAB_ID = "trash:deferred-delete";

type WorkspaceDefaultTabsAdapter = {
  openModelPicker: () => void;
};

let adapter: WorkspaceDefaultTabsAdapter | null = null;

export const registerWorkspaceDefaultTabs = (
  nextAdapter: WorkspaceDefaultTabsAdapter,
): void => {
  adapter = nextAdapter;
};

const getAdapter = (): WorkspaceDefaultTabsAdapter => {
  if (!adapter) {
    throw new Error("Workspace default tabs adapter has not been registered.");
  }
  return adapter;
};

export function openModelPicker(): void {
  getAdapter().openModelPicker();
}
