import type { ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { derive, fontSize, mix, radius, useTokens } from "../theme";
import { panelSurface } from "./surfaces";

type FilePreviewCardShellProps = {
  eyebrow: string;
  title: string;
  titlePath: string;
  meta?: ReactNode;
  actionStatus?: string | null;
  hideActions?: boolean;
  onSave: () => void;
  onCopy: () => void;
  mt?: number;
  children: ReactNode;
};

function ShellAction({ label, onPress }: { label: string; onPress: () => void }) {
  const tokens = useTokens();
  const hover = derive(tokens, "file-preview-card:action", (k) => mix(k.c.foreground, 12, k.c.primary));
  return (
    <box role="button" focusable py={6} px={12} radius={radius.md} fill={tokens.c.primary} hoverFill={hover} focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }} onPress={onPress}>
      <text size={fontSize.sm} color={tokens.c.primaryForeground}>
        {label}
      </text>
    </box>
  );
}

export function FilePreviewCardShell({ eyebrow, title, titlePath, meta, actionStatus, hideActions = false, onSave, onCopy, mt, children }: FilePreviewCardShellProps) {
  const t = useT();
  const tokens = useTokens();
  const surface = panelSurface(tokens);
  return (
    <col w="full" mt={mt} radius={radius.lg} clip={radius.lg} gradient={surface.gradient} border={surface.border} shadows={surface.shadows}>
      <row align="start" justify="between" gap={12} pt={12 + 1} px={14 + 1} pb={12 + 1} fill={tokens.c.surfaceInset} borderSides={[0, 0, 1, 0]} border={tokens.c.border}>
        <col minW={0}>
          <text mb={4} size={fontSize.xs} weight={600} tracking={fontSize.xs * 0.08} textCase="upper" color={tokens.c.mutedForeground}>
            {eyebrow}
          </text>
          <text size={fontSize.md} weight={600} color={tokens.c.foreground} title={titlePath} nowrap truncate>
            {title}
          </text>
        </col>
        {meta}
        {hideActions ? null : (
          <row shrink={false} align="center" gap={8}>
            <ShellAction label={t("app.chat.filePreview.save")} onPress={onSave} />
            <ShellAction label={t("app.chat.filePreview.copy")} onPress={onCopy} />
            {actionStatus ? (
              <text size={fontSize.sm} color={tokens.c.mutedForeground}>
                {actionStatus}
              </text>
            ) : null}
          </row>
        )}
      </row>
      {children}
    </col>
  );
}
