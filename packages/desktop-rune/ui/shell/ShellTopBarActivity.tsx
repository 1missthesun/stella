import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activityIndicatorTransition, selectActivityIndicatorLabel, ACTIVITY_INDICATOR_SPAWN_BEAT_MS, type ActivityIndicatorPhase } from "@stella/contracts/activity-indicator";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { countPausedActivityRows, deriveRunningActivityIndicatorEntries } from "@/features/chat/lib/event-transforms";
import { pickWorkingIndicatorToolPose } from "@/features/chat/working-indicator-state";
import { useWindowFocus } from "@/shared/hooks/use-window-focus";
import { useT, useTPlural } from "@/shared/i18n";
import { StellaCharacter } from "../kit/StellaCharacter";
import { fontSize, look, useTokens } from "../theme";
import { BODY_TEXT, TextScope } from "../kit/compat";
import { mounted, Nothing } from "../app/mount";
import { Panel } from "./topbar/chrome";

const ActivityOverview = mounted<{ onNavigate: () => void }>(import.meta.glob("./sidebar-sections/HomeSection.tsx", { eager: true }), "ActivityOverview", Nothing);

const HOVER_OPEN_DELAY_MS = 80;
const HOVER_CLOSE_DELAY_MS = 220;
const MARK_SIZE_PX = 22;
const LABEL = look(fontSize.sm, 500, { lh: 1.3 });

/** desktop-ui's `ShellTopBarActivity`: Stella's mark in the middle of the bar, what she's doing, and the activity menu. */
export const ShellTopBarActivity = memo(function ShellTopBarActivity({ width }: { width: number }) {
  const t = useT();
  const tk = useTokens();
  const tPlural = useTPlural();
  const chat = useChatRuntime();
  const tasks = chat.conversation.tasks;
  const windowFocused = useWindowFocus();

  const running = useMemo(() => deriveRunningActivityIndicatorEntries(tasks), [tasks]);
  const count = running.length;
  const label = selectActivityIndicatorLabel(running, (total) => tPlural("app.chat.activityPill.tasksInProgress", total));
  const pausedCount = useMemo(() => countPausedActivityRows(tasks), [tasks]);
  const [phase, setPhase] = useState<ActivityIndicatorPhase>(count > 0 ? "working" : "idle");
  const [pop, setPop] = useState(0);
  const previousCount = useRef(count);

  useEffect(() => {
    const previous = previousCount.current;
    previousCount.current = count;
    const transition = activityIndicatorTransition(count, previous);
    if (transition === "spawn") {
      setPhase("spawn");
      const timer = window.setTimeout(() => setPhase("working"), ACTIVITY_INDICATOR_SPAWN_BEAT_MS);
      return () => window.clearTimeout(timer);
    }
    if (transition === "settle") {
      setPhase("idle");
      setPop((n) => n + 1);
    }
    return undefined;
  }, [count]);

  const busy = phase !== "idle" && label !== null;
  const hasActivity = busy || pausedCount > 0;
  const markState = busy && phase === "working" ? pickWorkingIndicatorToolPose(running[0]?.id ?? "stella") : "idle";

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);
  useEffect(() => clearHoverTimer, [clearHoverTimer]);
  const closeMenu = useCallback(() => {
    clearHoverTimer();
    setOpen(false);
    setPinned(false);
  }, [clearHoverTimer]);
  useEffect(() => {
    if (!hasActivity && open) closeMenu();
  }, [hasActivity, open, closeMenu]);

  const onHover = (inside: boolean) => {
    clearHoverTimer();
    if (inside) {
      if (open || !hasActivity) return;
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = null;
        setOpen(true);
      }, HOVER_OPEN_DELAY_MS);
      return;
    }
    if (pinned) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };

  const ariaLabel =
    busy && label
      ? t("app.chat.activityPill.openActivity", { label })
      : pausedCount > 0
        ? t("app.chat.activityPill.openActivity", { label: tPlural("app.chat.activityPill.tasksPaused", pausedCount) })
        : t("app.chat.activityPill.idle");

  const color = open ? tk.c.textStrong : tk.c.textBase;
  return (
    <row id="shell-topbar-activity" w={width} h="full" minW={0} center windowDrag>
      <row
        id="shell-topbar-activity-trigger"
        role="button"
        label={ariaLabel}
        disabled={!hasActivity}
        focusable={hasActivity}
        hidden={width <= 34}
        noWindowDrag
        maxW="100%"
        minW={0}
        h={26}
        px={6}
        gap={7}
        align="center"
        radius={8}
        hoverGroup
        layout={0.35}
        focusRing={{ width: 2, offset: -2, color: tk.c.ring, radius: 8 }}
        onHover={hasActivity ? onHover : undefined}
        onPress={
          hasActivity
            ? () => {
                clearHoverTimer();
                if (open && pinned) {
                  closeMenu();
                  return;
                }
                setOpen(true);
                setPinned(true);
              }
            : undefined
        }
      >
        <box key={`pop-${pop}`} shrink={false} enter={pop > 0 ? { scale: 1.18, dur: 0.38, bounce: 0.35 } : undefined}>
          <StellaCharacter size={MARK_SIZE_PX} state={markState} eyeColor={tk.c.surfaceBase} paused={!windowFocused} />
        </box>
        {busy && label && width > 96 ? (
          <text key={label} {...LABEL} nowrap truncate minW={0} shrink color={color} hoverColor={tk.c.textStrong} enter={{ opacity: 0, dur: 0.18 }} exit={{ opacity: 0, dur: 0.12 }}>
            {label}
          </text>
        ) : null}
      </row>
      <Panel id="shell-topbar-activity-menu" anchor="shell-topbar-activity-trigger" open={open} onClose={closeMenu} align="center" gap={6} w={Math.min(352, window.innerWidth - 32)} maxH={Math.min(window.innerHeight * 0.6, 512)} onHover={onHover} modal={pinned}>
        <col w="full" maxH={Math.min(window.innerHeight * 0.6, 512)} clip={0}>
          <TextScope base={BODY_TEXT}>
            <ActivityOverview onNavigate={closeMenu} />
          </TextScope>
        </col>
      </Panel>
    </row>
  );
});
