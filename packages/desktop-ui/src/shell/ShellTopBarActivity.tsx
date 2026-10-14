import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import {
  ACTIVITY_INDICATOR_LABEL_IN_DELAY_MS,
  ACTIVITY_INDICATOR_LABEL_IN_MS,
  ACTIVITY_INDICATOR_LABEL_OUT_MS,
  ACTIVITY_INDICATOR_POP_RISE_MS,
  ACTIVITY_INDICATOR_POP_SCALE,
  ACTIVITY_INDICATOR_POP_SETTLE_SPRING,
  ACTIVITY_INDICATOR_SETTLE_SPRING,
  ACTIVITY_INDICATOR_SPAWN_BEAT_MS,
  activityIndicatorTransition,
  selectActivityIndicatorLabel,
  type ActivityIndicatorPhase,
} from "@stella/contracts/activity-indicator";
import {
  CHAT_ACTIVITY_SHIMMER_GROUP,
  TextShimmer,
} from "@/app/chat/TextShimmer";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { deriveRunningActivityIndicatorEntries } from "@/features/chat/lib/event-transforms";
import { pickWorkingIndicatorToolPose } from "@/features/chat/working-indicator-state";
import { useWindowFocus } from "@/shared/hooks/use-window-focus";
import { useT, useTPlural } from "@/shared/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { StellaCharacter } from "@/ui/stella-character/StellaCharacter";
import "./shell-topbar-activity.css";

type ActivityOverviewComponent =
  (typeof import("@/shell/sidebar-sections/HomeSection"))["ActivityOverview"];

let loadedActivityOverview: ActivityOverviewComponent | null = null;

const loadActivityOverview = () =>
  import("@/shell/sidebar-sections/HomeSection").then((module) => {
    loadedActivityOverview = module.ActivityOverview;
    return { default: module.ActivityOverview };
  });

const preloadActivityOverview = (): void => {
  void loadActivityOverview().catch(() => undefined);
};

const ActivityOverview = lazy(loadActivityOverview);

const PRELOAD_IDLE_TIMEOUT_MS = 3000;
const HOVER_OPEN_DELAY_MS = 80;
const HOVER_CLOSE_DELAY_MS = 220;

