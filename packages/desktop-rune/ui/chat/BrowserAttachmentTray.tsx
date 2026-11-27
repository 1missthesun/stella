import { memo } from "react";
import { browserAttachmentUploads, useBrowserAttachmentUploads } from "@/features/cloud/browser-chat-attachments";
import { platformCapabilities } from "@/platform/capabilities";
import { mixOklch, useTokens } from "../theme";
import { UploadFailedMark } from "./SendFailureMarks";

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const BrowserAttachmentTray = memo(function BrowserAttachmentTray() {
  const tokens = useTokens();
  const uploads = useBrowserAttachmentUploads().filter((upload) => upload.sentWith === null);
  if (!platformCapabilities.browserUploads || uploads.length === 0) return null;
  return (
    <box w="full" scrollX label="Attachments">
      <row gap={8} pt={8} px={10} pb={2}>
        {uploads.map((upload) => (
          <row key={upload.id} shrink={false} align="center" gap={8} minW={190} maxW={280} clip={10} py={7 + 1} px={8 + 1} radius={10} border={tokens.c.border} fill={mixOklch(tokens.c.background, 88, "transparent")}>
            {upload.previewUrl ? <image src={upload.previewUrl} label={upload.name} w={44} h={44} shrink={false} radius={7} fit="cover" fill={tokens.c.muted} /> : null}
            <col grow={1} minW={0}>
              <text size={12} weight={700} title={upload.name} nowrap truncate color={tokens.c.foreground}>
                {upload.name}
              </text>
              <text size={10} color={tokens.c.textMuted} nowrap truncate>
                {formatSize(upload.sizeBytes)}
              </text>
            </col>
            <UploadFailedMark uploadId={upload.id} />
            <box role="button" focusable label={`Remove ${upload.name}`} raise={1} onPress={() => browserAttachmentUploads.remove(upload.id)}>
              <text size={11} color={tokens.c.foreground}>
                ×
              </text>
            </box>
          </row>
        ))}
      </row>
    </box>
  );
});
