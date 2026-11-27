import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { onEngineEvent } from "../../../desktop-rune/host/bridge";
import { fileViewer, useFileViewer } from "@/features/workspace-display/file-viewer-store";
import { useDisplayTabList } from "@/features/workspace-display/tab-store";
import { look, useTokens } from "../../../desktop-rune/ui/theme";
import { ViewTabContent, isViewFile } from "../../../desktop-rune/ui/views/ViewTabContent";
import type { PhoneInsets } from "./insets";

// A Stella View opened on the phone (from the Apps tab, or a chat card's open button): the whole
// screen, as an app is on a phone, rather than the desktop's floating viewer. It is the shared
// view surface (desktop-rune/ui/views/ViewTabContent: the running view, Undo, History and Share)
// under a back button and the view's title, sliding in from the edge. Every way of opening a view
// goes through the file viewer (`openDisplayPayloadTab`), so this takes view files from there.

type Shown = { filePath: string; title: string };

let shown: Shown | null = null;
let open = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const phoneViewScreen = {
  open(view: Shown) {
    shown = view;
    open = true;
    emit();
  },
  close() {
    if (!open) return;
    open = false;
    emit();
  },
  isOpen: () => open,
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const readOpen = () => open;
const readShown = () => shown;

/** When the person last pressed anything: a view the viewer opens soon after was opened by them. */
let lastPress = -Infinity;
onEngineEvent("ev", (e) => {
  if (e.e === "press") lastPress = performance.now();
});
/** How soon after a press a view opening counts as the person's (the Apps list reads the view's newest version first). */
const OPENED_WITHIN_MS = 15_000;

/**
 * Takes each view the file viewer opens, and shows it here instead. One the viewer opens on its
 * own (restoring what was open at launch, or an agent's) is let go: the person stays where they are.
 */
function useTakeViewsFromViewer() {
  const { fileId } = useFileViewer();
  const { tabs } = useDisplayTabList();
  useLayoutEffect(() => {
    if (!fileId) return;
    const tab = tabs.find((t) => t.id === fileId);
    const payload = tab?.payload;
    if (payload?.kind !== "canvas-html" || !isViewFile(payload.filePath)) return;
    const at = performance.now();
    fileViewer.closeItem(fileId);
    // The press that opened it may still be on its way to its listeners: decide once it has been heard.
    setTimeout(() => {
      if (at - lastPress < OPENED_WITHIN_MS) phoneViewScreen.open({ filePath: payload.filePath, title: tab?.title ?? "" });
    }, 0);
  }, [fileId, tabs]);
}

const BUTTON = 44;
const EDGE = 10;
const BAR_H = 52;

export function PhoneViewScreen({ width, insets, raise, BackButton }: { width: number; insets: PhoneInsets; raise: number; BackButton: (p: { id: string; label: string; onPress: () => void }) => ReactNode }) {
  useTakeViewsFromViewer();
  const t = useTokens();
  const tr = useT();
  const isOpen = useSyncExternalStore(subscribe, readOpen, readOpen);
  const view = useSyncExternalStore(subscribe, readShown, readShown);
  // The view keeps running while the screen slides away, then lets go.
  const [mounted, setMounted] = useState<Shown | null>(view);
  useEffect(() => {
    if (isOpen) {
      setMounted(view);
      return;
    }
    const timer = setTimeout(() => setMounted(null), 450);
    return () => clearTimeout(timer);
  }, [isOpen, view]);
  const current = isOpen ? view : mounted;
  return (
    <col
      id="phone-view-screen"
      role="dialog"
      label={current?.title ?? ""}
      fixed
      inset={0}
      raise={raise}
      fill={t.c.background}
      x={isOpen ? 0 : width + 24}
      motion={{ dur: 0.38, bounce: 0.06 }}
      inert={!isOpen}
      hidden={!current}
      pt={insets.top}
      pb={Math.max(insets.bottom, insets.keyboard)}
      pl={insets.left}
      pr={insets.right}
    >
      <row id="phone-view-screen-bar" shrink={false} h={BAR_H} align="center" px={EDGE} gap={8} raise>
        <BackButton id="phone-view-screen-back" label={tr("common.back")} onPress={() => phoneViewScreen.close()} />
        <row grow={1} minW={0} h="full" center>
          <text role="heading" {...look(17, 600)} color={t.c.foreground} maxLines={1} truncate>
            {current?.title ?? ""}
          </text>
        </row>
        <box w={BUTTON} h={BUTTON} />
      </row>
      <col grow={1} minH={0} w="full">
        {current ? <ViewTabContent key={current.filePath} filePath={current.filePath} /> : null}
      </col>
    </col>
  );
}
