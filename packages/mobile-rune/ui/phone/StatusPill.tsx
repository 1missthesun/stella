import { memo, useEffect, useMemo, useRef, useState } from "react";
import { activityIndicatorTransition, selectActivityIndicatorLabel, ACTIVITY_INDICATOR_SPAWN_BEAT_MS, type ActivityIndicatorPhase } from "@stella/contracts/activity-indicator";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { countPausedActivityRows, deriveRunningActivityIndicatorEntries } from "@/features/chat/lib/event-transforms";
import { pickWorkingIndicatorToolPose } from "@/features/chat/working-indicator-state";
import { useT, useTPlural } from "@/shared/i18n";
import { StellaCharacter } from "../../../desktop-rune/ui/kit/StellaCharacter";
import { useTokens } from "../../../desktop-rune/ui/theme";
import { BODY_TEXT, TextScope } from "../../../desktop-rune/ui/kit/compat";
import { ActivityOverview } from "../../../desktop-rune/ui/shell/sidebar-sections/HomeSection";
import { Panel } from "../../../desktop-rune/ui/shell/topbar/chrome";
import { AdaptiveGlass, GlassSheen, useGlassBackdrop } from "../../../desktop-rune/ui/shell/glass";
import { CHAT_ACTIVITY_SHIMMER_GROUP, TextShimmer } from "../../../desktop-rune/ui/chat/TextShimmer";
import { phoneGlass, rt } from "./rn";

// packages/mobile's StellaStatusHeader: Stella's mark in a round glass pill in the middle of the
// top bar, which widens into a capsule with what she's doing while she works (StatusPill: 44 pt
// tall, the mark inset 7 pt; at rest the soft StellaMarkHero, while working the star). Pressed while
// she works, it shows the activity.

const HEIGHT = 44;
const INSET = 7;
const MARK = HEIGHT - INSET * 2;
const LABEL = rt(15, 600, -0.2);

export const StatusPill = memo(function StatusPill({ maxWidth }: { maxWidth: number }) {
  const t = useT();
  const tk = useTokens();
  const tPlural = useTPlural();
  const chat = useChatRuntime();
  const tasks = chat.conversation.tasks;
  const running = useMemo(() => deriveRunningActivityIndicatorEntries(tasks), [tasks]);
  const count = running.length;
  const label = selectActivityIndicatorLabel(running, (total) => tPlural("app.chat.activityPill.tasksInProgress", total));
  const pausedCount = useMemo(() => countPausedActivityRows(tasks), [tasks]);
  const [phase, setPhase] = useState<ActivityIndicatorPhase>(count > 0 ? "working" : "idle");
  const [pop, setPop] = useState(0);
  const previous = useRef(count);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    const transition = activityIndicatorTransition(count, before);
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
  useEffect(() => {
    if (!hasActivity) setOpen(false);
  }, [hasActivity]);
  const markState = busy && phase === "working" ? pickWorkingIndicatorToolPose(running[0]?.id ?? "stella") : "idle";
  const m = phoneGlass(tk);
  const backdrop = useGlassBackdrop();
  const showLabel = busy && label !== null && maxWidth > HEIGHT * 2;
  const ariaLabel = busy && label ? t("app.chat.activityPill.openActivity", { label }) : t("app.chat.activityPill.idle");

  return (
    <>
      <AdaptiveGlass>
        <row
          id="phone-status-pill"
          role="button"
          label={ariaLabel}
          focusable={hasActivity}
          h={HEIGHT}
          minW={HEIGHT}
          maxW={maxWidth}
          pl={INSET}
          pr={showLabel ? 16 : INSET}
          gap={8}
          align="center"
          radius={HEIGHT / 2}
          fx={m.fx}
          fill={m.fill}
          border={m.border}
          onBackdrop={backdrop}
          layout={0.4}
          pressScale={hasActivity ? 0.95 : undefined}
          onPress={hasActivity ? () => setOpen((o) => !o) : undefined}
        >
          <GlassSheen radius={HEIGHT / 2} />
          <box key={`pop-${pop}`} w={MARK} h={MARK} center shrink={false} enter={pop > 0 ? { scale: 1.18, dur: 0.38, bounce: 0.35 } : undefined}>
            <StellaCharacter size={MARK} state={markState} shape={busy ? "star" : "pebble"} eyeColor={tk.c.background} />
          </box>
          {showLabel ? (
            <box key={label} minW={0} shrink enter={{ opacity: 0, dur: 0.18 }} exit={{ opacity: 0, dur: 0.12 }}>
              <TextShimmer text={label!} look={LABEL} durationMs={1900} exclusiveGroup={CHAT_ACTIVITY_SHIMMER_GROUP} exclusivePriority={30} />
            </box>
          ) : null}
        </row>
      </AdaptiveGlass>
      <Panel id="phone-status-pill-menu" anchor="phone-status-pill" open={open} onClose={() => setOpen(false)} align="center" gap={8} w={Math.min(352, window.innerWidth - 32)} maxH={Math.min(window.innerHeight * 0.6, 512)}>
        <col w="full" maxH={Math.min(window.innerHeight * 0.6, 512)} clip={0}>
          <TextScope base={BODY_TEXT}>
            <ActivityOverview onNavigate={() => setOpen(false)} />
          </TextScope>
        </col>
      </Panel>
    </>
  );
});
