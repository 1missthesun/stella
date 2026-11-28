import { useSyncExternalStore } from "react";
import { useT } from "@/shared/i18n";
import { uiState } from "@/platform/ui-state";
import { Icon } from "../../../../../desktop-rune/ui/kit";
import { alpha } from "../../../../../desktop-rune/ui/theme";
import { glyph } from "../../icons";
import { useRn } from "../../rn";

// The Files tab's grid/list toggle at the top bar's end (packages/mobile's FilesViewToggle,
// published with publishTopBarAccessory while there are files), and the chosen view, kept across
// launches (files-view-mode).

export type FilesViewMode = "grid" | "list";
type State = { toggle: boolean; mode: FilesViewMode };

const MODE_KEY = "stella-phone-files-view-mode";

let state: State = { toggle: false, mode: uiState.getItem(MODE_KEY) === "list" ? "list" : "grid" };
const listeners = new Set<() => void>();

const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => state;

export const filesView = {
  showToggle: (shown: boolean) => {
    if (shown !== state.toggle) set({ toggle: shown });
  },
  setMode: (mode: FilesViewMode) => {
    if (mode === state.mode) return;
    uiState.setItem(MODE_KEY, mode);
    set({ mode });
  },
};

const useFilesView = () => useSyncExternalStore(subscribe, read, read);
export const useFilesViewMode = () => useFilesView().mode;

const SEGMENT = 40;
const HEIGHT = 40;
const MODES: readonly FilesViewMode[] = ["grid", "list"];
const LABEL_KEYS: Record<FilesViewMode, string> = { grid: "mobile.activityHub.files.viewGrid", list: "mobile.activityHub.files.viewList" };

/** packages/mobile's FilesViewToggle: two glyphs with a pill that springs to the chosen one. */
export function FilesTopBarAccessory() {
  const c = useRn();
  const t = useT();
  const { toggle, mode } = useFilesView();
  if (!toggle) return null;
  const at = MODES.indexOf(mode);
  return (
    <row id="phone-files-view-toggle" role="radiogroup" w={SEGMENT * 2} h={HEIGHT} mr={2}>
      <box absolute={{ left: 1, top: 2 }} w={SEGMENT - 2} h={HEIGHT - 4} radius={(HEIGHT - 4) / 2} fill={alpha(c.text, c.dark ? 0.12 : 0.07)} x={at * SEGMENT} motion={{ dur: 0.26, bounce: 0.1 }} inert />
      {MODES.map((entry) => {
        const selected = entry === mode;
        return (
          <box key={entry} id={`phone-files-view-${entry}`} role="radio" label={t(LABEL_KEYS[entry])} selected={selected} focusable w={SEGMENT} h={HEIGHT} center onPress={() => filesView.setMode(entry)}>
            <Icon icon={glyph(entry)} size={17} color={selected ? c.text : c.textMuted} />
          </box>
        );
      })}
    </row>
  );
}
