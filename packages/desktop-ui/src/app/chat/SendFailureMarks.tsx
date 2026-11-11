import {
  browserAttachmentUploads,
  useBrowserAttachmentUploads,
} from "@/features/cloud/browser-chat-attachments";
import { cloudSendRecovery } from "@/features/cloud/cloud-send-recovery";
import { useEffect, useState } from "react";
import "./send-failure-marks.css";

export const isBrowserUploadId = (id: string | undefined): id is string =>
  Boolean(id?.startsWith("upload-"));

/** The only upload state a tile shows: a small red mark that retries on click. */
export function UploadFailedMark({ uploadId }: { uploadId: string }) {
  const uploads = useBrowserAttachmentUploads();
  const upload = uploads.find((entry) => entry.id === uploadId);
  if (upload?.status !== "error") return null;
  return (
    <button
      type="button"
      className="upload-failed-mark"
      title={`${upload.error ?? "Upload failed."} Click to retry.`}
      aria-label={`Retry uploading ${upload.name}`}
      onClick={(event) => {
        event.stopPropagation();
        browserAttachmentUploads.retry(uploadId);
      }}
    >
      !
    </button>
  );
}

export function SendFailedMark({
  clientMsgId,
  reason,
}: {
  clientMsgId: string;
  reason: string;
}) {
  return (
    <div className="send-failed-mark" title={reason}>
      <span className="send-failed-mark__dot" aria-hidden="true">
        !
      </span>
      <span>Not sent</span>
      <button
        type="button"
        onClick={() => cloudSendRecovery()?.retry(clientMsgId)}
      >
        Retry
      </button>
      <button
        type="button"
        onClick={() => cloudSendRecovery()?.dismiss(clientMsgId)}
      >
        Remove
      </button>
    </div>
  );
}

/** A just-sent message usually reaches the shared chat in well under this. */
const PENDING_MARK_DELAY_MS = 3_000;

const PENDING_COPY = {
  sending: {
    label: "Sending…",
    title: "Saved on this computer. It goes to Stella as soon as she's back.",
  },
  unsynced: {
    label: "Not synced yet",
    title:
      "Saved on this computer. It's added to this chat on your other devices once Stella reconnects.",
  },
} as const;

export function SendPendingMark({
  state,
  sinceMs,
}: {
  state: "sending" | "unsynced";
  sinceMs: number | null;
}) {
  const [shown, setShown] = useState(
    () => sinceMs === null || Date.now() - sinceMs >= PENDING_MARK_DELAY_MS,
  );
  useEffect(() => {
    if (shown) return;
    const wait = PENDING_MARK_DELAY_MS - (Date.now() - (sinceMs ?? 0));
    const timer = window.setTimeout(() => setShown(true), Math.max(0, wait));
    return () => window.clearTimeout(timer);
  }, [shown, sinceMs]);
  if (!shown) return null;
  const copy = PENDING_COPY[state];
  return (
    <div className="send-pending-mark" title={copy.title} role="status">
      <span className="send-pending-mark__dot" aria-hidden="true" />
      <span>{copy.label}</span>
    </div>
  );
}
