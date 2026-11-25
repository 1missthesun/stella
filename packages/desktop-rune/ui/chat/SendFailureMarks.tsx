import { useEffect, useState } from "react";
import { serverNow } from "@stella/contracts/server-clock";
import { browserAttachmentUploads, useBrowserAttachmentUploads } from "@/features/cloud/browser-chat-attachments";
import { cloudSendRecovery } from "@/features/cloud/cloud-send-recovery";
import { radius, useTokens } from "../theme";

export const isBrowserUploadId = (id: string | undefined): id is string => Boolean(id?.startsWith("upload-"));

const MARK_TEXT = { size: 12, lineHeight: 17 };

export function UploadFailedMark({ uploadId, at = { left: 4, bottom: 4 } }: { uploadId: string; at?: { left: number; bottom: number } }) {
  const t = useTokens();
  const uploads = useBrowserAttachmentUploads();
  const upload = uploads.find((entry) => entry.id === uploadId);
  if (upload?.status !== "error") return null;
  return (
    <box
      absolute={at}
      raise
      w={16}
      h={16}
      center
      radius={radius.full}
      border="#ffffff"
      borderWidth={1.5}
      fill={t.c.destructive}
      shadow={[1, 3, "#00000040"]}
      role="button"
      focusable
      cursor="pointer"
      title={`${upload.error ?? "Upload failed."} Click to retry.`}
      label={`Retry uploading ${upload.name}`}
      onPress={() => browserAttachmentUploads.retry(uploadId)}
    >
      <text size={10} weight={600} lineHeight={10} color="#ffffff">
        !
      </text>
    </box>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTokens();
  return (
    <box role="button" focusable cursor="pointer" hoverGroup onPress={onPress}>
      <text {...MARK_TEXT} color={t.c.textMuted} hoverColor={t.c.foreground} underline>
        {label}
      </text>
    </box>
  );
}

export function SendFailedMark({ clientMsgId, reason }: { clientMsgId: string; reason: string }) {
  const t = useTokens();
  return (
    <row justify="end" align="center" gap={6} mt={4} title={reason}>
      <box w={14} h={14} center radius={radius.full} fill={t.c.destructive}>
        <text size={9} weight={600} lineHeight={9} color="#ffffff">
          !
        </text>
      </box>
      <text {...MARK_TEXT} color={t.c.textMuted}>
        Not sent
      </text>
      <LinkButton label="Retry" onPress={() => cloudSendRecovery()?.retry(clientMsgId)} />
      <LinkButton label="Remove" onPress={() => cloudSendRecovery()?.dismiss(clientMsgId)} />
    </row>
  );
}

const PENDING_MARK_DELAY_MS = 3_000;

const PENDING_COPY = {
  sending: { label: "Sending…", title: "Saved on this computer. It goes to Stella as soon as she's back." },
  unsynced: { label: "Not synced yet", title: "Saved on this computer. It's added to this chat on your other devices once Stella reconnects." },
} as const;

export function SendPendingMark({ state, sinceMs }: { state: "sending" | "unsynced"; sinceMs: number | null }) {
  const t = useTokens();
  const [shown, setShown] = useState(() => sinceMs === null || serverNow() - sinceMs >= PENDING_MARK_DELAY_MS);
  useEffect(() => {
    if (shown) return;
    const wait = PENDING_MARK_DELAY_MS - (serverNow() - (sinceMs ?? 0));
    const timer = setTimeout(() => setShown(true), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [shown, sinceMs]);
  if (!shown) return null;
  const copy = PENDING_COPY[state];
  return (
    <row justify="end" align="center" gap={6} mt={4} title={copy.title} role="status">
      <box w={6} h={6} radius={radius.full} fill={t.c.textMuted} opacity={0.6} />
      <text {...MARK_TEXT} color={t.c.textMuted}>
        {copy.label}
      </text>
    </row>
  );
}
