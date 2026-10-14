import { useEffect, useMemo, useRef, useState } from "react";
import type { CompanionState } from "@stella/contracts/desktop/companion";

export type CompanionBubble = {
  key: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
};

const FRESHNESS_GRACE_MS = 45_000;
const TURN_PAIRING_WINDOW_MS = 15 * 60_000;
const MIN_DWELL_MS = 6_000;
const MAX_DWELL_MS = 18_000;
const DWELL_PER_CHAR_MS = 38;
const RESUME_DWELL_MS = 3_000;
const FADE_MS = 280;

const dwellFor = (text: string) =>
  Math.min(
    MAX_DWELL_MS,
    Math.max(MIN_DWELL_MS, 4_000 + text.length * DWELL_PER_CHAR_MS),
  );

export function useCompanionBubbles(
  state: CompanionState,
  paused: boolean,
): { bubbles: CompanionBubble[]; visible: boolean } {
  const mountedAtRef = useRef(Date.now());
  const { latestUser, latestAssistant, isStreaming } = state;

  const bubbles = useMemo<CompanionBubble[]>(() => {
    const freshFloor = mountedAtRef.current - FRESHNESS_GRACE_MS;
    const user = latestUser && latestUser.at >= freshFloor ? latestUser : null;
    const assistant =
      latestAssistant && latestAssistant.at >= freshFloor
        ? latestAssistant
        : null;
    const out: CompanionBubble[] = [];
    if (assistant && (!user || assistant.at >= user.at)) {
      if (user && assistant.at - user.at < TURN_PAIRING_WINDOW_MS) {
        out.push({
          key: `u:${user.id}`,
          role: "user",
          text: user.text,
          streaming: false,
        });
      }
      out.push({
        key: `a:${assistant.id}`,
        role: "assistant",
        text: assistant.text,
        streaming: assistant.streaming,
      });
      return out;
    }
    if (user) {
      out.push({
        key: `u:${user.id}`,
        role: "user",
        text: user.text,
        streaming: false,
      });
      if (isStreaming) {
        out.push({
          key: `a:pending:${user.id}`,
          role: "assistant",
          text: "",
          streaming: true,
        });
      }
    }
    return out;
  }, [latestUser, latestAssistant, isStreaming]);

  const signature = bubbles
    .map((b) => `${b.key}:${b.streaming ? "s" : "f"}`)
    .join("|");
  const settled = bubbles.length > 0 && !bubbles.some((b) => b.streaming);
  const settledText = settled ? bubbles[bubbles.length - 1]!.text : "";

  const [hideAt, setHideAt] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const lastSignatureRef = useRef("");

  useEffect(() => {
    if (!signature) {
      setVisible(false);
      setHideAt(null);
      lastSignatureRef.current = "";
      return;
    }
    const changed = signature !== lastSignatureRef.current;
    lastSignatureRef.current = signature;
    if (changed) setVisible(true);
    if (!settled) {
      setHideAt(null);
      return;
    }
    if (changed) setHideAt(Date.now() + dwellFor(settledText));
  }, [signature, settled, settledText]);

  const wasPausedRef = useRef(paused);
  useEffect(() => {
    if (paused) {
      wasPausedRef.current = true;
      return;
    }
    if (wasPausedRef.current) {
      wasPausedRef.current = false;
      if (settled && visible) setHideAt(Date.now() + RESUME_DWELL_MS);
    }
  }, [paused, settled, visible]);

  useEffect(() => {
    if (paused || hideAt === null || !visible) return;
    const delay = Math.max(0, hideAt - Date.now());
    const timer = window.setTimeout(() => setVisible(false), delay);
    return () => window.clearTimeout(timer);
  }, [hideAt, paused, visible]);

  const [rendered, setRendered] = useState<CompanionBubble[]>([]);
  useEffect(() => {
    if (visible) {
      setRendered(bubbles);
      return;
    }
    const timer = window.setTimeout(() => setRendered([]), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [bubbles, visible]);

  return { bubbles: visible ? bubbles : rendered, visible };
}
