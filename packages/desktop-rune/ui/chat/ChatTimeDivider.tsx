import { memo, useSyncExternalStore } from "react";
import { onServerClockMove } from "@stella/contracts/server-clock";
import { useLocale } from "@/shared/i18n";
import { formatTimestampHeader } from "@/features/chat/lib/message-time-labels";
import { fontSize, useTokens } from "../theme";

export const ChatTimeDivider = memo(function ChatTimeDivider({ timestampMs }: { timestampMs: number }) {
  const t = useTokens();
  const locale = useLocale();
  const label = useSyncExternalStore(onServerClockMove, () => formatTimestampHeader(timestampMs, locale));
  return (
    <row w="full" justify="center" pt={4} pb={12}>
      <text size={fontSize.xs} weight={500} lineHeight={Math.round(fontSize.xs * 1.45 * 100) / 100} tracking={fontSize.xs * 0.01} features="'tnum' 1" color={t.c.textWeaker}>
        {label}
      </text>
    </row>
  );
});
