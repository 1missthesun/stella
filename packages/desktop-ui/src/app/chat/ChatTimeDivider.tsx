import { memo, useSyncExternalStore } from "react";
import { onServerClockMove } from "@stella/contracts/server-clock";
import { useLocale } from "@/shared/i18n";
import { formatTimestampHeader } from "@/features/chat/lib/message-time-labels";

export const ChatTimeDivider = memo(function ChatTimeDivider({
  timestampMs,
}: {
  timestampMs: number;
}) {
  const locale = useLocale();
  const label = useSyncExternalStore(onServerClockMove, () =>
    formatTimestampHeader(timestampMs, locale),
  );
  return (
    <div className="chat-time-divider">
      <time dateTime={new Date(timestampMs).toISOString()}>{label}</time>
    </div>
  );
});
