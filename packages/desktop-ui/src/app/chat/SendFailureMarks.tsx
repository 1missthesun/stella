import {
  browserAttachmentUploads,
  useBrowserAttachmentUploads,
} from "@/features/cloud/browser-chat-attachments";
import { cloudSendRecovery } from "@/features/cloud/cloud-send-recovery";
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
