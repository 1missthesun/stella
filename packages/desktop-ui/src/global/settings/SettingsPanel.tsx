import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  revealPendingSettingsCard,
  subscribeSettingsCardMounts,
} from "@/global/settings/settings-card-targets";

export function SettingsPanel({
  children,
  scrollResetKey,
}: {
  children: ReactNode;
  scrollResetKey?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const placedKeyRef = useRef<string | undefined>(undefined);
  const [cardMountRevision, noteCardMount] = useReducer(
    (revision: number) => revision + 1,
    0,
  );

  useEffect(() => subscribeSettingsCardMounts(noteCardMount), []);

  useLayoutEffect(() => {
    const keyChanged = placedKeyRef.current !== scrollResetKey;
    placedKeyRef.current = scrollResetKey;
    if (revealPendingSettingsCard() || !keyChanged) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollResetKey, cardMountRevision]);

  return (
    <div className="settings-panel-wrap">
      <div ref={scrollRef} className="settings-panel">
        {children}
      </div>
    </div>
  );
}
