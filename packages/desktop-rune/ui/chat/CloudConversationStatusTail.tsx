import { useEffect, useState } from "react";
import { steadyNow } from "@stella/contracts/server-clock";
import { cloudOfflineNoticeDueAt, idleCloudOfflineWindow, nextCloudOfflineWindow, shouldShowCloudOfflineNotice, type CloudOfflineWindow, type CloudSocketStatus } from "@stella/contracts/cloud-connection-notice";
import type { CloudConversationView } from "@/features/cloud/use-conversation";

const TAIL_MAX_W = 672;
const TEXT = "rgba(255, 255, 255, 0.68)";
const BORDER = "rgba(255, 255, 255, 0.1)";
const FILL = "rgba(255, 255, 255, 0.035)";
const HOVER_TEXT = "#ffffff";

const useSustainedCloudOffline = (status: CloudSocketStatus): boolean => {
  const [offlineWindow, setOfflineWindow] = useState<CloudOfflineWindow>(idleCloudOfflineWindow);
  const [nowMs, setNowMs] = useState(() => steadyNow());
  useEffect(() => {
    setOfflineWindow((current) => nextCloudOfflineWindow(current, status, steadyNow()));
  }, [status]);
  useEffect(() => {
    const dueAt = cloudOfflineNoticeDueAt(offlineWindow, status);
    if (dueAt === null) return;
    const now = steadyNow();
    if (now >= dueAt) {
      setNowMs((current) => (current >= dueAt ? current : now));
      return;
    }
    const timer = setTimeout(() => setNowMs(steadyNow()), dueAt - now + 1);
    return () => clearTimeout(timer);
  }, [offlineWindow, status]);
  return shouldShowCloudOfflineNotice(offlineWindow, status, nowMs);
};

function Notice({ status, children }: { status?: boolean; children: React.ReactNode }) {
  return (
    <row role={status ? "status" : undefined} w="full" align="center" justify="between" gap={12} py={8 + 1} px={10 + 1} border={BORDER} radius={10} fill={FILL}>
      {children}
    </row>
  );
}

/** desktop-ui's `CloudConversationStatusTail` (inside `use-cloud-chat-bridge`): the cloud connection and older-history notices under the timeline. */
export function CloudConversationStatusTail({ conversation }: { conversation: CloudConversationView }) {
  const { state, retryConnection } = conversation;
  const sustainedOffline = useSustainedCloudOffline(state.status);
  const showConnection = state.status === "blocked" || (state.status === "offline" && sustainedOffline);
  if (!showConnection && !state.olderNotice) return null;
  return (
    <col w="full" maxW={TAIL_MAX_W} selfAlign="center" mt={4} gap={8}>
      {showConnection ? (
        <Notice status>
          <text minW={0} shrink size={12} color={TEXT}>
            {state.statusMessage ?? "Reconnecting to Stella's cloud…"}
          </text>
          {state.status === "blocked" && state.statusRetryable ? (
            <box role="button" label="Retry" focusable cursor="pointer" shrink={false} hoverColor={HOVER_TEXT} onPress={retryConnection}>
              <text size={12} weight={600} color={TEXT}>
                Retry
              </text>
            </box>
          ) : null}
        </Notice>
      ) : null}
      {state.olderNotice ? (
        <Notice>
          <text minW={0} shrink size={12} color={TEXT}>
            {state.olderNotice}
          </text>
        </Notice>
      ) : null}
    </col>
  );
}
