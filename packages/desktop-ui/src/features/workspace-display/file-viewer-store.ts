import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";

export type FileViewerMode = "float" | "stage";

export type FileViewerRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FileViewerState = {
  fileId: string | null;
  mode: FileViewerMode;
  rect: FileViewerRect | null;
  detail: string | null;
};

type Listener = () => void;

const STORAGE_KEY_RECT = "stella.fileViewer.rect";
const STORAGE_KEY_MODE = "stella.fileViewer.mode";

const readMode = (): FileViewerMode => {
  if (typeof window === "undefined") return "float";
  return uiState.getItem(STORAGE_KEY_MODE) === "stage" ? "stage" : "float";
};

let preferredMode: FileViewerMode = readMode();
const rememberMode = (mode: FileViewerMode) => {
  preferredMode = mode;
  uiState.setItem(STORAGE_KEY_MODE, mode);
};

const readRect = (): FileViewerRect | null => {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(
      uiState.getItem(STORAGE_KEY_RECT) || "null",
    );
    if (!parsed || typeof parsed !== "object") return null;
    const rect = parsed as Partial<FileViewerRect>;
    if (
      typeof rect.x !== "number" ||
      typeof rect.y !== "number" ||
      typeof rect.width !== "number" ||
      typeof rect.height !== "number"
    ) {
      return null;
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  } catch {
    return null;
  }
};

let state: FileViewerState = {
  fileId: null,
  mode: preferredMode,
  rect: readRect(),
  detail: null,
};
const listeners = new Set<Listener>();

const emit = (next: FileViewerState) => {
  state = next;
  for (const listener of listeners) listener();
};

export const fileViewer = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): FileViewerState {
    return state;
  },
  open(fileId: string) {
    if (state.fileId === fileId) return;
    emit({
      ...state,
      fileId,
      mode: state.fileId ? state.mode : preferredMode,
      detail: null,
    });
  },
  close() {
    if (!state.fileId) return;
    emit({ ...state, fileId: null, detail: null });
  },
  expand() {
    if (!state.fileId || state.mode === "stage") return;
    rememberMode("stage");
    emit({ ...state, mode: "stage" });
  },
  collapse() {
    if (state.mode === "float") return;
    rememberMode("float");
    emit({ ...state, mode: "float" });
  },
  toggleMode() {
    if (state.mode === "stage") this.collapse();
    else this.expand();
  },
  setRect(rect: FileViewerRect, persist = true) {
    emit({ ...state, rect });
    if (persist) uiState.setItem(STORAGE_KEY_RECT, JSON.stringify(rect));
  },
  setDetail(fileId: string, detail: string | null) {
    if (state.fileId !== fileId || state.detail === detail) return;
    emit({ ...state, detail });
  },
};

export const useFileViewer = (): FileViewerState =>
  useSyncExternalStore(
    fileViewer.subscribe,
    fileViewer.getSnapshot,
    fileViewer.getSnapshot,
  );

export const useFileViewerStageOpen = (): boolean =>
  useSyncExternalStore(
    fileViewer.subscribe,
    () => Boolean(state.fileId) && state.mode === "stage",
    () => false,
  );

export const isExclusiveStageSection = (section: string | null | undefined) =>
  section === "browser" || section === "apps" || section === "takeover";

export const opensAsStageTab = (kind: string): boolean => kind === "canvas";

export const VIEWER_SELECTION_SURFACE = "stella-viewer";

export const EMAIL_SELECTION_SURFACE = "email";

export const EMAIL_CHIP_REMOVED_EVENT = "stella:email-chip-removed";
