import type { OfficePreviewRef } from "@stella/contracts/office-preview";
import { useOfficePreview } from "@/features/chat/office-preview-store";
import { useFilePreviewActions } from "@/features/chat/hooks/use-file-preview-actions";
import { PreviewProblem } from "@/shell/display/preview-states";
import { useT } from "@/shared/i18n";
import { fontSize, useTokens } from "../../theme";
import { FilePreviewCardShell } from "../FilePreviewCardShell";

const statusLabelKey = (status?: string) => {
  if (status === "ready") return "app.chat.officePreview.statusReady";
  if (status === "error") return "app.chat.officePreview.statusError";
  if (status === "stopped") return "app.chat.officePreview.statusStopped";
  return "app.chat.officePreview.statusPreparing";
};

export function OfficePreviewCard({ previewRef }: { previewRef: OfficePreviewRef }) {
  const t = useT();
  const tokens = useTokens();
  const { actionStatus, handleSave, handleCopy } = useFilePreviewActions({ sourcePath: previewRef.sourcePath, suggestedName: previewRef.title });
  const snapshot = useOfficePreview(previewRef.sessionId);
  const title = snapshot?.title ?? previewRef.title;
  const updatedAtLabel = snapshot?.updatedAt != null ? new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <FilePreviewCardShell
      mt={14}
      eyebrow={t(statusLabelKey(snapshot?.status))}
      title={title}
      titlePath={previewRef.sourcePath}
      meta={
        updatedAtLabel ? (
          <text shrink={false} size={fontSize.sm} color={tokens.c.mutedForeground}>
            {t("app.chat.officePreview.updatedAt", { time: updatedAtLabel })}
          </text>
        ) : null
      }
      actionStatus={actionStatus}
      onSave={handleSave}
      onCopy={handleCopy}
    >
      {snapshot?.status === "error" ? (
        <PreviewProblem size="compact" error={snapshot.error?.trim() || t("app.chat.officePreview.sessionError")} />
      ) : snapshot?.html ? (
        <webview w="full" minH={420} h={420} html={snapshot.html} label={t("app.chat.officePreview.frameTitle", { title })} fill={tokens.c.card} />
      ) : (
        <text py={18} px={16} size={fontSize.base} color={tokens.c.mutedForeground}>
          {t("app.chat.officePreview.preparingBody")}
        </text>
      )}
    </FilePreviewCardShell>
  );
}
