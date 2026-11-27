import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EMPTY_COMPANION_STATE, type CompanionActivity, type CompanionLayout, type CompanionState } from "@stella/contracts/desktop/companion";
import { readAloudPrefStore } from "@/features/voice/services/read-aloud/read-aloud-pref";
import type { Drag } from "../../../host/rune-jsx/props";
import { useAuxWindow } from "../aux-window";

const IDLE_ACTIVITY: CompanionActivity = { hovered: false, panelActive: false, expanded: false, recording: false, transcribing: false };

/** desktop-ui's `useCompanionWindow`, over this window's own API. */
export function useCompanionWindow(): { layout: CompanionLayout | null; activity: CompanionActivity } {
  const { api } = useAuxWindow();
  const [layout, setLayout] = useState<CompanionLayout | null>(null);
  const [activity, setActivity] = useState<CompanionActivity>(IDLE_ACTIVITY);
  useEffect(() => {
    const companion = api?.companion;
    if (!companion) return;
    const unsubscribeLayout = companion.onLayout(setLayout);
    const unsubscribeActivity = companion.onActivity((next) =>
      setActivity((prev) =>
        prev.hovered === next.hovered && prev.panelActive === next.panelActive && prev.expanded === next.expanded && prev.recording === next.recording && prev.transcribing === next.transcribing ? prev : next,
      ),
    );
    companion.hello();
    return () => {
      unsubscribeLayout();
      unsubscribeActivity();
    };
  }, [api]);
  return { layout, activity };
}

/** Whether the companion is shown, per main's visibility broadcast. */
export function useCompanionVisible(initial = true): boolean {
  const { api } = useAuxWindow();
  const [visible, setVisible] = useState(initial);
  useEffect(() => {
    const companion = api?.companion;
    if (!companion) return;
    let cancelled = false;
    void companion
      .getVisible()
      .then((result) => {
        if (!cancelled) setVisible(result.visible);
      })
      .catch(() => undefined);
    const unsubscribe = companion.onVisibleChanged((result) => {
      if (!cancelled) setVisible(result.visible);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);
  return visible;
}

export function useCompanionState(): CompanionState {
  const { api } = useAuxWindow();
  const [state, setState] = useState<CompanionState>(EMPTY_COMPANION_STATE);
  useEffect(() => {
    const companion = api?.companion;
    if (!companion) return;
    let cancelled = false;
    void companion
      .getState()
      .then((initial) => {
        if (!cancelled && initial) setState(initial);
      })
      .catch(() => undefined);
    const unsubscribe = companion.onState((next) => {
      if (!cancelled && next) setState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);
  return state;
}

export type VoiceSpeakingState = { isSpeaking: boolean; isUserSpeaking: boolean };
const IDLE_VOICE: VoiceSpeakingState = { isSpeaking: false, isUserSpeaking: false };

export function useVoiceSpeakingState(active: boolean): VoiceSpeakingState {
  const { api } = useAuxWindow();
  const [state, setState] = useState<VoiceSpeakingState>(IDLE_VOICE);
  useEffect(() => {
    const voice = api?.voice;
    if (!active || !voice) {
      setState(IDLE_VOICE);
      return;
    }
    let cancelled = false;
    const apply = (snapshot: { isSpeaking?: boolean; isUserSpeaking?: boolean }) => {
      if (cancelled) return;
      const next = { isSpeaking: snapshot.isSpeaking === true, isUserSpeaking: snapshot.isUserSpeaking === true };
      setState((prev) => (prev.isSpeaking === next.isSpeaking && prev.isUserSpeaking === next.isUserSpeaking ? prev : next));
    };
    void voice
      .getRuntimeState()
      .then(apply)
      .catch(() => undefined);
    const unsubscribe = voice.onRuntimeState(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active, api]);
  return state;
}

export function useReadAloudEnabled(): boolean {
  return useSyncExternalStore(readAloudPrefStore.subscribe, readAloudPrefStore.getSnapshot, readAloudPrefStore.getServerSnapshot);
}

const DRAG_THRESHOLD_PX = 5;

/**
 * desktop-ui's `useMarkPress`: a press under 5px toggles the panel, more drags the companion.
 * Main moves the window under the pointer, so the drag reads the cursor's screen point from the
 * engine rather than the window-relative pointer.
 */
export function useMarkPress(onClick?: () => void): { dragging: boolean; onDrag: (d: Drag) => void; onContextMenu: () => void } {
  const { api } = useAuxWindow();
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ moved: boolean; pending: boolean } | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  const sendMove = useCallback(() => {
    const current = press.current;
    if (!current || current.pending) return;
    current.pending = true;
    void stella.engine.screen
      .cursorPoint()
      .then((point) => {
        if (press.current === current && current.moved) api?.companion.dragMove({ screenX: point.x, screenY: point.y });
      })
      .catch(() => undefined)
      .finally(() => {
        current.pending = false;
      });
  }, [api]);

  const onDrag = useCallback(
    (d: Drag) => {
      if (d.phase === "start") {
        press.current = { moved: false, pending: false };
        return;
      }
      const current = press.current;
      if (!current) return;
      if (d.phase === "move") {
        if (!current.moved) {
          if (Math.hypot(d.dx, d.dy) < DRAG_THRESHOLD_PX) return;
          current.moved = true;
          setDragging(true);
          void stella.engine.screen.cursorPoint().then(
            (point) => api?.companion.dragStart({ screenX: point.x - d.dx, screenY: point.y - d.dy }),
            () => undefined,
          );
          return;
        }
        sendMove();
        return;
      }
      press.current = null;
      if (current.moved) {
        void stella.engine.screen
          .cursorPoint()
          .then((point) => api?.companion.dragMove({ screenX: point.x, screenY: point.y }))
          .catch(() => undefined)
          .finally(() => {
            api?.companion.dragEnd();
            setDragging(false);
          });
        return;
      }
      onClickRef.current?.();
      api?.companion.toggleExpanded();
    },
    [api, sendMove],
  );

  const onContextMenu = useCallback(() => api?.companion.showContextMenu(), [api]);
  return { dragging, onDrag, onContextMenu };
}
