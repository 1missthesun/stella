import { useCallback, useState } from "react";
import type { CloudBrowserDeviceCodeDetail, CloudBrowserInteractionDetail, CloudBrowserInteractionSummary } from "@stella/contracts/cloud-browser";
import { showToast } from "@/ui/toast";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { openExternalUrl } from "@/platform/electron/open-external";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { useCloudBrowserActions, useCurrentConversationBrowserInteraction } from "@/features/cloud/use-cloud-browser-interactions";
import { useT } from "@/shared/i18n";
import { APP_TRACKING, Button } from "../kit/compat";
import { Icon, Icons, type IconData } from "../kit";
import { derive, fontSize, mixOklch, useTokens } from "../theme";

const publicVerificationUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const displayName = (interaction: CloudBrowserInteractionSummary): string => {
  try {
    return new URL(interaction.displayOrigin).host;
  } catch {
    return interaction.displayOrigin;
  }
};

const deviceCodeDetail = (detail: CloudBrowserInteractionDetail | null | undefined): CloudBrowserDeviceCodeDetail | null => (detail?.kind === "device_code" ? detail : null);

const WRAP_W = 720;
const NARROW_W = 600;

/** desktop-ui's `CloudBrowserInterventionCard`: a cloud browser waiting on a sign-in takeover or a device code. */
export function CloudBrowserInterventionCard({ compact = false, conversationId }: { compact?: boolean; conversationId?: string | null }) {
  const t = useT();
  const tokens = useTokens();
  const look = derive(tokens, "cloud-browser-intervention", (k) => ({ tile: mixOklch(k.c.accent, 10, "transparent"), code: mixOklch(k.c.foreground, 7, "transparent") }));
  const { summary, detail } = useCurrentConversationBrowserInteraction(conversationId);
  const { decide } = useCloudBrowserActions();
  const [busyDecision, setBusyDecision] = useState<"done" | "cancel" | null>(null);
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(Infinity);

  const decideInteraction = useCallback(
    async (decision: "done" | "cancel") => {
      if (!summary || busyDecision) return;
      setBusyDecision(decision);
      try {
        await decide({ interactionId: summary.interactionId, expectedRevision: detail?.revision ?? summary.revision, decision });
      } catch {
        showToast({ title: t("cloudBrowser.errors.decision"), variant: "error" });
      } finally {
        setBusyDecision(null);
      }
    },
    [busyDecision, decide, detail?.revision, summary, t],
  );

  if (!summary) return null;

  const device = deviceCodeDetail(detail);
  const origin = displayName(summary);
  const resuming = summary.state === "resuming";
  const title = summary.kind === "device_code" ? t("cloudBrowser.deviceCode.title", { origin }) : resuming ? t("cloudBrowser.takeover.checking", { origin }) : t("cloudBrowser.takeover.title", { origin });

  const copyCode = async () => {
    if (!device) return;
    setCopied(await copyTextToClipboard(device.userCode));
  };

  const openVerification = () => {
    if (!device) return;
    const url = publicVerificationUrl(device.verificationUriComplete ?? device.verificationUri);
    if (!url) {
      showToast({ title: t("cloudBrowser.errors.verificationUrl"), variant: "error" });
      return;
    }
    openExternalUrl(url);
  };

  const wraps = compact || width < WRAP_W;
  const sub = (text: string) => (
    <text mt={2} size={fontSize.xs} lineHeight={fontSize.xs * 1.4} tracking={APP_TRACKING} color={tokens.c.textWeak}>
      {text}
    </text>
  );
  const iconLabel = (icon: IconData, label: string, color?: string) => (
    <row align="center" gap={5}>
      <Icon icon={icon} size={14} color={color} />
      <text size={12} weight={500} color={color} nowrap>
        {label}
      </text>
    </row>
  );

  const card = (
    <row
      role="status"
      label={title}
      w="full"
      maxW={compact ? undefined : 800}
      align={wraps ? "start" : "center"}
      wrap={wraps}
      gap={10}
      py={(compact ? 9 : 8) + 1}
      px={10 + 1}
      border={tokens.c.borderWeak}
      radius={12}
      fill={tokens.c.surfaceRaised}
      enter={{ opacity: 0, y: 6, dur: 0.2, bounce: 0 }}
    >
      <box w={26} h={26} radius={8} fill={look.tile} center shrink={false}>
        <Icon icon={resuming ? Icons.stella.Check : Icons.stella.Lock} size={16} color={tokens.c.textStrong} />
      </box>
      <col grow={1} minW={Math.min(180, width)} w={wraps ? 180 : undefined}>
        <text size={fontSize.sm} lineHeight={fontSize.sm * 1.45} weight={500} tracking={APP_TRACKING} color={tokens.c.textStrong}>
          {title}
        </text>
        {summary.kind === "device_code" ? (
          device ? (
            <col align="start">
              <box mt={6} py={5} px={8} radius={7} fill={look.code} label={t("cloudBrowser.deviceCode.codeLabel")}>
                <text family="mono" size={fontSize.base} weight={600} tracking={fontSize.base * 0.08} color={tokens.c.textStrong} selectable>
                  {device.userCode}
                </text>
              </box>
              {sub(t("cloudBrowser.deviceCode.body"))}
            </col>
          ) : (
            sub(t("common.loading"))
          )
        ) : (
          sub(resuming ? t("cloudBrowser.takeover.resumingBody") : t("cloudBrowser.takeover.body"))
        )}
      </col>
      {!resuming ? (
        <row align="center" justify="end" gap={6} wrap shrink={false} w={wraps && !compact ? "full" : undefined}>
          <Button type="button" variant="ghost" className="pill-btn" disabled={Boolean(busyDecision)} onClick={() => void decideInteraction("cancel")}>
            {busyDecision === "cancel" ? t("cloudBrowser.actions.canceling") : t("common.cancel")}
          </Button>
          {summary.kind === "login_takeover" ? (
            <Button type="button" variant="primary" className="pill-btn pill-btn--primary" onClick={() => sidebarSections.openLocation("takeover", summary.interactionId)}>
              {t("common.continue")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" className="pill-btn" disabled={!device} onClick={() => void copyCode()}>
                {iconLabel(copied ? Icons.stella.Check : Icons.stella.Copy, copied ? t("cloudBrowser.deviceCode.copied") : t("cloudBrowser.deviceCode.copy"), tokens.c.textWeak)}
              </Button>
              <Button type="button" variant="primary" className="pill-btn pill-btn--primary" disabled={!device} onClick={openVerification}>
                {iconLabel(Icons.stella.ExternalLink, t("cloudBrowser.deviceCode.open"), tokens.c.interactiveForeground)}
              </Button>
              <Button type="button" variant="ghost" className="pill-btn" disabled={Boolean(busyDecision) || !device} onClick={() => void decideInteraction("done")}>
                {busyDecision === "done" ? t("cloudBrowser.actions.finishing") : t("cloudBrowser.actions.done")}
              </Button>
            </>
          )}
        </row>
      ) : null}
      {detail === null ? (
        <row role="alert" align="center" gap={5}>
          <Icon icon={Icons.stella.AlertCircle} size={14} color={tokens.c.danger} />
          <text size={fontSize.xs} tracking={APP_TRACKING} color={tokens.c.danger}>
            {t("cloudBrowser.errors.expired")}
          </text>
        </row>
      ) : null}
    </row>
  );

  if (compact) return <col w="full" mb={8}>{card}</col>;
  return (
    <row w="full" justify="center" px={width < NARROW_W ? 8 : 48} mb={10} onSize={(r) => setWidth(r.w)}>
      {card}
    </row>
  );
}
