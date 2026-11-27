import { useSyncExternalStore } from "react";
import { voiceSessionErrorStore } from "@/features/voice/runtime/voice-session-error-state";
import { useT } from "@/shared/i18n";
import { Icon, Icons } from "../kit";
import { fontSize, radius, useTokens } from "../theme";
import { panelSurface } from "./surfaces";

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
};

const TEXT = { size: fontSize.base, lineHeight: Math.round(fontSize.base * 1.2 * 100) / 100, tracking: fontSize.base * -0.01 };

/** desktop-ui's `VoiceSessionCard`: the "Voice" pill with the session length, or the reason it failed. */
export function VoiceSessionCard({ durationMs }: { durationMs: number }) {
  const t = useT();
  const tokens = useTokens();
  const sessionError = useSyncExternalStore(voiceSessionErrorStore.subscribe, voiceSessionErrorStore.getSnapshot, voiceSessionErrorStore.getServerSnapshot);
  const surface = panelSurface(tokens);
  return (
    <row selfAlign="start" w="fit" maxW="full" align={sessionError ? "start" : "center"} gap={8} py={7 + 1} pl={11 + 1} pr={13 + 1} radius={sessionError ? 14 : radius.full} {...surface}>
      <Icon icon={sessionError ? Icons.stella.AlertCircle : Icons.stella.AudioLines} size={13} strokeWidth={1.75} color={tokens.c.textWeak} />
      <text {...TEXT} weight={500} color={tokens.c.textStrong} nowrap truncate shrink={false}>
        {t("app.chat.voiceSession.label")}
      </text>
      {sessionError ? (
        <text {...TEXT} color={tokens.c.textWeak} shrink minW={0}>
          {sessionError}
        </text>
      ) : (
        <text {...TEXT} color={tokens.c.textWeak} features="'tnum' 1">
          {formatDuration(durationMs)}
        </text>
      )}
    </row>
  );
}
