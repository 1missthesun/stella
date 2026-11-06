import { memo } from "react";
import {
  browserAttachmentUploads,
  useBrowserAttachmentUploads,
} from "@/features/cloud/browser-chat-attachments";
import { platformCapabilities } from "@/platform/capabilities";
import { UploadFailedMark } from "./SendFailureMarks";

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const BrowserAttachmentTray = memo(function BrowserAttachmentTray() {
  const uploads = useBrowserAttachmentUploads().filter(
    (upload) => upload.sentWith === null,
  );
  if (!platformCapabilities.browserUploads || uploads.length === 0) return null;
  return (
    <div className="browser-attachment-tray" aria-label="Attachments">
      {uploads.map((upload) => (
        <div
          className="browser-attachment-chip"
          data-image={upload.previewUrl ? "true" : undefined}
          key={upload.id}
        >
          {upload.previewUrl ? (
            <img
              className="browser-attachment-chip__thumbnail"
              src={upload.previewUrl}
              alt={upload.name}
            />
          ) : null}
          <div className="browser-attachment-chip__copy">
            <strong title={upload.name}>{upload.name}</strong>
            <small>{formatSize(upload.sizeBytes)}</small>
          </div>
          <UploadFailedMark uploadId={upload.id} />
          <button
            type="button"
            aria-label={`Remove ${upload.name}`}
            onClick={() => browserAttachmentUploads.remove(upload.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
});
