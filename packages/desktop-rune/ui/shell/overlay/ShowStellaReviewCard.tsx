import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ShowStellaReviewAction, ShowStellaReviewState } from "@stella/contracts/desktop/show-stella";
import { useT } from "@/shared/i18n";
import { Icon, Icons } from "../../kit";
import { systemFontFamily } from "../../theme/system-font";
import { useAuxWindow } from "../aux-window";

const KEEP_AFTER_MS = 20_000;
const HOVER_HOLD_MAX_MS = 60_000;
const CARD_WIDTH = 360;
const CARD_TOP = 14;

const INK = "#f4f2ec";
const MUTED = "#a9a7a0";
const RED = "#e5372b";

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function ShowStellaReviewCard({ state, onHover }: { state: ShowStellaReviewState; onHover: (hovered: boolean) => void }) {
  const t = useT();
  const { api } = useAuxWindow();
  const family = systemFontFamily();
  const [note, setNote] = useState("");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const answered = useRef(false);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const madeFocusable = useRef(false);
  const ready = state.status !== "preparing";
  const typing = focused || note.trim().length > 0;
  const readyAt = useRef<number | null>(null);
  if (ready && readyAt.current === null) readyAt.current = performance.now();

  const answer = (action: ShowStellaReviewAction) => {
    if (answered.current) return;
    answered.current = true;
    onHover(false);
    void api?.showStella?.review(action);
  };

  const keepCapture = useEffectEvent((captureId: string) => answer({ captureId, action: "keep" }));

  useEffect(() => {
    if (!ready || typing) return;
    const captureId = state.captureId;
    const wait = hovered ? Math.max(KEEP_AFTER_MS, (readyAt.current ?? performance.now()) + HOVER_HOLD_MAX_MS - performance.now()) : KEEP_AFTER_MS;
    const timer = setTimeout(() => keepCapture(captureId), wait);
    return () => clearTimeout(timer);
  }, [ready, typing, hovered, state.captureId]);

  useEffect(() => () => onHoverRef.current(false), []);

  const top = Math.max(state.display.y, 0) + CARD_TOP;
  const left = state.display.x + state.display.width / 2 - CARD_WIDTH / 2;
  const send = () => answer({ captureId: state.captureId, action: "send", note });
  const text = { family, size: 12.5, weight: 500, lineHeight: 12.5 * 1.3 };
  const buttonText = { family, size: 12.5, weight: 600, lineHeight: 12.5 };

  return (
    <col
      absolute={{ left, top }}
      w={CARD_WIDTH}
      gap={10}
      pad={10}
      radius={12}
      fill="#16161af5"
      shadows={[
        { x: 0, y: 0, blur: 0, spread: 1, color: "#ffffff0f" },
        { x: 0, y: 10, blur: 32, color: "#00000047" },
      ]}
      enter={{ opacity: 0, y: -6, dur: 0.18, bounce: 0 }}
      onHover={(inside) => {
        setHovered(inside);
        onHover(inside);
        if (inside && !madeFocusable.current) {
          madeFocusable.current = true;
          api?.showStella?.setReviewFocusable({ focusable: true });
        }
      }}
    >
      <row align="center" gap={10}>
        <box w={88} h={56} shrink={false} radius={6} clip={6} fill="#ffffff0f">
          {state.preview ? <image src={state.preview} w={88} h={56} fit="cover" label={t("app.chat.contextChips.showCapture.alt")} /> : null}
        </box>
        <col grow={1} minW={0} gap={3}>
          <row align="center" gap={6} minW={0}>
            <Icon icon={Icons.stella.Record} size={13} strokeWidth={1.75} color={RED} />
            <text {...text} weight={600} color={INK} nowrap truncate>
              {t("app.chat.contextChips.showCapture.title", { duration: clock(state.durationMs) })}
            </text>
          </row>
          {state.status === "preparing" ? (
            <text {...text} color={MUTED}>
              {t("app.chat.contextChips.showCapture.preparing")}
            </text>
          ) : null}
          {state.status === "failed" ? (
            <text {...text} color={MUTED}>
              {t("app.chat.contextChips.showCapture.failed")}
            </text>
          ) : null}
        </col>
        <box
          role="button"
          label={t("features.showStella.review.discard")}
          title={t("features.showStella.review.discard")}
          w={24}
          h={24}
          shrink={false}
          selfAlign="start"
          center
          radius={6}
          hoverFill="#ffffff14"
          hoverGroup
          cursor="pointer"
          onPress={() => answer({ captureId: state.captureId, action: "discard" })}
        >
          <Icon icon={Icons.stella.X} size={14} strokeWidth={2} color={MUTED} />
        </box>
      </row>
      <input
        value={note}
        placeholder={t("features.showStella.review.note")}
        placeholderColor="#7d7b75"
        {...text}
        color={INK}
        caretColor={INK}
        w="full"
        h={32}
        px={10 + 1}
        radius={8}
        border={focused ? "#ffffff47" : "#ffffff1f"}
        fill="#ffffff0a"
        onInput={setNote}
        onFocus={(on) => setFocused(on)}
        onSubmit={send}
      />
      <row justify="end" gap={6}>
        <box role="button" h={28} px={12 + 1} center radius={8} border="#ffffff24" hoverFill="#ffffff0f" cursor="pointer" onPress={() => answer({ captureId: state.captureId, action: "open" })}>
          <text {...buttonText} color={INK}>
            {t("features.showStella.review.open")}
          </text>
        </box>
        <box
          role="button"
          h={28}
          px={12}
          gap={6}
          center
          radius={8}
          fill={INK}
          hoverFill="#ffffff"
          disabled={state.status === "failed"}
          opacity={state.status === "failed" ? 0.4 : 1}
          cursor={state.status === "failed" ? "default" : "pointer"}
          onPress={state.status === "failed" ? undefined : send}
        >
          <text {...buttonText} color="#16161a">
            {t("features.showStella.review.send")}
          </text>
          <Icon icon={Icons.stella.ArrowUp} size={13} strokeWidth={2.25} color="#16161a" />
        </box>
      </row>
    </col>
  );
}
