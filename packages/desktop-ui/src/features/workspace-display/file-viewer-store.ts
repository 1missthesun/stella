import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";

export type FileViewerMode = "float" | "stage";

export type FileViewerRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetachedViewer = { name: string; fileId: string };

export type FileViewerState = {
  fileId: string | null;
  mode: FileViewerMode;
  rect: FileViewerRect | null;
  detached: readonly DetachedViewer[];
};

/** Where a viewer shows its item: inside Stella, or a detached window's name. */
export type ViewerSurface = "docked" | (string & {});

export const DOCKED: ViewerSurface = "docked";

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
  detached: [],
};
const listeners = new Set<Listener>();

const emit = (next: FileViewerState) => {
  state = next;
  for (const listener of listeners) listener();
};

let closeWindow: (name: string) => void = () => {};
let focusWindow: (name: string) => void = () => {};

export const connectViewerWindows = (windows: {
  close: (name: string) => void;
  focus: (name: string) => void;
}): void => {
  closeWindow = windows.close;
  focusWindow = windows.focus;
};

const without = (name: string) =>
  state.detached.filter((viewer) => viewer.name !== name);

const detachedWith = (fileId: string): DetachedViewer | undefined =>
  state.detached.find((viewer) => viewer.fileId === fileId);

const openMode = (): FileViewerMode =>
  state.fileId ? state.mode : preferredMode;

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
  surfaceOf(fileId: string): ViewerSurface | null {
    if (state.fileId === fileId) return DOCKED;
    return detachedWith(fileId)?.name ?? null;
  },
  open(fileId: string) {
    if (state.fileId === fileId) return;
    const detached = detachedWith(fileId);
    if (detached) {
      focusWindow(detached.name);
      return;
    }
    emit({ ...state, fileId, mode: openMode() });
  },
  /** Puts an item on a surface that is already open, as its strip does. */
  show(surface: ViewerSurface, fileId: string) {
    const elsewhere = detachedWith(fileId);
    if (elsewhere?.name === surface) return;
    if (elsewhere) this.closeDetached(elsewhere.name);
    if (surface === DOCKED) {
      emit({ ...state, fileId, mode: openMode() });
      return;
    }
    emit({
      ...state,
      fileId: state.fileId === fileId ? null : state.fileId,
      detached: state.detached.map((viewer) =>
        viewer.name === surface ? { ...viewer, fileId } : viewer,
      ),
    });
  },
  close() {
    if (!state.fileId) return;
    emit({ ...state, fileId: null });
  },
  closeItem(fileId: string) {
    if (state.fileId === fileId) this.close();
    const detached = detachedWith(fileId);
    if (detached) this.closeDetached(detached.name);
  },
  closeAll() {
    for (const viewer of state.detached) this.closeDetached(viewer.name);
    this.close();
  },
  detach(viewer: DetachedViewer) {
    emit({
      ...state,
      fileId: state.fileId === viewer.fileId ? null : state.fileId,
      detached: [...without(viewer.name), viewer],
    });
  },
  closeDetached(name: string) {
    if (!state.detached.some((viewer) => viewer.name === name)) return;
    emit({ ...state, detached: without(name) });
    closeWindow(name);
  },
  /** Brings a detached viewer back inside Stella, floating at `rect`. */
  dock(name: string, rect?: FileViewerRect) {
    const viewer = state.detached.find((entry) => entry.name === name);
    if (!viewer) return;
    emit({
      ...state,
      fileId: viewer.fileId,
      mode: rect ? "float" : openMode(),
      rect: rect ?? state.rect,
      detached: without(name),
    });
    closeWindow(name);
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
  /** Floats the viewer at `rect` in one step, e.g. when a resize starts on the stage. */
  floatAt(rect: FileViewerRect) {
    rememberMode("float");
    emit({ ...state, mode: "float", rect });
    uiState.setItem(STORAGE_KEY_RECT, JSON.stringify(rect));
  },
  setRect(rect: FileViewerRect) {
    emit({ ...state, rect });
    uiState.setItem(STORAGE_KEY_RECT, JSON.stringify(rect));
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
  section === "browser" || section === "takeover";

export const VIEWER_SELECTION_SURFACE = "stella-viewer";

export const EMAIL_SELECTION_SURFACE = "email";

export const EMAIL_CHIP_REMOVED_EVENT = "stella:email-chip-removed";
