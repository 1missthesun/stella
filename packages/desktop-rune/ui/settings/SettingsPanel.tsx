import { useEffect, useLayoutEffect, useReducer, useRef, type ReactNode } from "react";
import { useSettings } from "./settings.styles";
import { revealPendingSettingsCard, setSettingsScrollPanel, subscribeSettingsCardMounts } from "./settings-card-targets";

const PANEL_ID = "settings-panel";

export function SettingsPanel({ children, scrollResetKey, narrow = false }: { children: ReactNode; scrollResetKey?: string; narrow?: boolean }) {
  const s = useSettings();
  const placedKeyRef = useRef<string | undefined>(undefined);
  const place = useRef({ id: PANEL_ID, y: 0, scrollY: 0 });
  const [cardMountRevision, noteCardMount] = useReducer((revision: number) => revision + 1, 0);

  useEffect(() => subscribeSettingsCardMounts(noteCardMount), []);
  useEffect(() => {
    setSettingsScrollPanel(place.current);
    return () => setSettingsScrollPanel(null);
  }, []);

  useLayoutEffect(() => {
    const keyChanged = placedKeyRef.current !== scrollResetKey;
    placedKeyRef.current = scrollResetKey;
    if (revealPendingSettingsCard() || !keyChanged) return;
    void stella.engine.scroll.to(PANEL_ID, 0);
  }, [scrollResetKey, cardMountRevision]);

  return (
    <col {...s.settingsPanelWrap}>
      <col
        id={PANEL_ID}
        w="full"
        {...s.settingsPanel}
        {...(narrow ? s.settingsLayoutBar_settingsPanel : s.settingsLayoutRail_settingsPanel)}
        onLayout={(r) => {
          place.current.y = r.y;
        }}
        onScroll={(p) => {
          place.current.scrollY = p.y;
        }}
      >
        {children}
      </col>
    </col>
  );
}