const schedulePreloadWhenIdle = (): (() => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(preloadActivityOverview, {
      timeout: PRELOAD_IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(preloadActivityOverview, 1);
  return () => window.clearTimeout(handle);
};

const LABEL_SHIMMER_MS = 1900;

const MARK_SIZE_PX = 22;

const MARK_EYE_COLOR = "var(--surface-base)";

function ActivityMenu({ onNavigate }: { onNavigate: () => void }) {
  const Loaded = loadedActivityOverview;
  return (
    <div className="shell-topbar-activity-menu">
      {Loaded ? (
        <Loaded onNavigate={onNavigate} />
      ) : (
        <Suspense fallback={null}>
          <ActivityOverview onNavigate={onNavigate} />
        </Suspense>
      )}
    </div>
  );
}

export const ShellTopBarActivity = memo(function ShellTopBarActivity() {
  const t = useT();
  const tPlural = useTPlural();
  const chat = useChatRuntime();
  const tasks = chat.conversation.tasks;
  const windowFocused = useWindowFocus();
  const reduceMotion = useReducedMotion();

  const running = useMemo(
    () => deriveRunningActivityIndicatorEntries(tasks),
    [tasks],
  );
  const count = running.length;
  const label = selectActivityIndicatorLabel(running, (total) =>
    tPlural("app.chat.activityPill.tasksInProgress", total),
  );

  const [phase, setPhase] = useState<ActivityIndicatorPhase>(
    count > 0 ? "working" : "idle",
  );
  const previousCount = useRef(count);
  const popScale = useMotionValue(1);

  useEffect(() => {
    const previous = previousCount.current;
    previousCount.current = count;
    const transition = activityIndicatorTransition(count, previous);
    if (transition === "spawn") {
      setPhase("spawn");
      const timer = window.setTimeout(
        () => setPhase("working"),
        ACTIVITY_INDICATOR_SPAWN_BEAT_MS,
      );
      return () => window.clearTimeout(timer);
    }
    if (transition === "settle") {
      setPhase("idle");
      if (reduceMotion) return undefined;
      void animate(popScale, [1, ACTIVITY_INDICATOR_POP_SCALE], {
        duration: ACTIVITY_INDICATOR_POP_RISE_MS / 1000,
        ease: [0.33, 1, 0.68, 1],
      }).then(() =>
        animate(popScale, 1, {
          type: "spring",
          ...ACTIVITY_INDICATOR_POP_SETTLE_SPRING,
        }),
      );
    }
    return undefined;
  }, [count, popScale, reduceMotion]);

  const busy = phase !== "idle" && label !== null;
  const markState =
    busy && phase === "working"
      ? pickWorkingIndicatorToolPose(running[0]?.id ?? "stella")
      : "idle";

  useEffect(() => schedulePreloadWhenIdle(), []);

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const openedByHover = useRef(false);

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
    if (!busy && open) closeMenu();
  }, [busy, open, closeMenu]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        clearHoverTimer();
        openedByHover.current = false;
        setOpen(true);
        setPinned(true);
      } else {
        closeMenu();
      }
    },
    [clearHoverTimer, closeMenu],
  );

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType !== "mouse") return;
      preloadActivityOverview();
      clearHoverTimer();
      if (open || !busy) return;
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = null;
        openedByHover.current = true;
        setOpen(true);
      }, HOVER_OPEN_DELAY_MS);
    },
    [busy, clearHoverTimer, open],
  );

  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clearHoverTimer();
      if (pinned) return;
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = null;
        setOpen(false);
      }, HOVER_CLOSE_DELAY_MS);
    },
    [clearHoverTimer, pinned],
  );

  const handleTriggerClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      clearHoverTimer();
      if (open && pinned) {
        closeMenu();
        return;
      }
      openedByHover.current = false;
      setOpen(true);
      setPinned(true);
    },
    [clearHoverTimer, closeMenu, open, pinned],
  );

  const handleOpenAutoFocus = useCallback((event: Event) => {
    if (openedByHover.current) event.preventDefault();
  }, []);

  const handleCloseAutoFocus = useCallback((event: Event) => {
    if (openedByHover.current) event.preventDefault();
    openedByHover.current = false;
  }, []);

  const settle = reduceMotion
    ? { duration: 0 }
    : {
        type: "spring" as const,
        duration: ACTIVITY_INDICATOR_SETTLE_SPRING.durationMs / 1000,
        bounce: 1 - ACTIVITY_INDICATOR_SETTLE_SPRING.dampingRatio,
      };

  return (
    <div className="shell-topbar-activity" data-busy={busy ? "true" : "false"}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <motion.button
            type="button"
            layout={reduceMotion ? false : "position"}
            transition={settle}
            className="shell-topbar-activity__trigger"
            data-open={open || undefined}
            disabled={!busy}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            onClick={handleTriggerClick}
            onFocus={preloadActivityOverview}
            aria-label={
              busy && label
                ? t("app.chat.activityPill.openActivity", { label })
                : t("app.chat.activityPill.idle")
            }
          >
            <motion.span
              className="shell-topbar-activity__mark"
              style={{ scale: popScale }}
            >
              <StellaCharacter
                size={MARK_SIZE_PX}
                state={markState}
                eyeColor={MARK_EYE_COLOR}
                paused={!windowFocused}
              />
            </motion.span>
            <AnimatePresence initial={false} mode="wait">
              {busy && label ? (
                <motion.span
                  key={label}
                  className="shell-topbar-activity__label"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{
                    opacity: 0,
                    transition: reduceMotion
                      ? { duration: 0 }
                      : {
                          duration: ACTIVITY_INDICATOR_LABEL_OUT_MS / 1000,
                          delay: 0,
                        },
                  }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : {
                          duration: ACTIVITY_INDICATOR_LABEL_IN_MS / 1000,
                          delay: ACTIVITY_INDICATOR_LABEL_IN_DELAY_MS / 1000,
                        }
                  }
                >
                  <TextShimmer
                    text={label}
                    durationMs={LABEL_SHIMMER_MS}
                    exclusiveGroup={CHAT_ACTIVITY_SHIMMER_GROUP}
                    exclusivePriority={30}
                  />
                </motion.span>
              ) : null}
            </AnimatePresence>
          </motion.button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className="shell-topbar-activity-menu-popover"
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <ActivityMenu onNavigate={closeMenu} />
        </PopoverContent>
      </Popover>
    </div>
  );
});
