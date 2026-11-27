import { serverNow } from "@stella/contracts/server-clock";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cloudBrowserLiveViewViewport, type CloudBrowserDeviceCodeDetail, type CloudBrowserInteractionDetail, type CloudBrowserLiveViewCapability, type CloudBrowserLiveViewViewport } from "@stella/contracts/cloud-browser";
import { useDisplayPanelOpen } from "@/features/workspace-display/tab-store";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useT } from "@/shared/i18n";
import { useCloudBrowserActions, useCloudBrowserInteraction } from "@/features/cloud/use-cloud-browser-interactions";
import { parseCloudBrowserLiveViewUrl } from "@/features/cloud/cloud-browser-live-view";
import { Icon, Icons, Pill, showToast } from "../../kit";
import { Button } from "../../kit/compat";
import { font, fontSize, look, mixOklch, useTokens } from "../../theme";

const closeTakeoverTab = (interactionId: string) => {
  const tab = sidebarSections.getSnapshot().tabs.find((candidate) => candidate.kind === "takeover" && candidate.location === interactionId);
  if (tab) sidebarSections.closeTab(tab.id);
};

const publicVerificationUrl = (detail: CloudBrowserDeviceCodeDetail) => {
  try {
    const url = new URL(detail.verificationUriComplete ?? detail.verificationUri);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const LIVE_VIEW_RESIZE_SETTLE_MS = 400;

const subscribeResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};
const isNarrowWindow = () => window.innerWidth <= 520;

/** The frame host's size, settled after a resize so the live view isn't minted again mid-drag. */
function useSettledViewport(): [CloudBrowserLiveViewViewport | null, (size: { w: number; h: number }) => void] {
  const [viewport, setViewport] = useState<CloudBrowserLiveViewViewport | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const measured = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onSize = useCallback(({ w, h }: { w: number; h: number }) => {
    const next = cloudBrowserLiveViewViewport(w, h);
    if (!next) return;
    clearTimeout(timer.current);
    const apply = () => setViewport((current) => (current && current.width === next.width && current.height === next.height ? current : next));
    if (!measured.current) {
      measured.current = true;
      apply();
    } else timer.current = setTimeout(apply, LIVE_VIEW_RESIZE_SETTLE_MS);
  }, []);
  return [viewport, onSize];
}

/** `.cloud-browser-takeover__status`: an alert or a wait, centred. */
function Status({ role, alert = false, children }: { role: "alert" | "status"; alert?: boolean; children: string }) {
  const t = useTokens();
  return (
    <col role={role} grow={1} minW={0} align="center" justify="center" gap={10} py={28} px={22}>
      {alert ? <Icon icon={Icons.stella.AlertCircle} size={22} color={t.c.textWeak} /> : null}
      <text {...look(fontSize.base, 700)} color={t.c.textStrong} textAlign="center">
        {children}
      </text>
    </col>
  );
}

function CloudBrowserLiveView({ detail }: { detail: Extract<CloudBrowserInteractionDetail, { kind: "login_takeover" }> }) {
  const t = useT();
  const { mintLiveView } = useCloudBrowserActions();
  const [viewport, onSize] = useSettledViewport();
  const [capability, setCapability] = useState<CloudBrowserLiveViewCapability | null>(null);
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    if (!viewport) return;
    let disposed = false;
    setIssue(null);
    void mintLiveView({ interactionId: detail.interactionId, expectedRevision: detail.revision, viewport })
      .then((next) => {
        if (disposed) return;
        const url = parseCloudBrowserLiveViewUrl(next.url);
        if (!url || next.interactionId !== detail.interactionId || next.revision !== detail.revision || next.expiresAt <= serverNow()) {
          setIssue(t("cloudBrowser.errors.liveViewBoundary"));
          return;
        }
        setCapability({ ...next, url: url.toString() });
      })
      .catch(() => {
        if (!disposed) setIssue(t("cloudBrowser.errors.liveView"));
      });
    return () => {
      disposed = true;
    };
  }, [detail.interactionId, detail.revision, mintLiveView, t, viewport]);

  return (
    <col id="cloud-browser-takeover-frame-host" grow={1} minW={0} minH={0} onLayout={onSize}>
      {issue ? (
        <Status role="alert" alert>
          {issue}
        </Status>
      ) : !capability ? (
        <Status role="status">{t("cloudBrowser.takeover.preparing")}</Status>
      ) : (
        <webview key={capability.url} id="cloud-browser-takeover-frame" url={capability.url} title={t("cloudBrowser.takeover.frameTitle", { origin: detail.displayOrigin })} w="full" h="full" fill="#ffffff" />
      )}
    </col>
  );
}

function DeviceCodeSurface({ detail }: { detail: CloudBrowserDeviceCodeDetail }) {
  const t = useT();
  const tk = useTokens();
  const [copied, setCopied] = useState(false);
  const openVerification = () => {
    const url = publicVerificationUrl(detail);
    if (!url) {
      showToast({ title: t("cloudBrowser.errors.verificationUrl"), variant: "error" });
      return;
    }
    openExternalUrl(url);
  };
  return (
    <col id="cloud-browser-takeover-device" grow={1} minW={0} align="center" justify="center" gap={10} py={28} px={22}>
      <Icon icon={Icons.stella.Lock} size={26} color={tk.c.textWeak} />
      <text role="heading" {...look(fontSize.base, 700)} color={tk.c.textStrong} textAlign="center" balance>
        {t("cloudBrowser.deviceCode.title", { origin: detail.displayOrigin })}
      </text>
      <text {...look(fontSize.base, 400, { lh: 1.5 })} maxW={34 * 7.4} color={tk.c.textWeak} textAlign="center" balance>
        {t("cloudBrowser.deviceCode.body")}
      </text>
      <box py={9} px={12} radius={9} fill={mixOklch(tk.c.foreground, 7, "transparent")}>
        <text size={fontSize.lg} weight={600} tracking={fontSize.lg * 0.1} family={font.mono} color={tk.c.textStrong} selectable>
          {detail.userCode}
        </text>
      </box>
      <row align="center" gap={7}>
        <Pill id="cloud-browser-device-copy" icon={copied ? Icons.stella.Check : Icons.stella.Copy} gap={5} onPress={() => void copyTextToClipboard(detail.userCode).then(setCopied)}>
          {copied ? t("cloudBrowser.deviceCode.copied") : t("cloudBrowser.deviceCode.copy")}
        </Pill>
        <Pill id="cloud-browser-device-open" tone="primary" icon={Icons.stella.ExternalLink} gap={5} onPress={openVerification}>
          {t("cloudBrowser.deviceCode.open")}
        </Pill>
      </row>
    </col>
  );
}

/** desktop-ui's `CloudBrowserTakeoverSection`: a cloud browser sign-in the user finishes here, live or by device code. */
export function CloudBrowserTakeoverSection({ location, active }: { location: string | null; active: boolean }) {
  const t = useT();
  const tk = useTokens();
  const panelOpen = useDisplayPanelOpen();
  const narrow = useSyncExternalStore(subscribeResize, isNarrowWindow);
  const detail = useCloudBrowserInteraction(location);
  const { decide } = useCloudBrowserActions();
  const [busyDecision, setBusyDecision] = useState<"done" | "cancel" | null>(null);

  const decideInteraction = useCallback(
    async (decision: "done" | "cancel") => {
      if (!detail || busyDecision) return;
      setBusyDecision(decision);
      try {
        await decide({ interactionId: detail.interactionId, expectedRevision: detail.revision, decision });
        closeTakeoverTab(detail.interactionId);
      } catch {
        showToast({ title: t("cloudBrowser.errors.decision"), variant: "error" });
      } finally {
        setBusyDecision(null);
      }
    },
    [busyDecision, decide, detail, t],
  );

  const XS = look(fontSize.xs, 400);
  return (
    <col id="cloud-browser-takeover" role="region" label={detail ? t("cloudBrowser.takeover.frameTitle", { origin: detail.displayOrigin }) : t("common.signIn")} grow={1} minW={0} minH={0} clip={0}>
      {detail ? (
        <row id="cloud-browser-takeover-controls" shrink={false} align="center" justify="between" gap={12} minH={48} py={7} px={10} fill={tk.c.background} border={tk.c.borderWeak} borderSides={[0, 0, 1, 0]}>
          <row align="center" gap={6} grow={1} minW={0} shrink>
            <Icon icon={Icons.stella.Lock} size={12} color={tk.c.textWeak} />
            <text {...look(fontSize.xs, 500)} color={tk.c.textStrong} shrink minW={0} nowrap truncate>
              {detail.displayOrigin}
            </text>
            {narrow ? null : (
              <text {...XS} color={tk.c.textWeak} grow={1} w={0} minW={0} nowrap truncate>
                {`· ${t("cloudBrowser.takeover.privateNotice")}`}
              </text>
            )}
          </row>
          <row align="center" gap={7} shrink={false}>
            <Button id="cloud-browser-takeover-cancel" type="button" variant="ghost" className="pill-btn" disabled={Boolean(busyDecision)} onClick={() => void decideInteraction("cancel")}>
              {busyDecision === "cancel" ? t("cloudBrowser.actions.canceling") : t("common.cancel")}
            </Button>
            <Button id="cloud-browser-takeover-done" type="button" variant="primary" className="pill-btn pill-btn--primary" disabled={Boolean(busyDecision)} onClick={() => void decideInteraction("done")}>
              {busyDecision === "done" ? t("cloudBrowser.actions.finishing") : t("cloudBrowser.actions.done")}
            </Button>
          </row>
        </row>
      ) : null}
      <col id="cloud-browser-takeover-viewport" grow={1} minW={0} minH={0} fill="#ffffff">
        {!location || detail === null ? (
          <Status role="alert" alert>
            {t("cloudBrowser.errors.expired")}
          </Status>
        ) : detail === undefined ? (
          <Status role="status">{t("common.loading")}</Status>
        ) : detail.kind === "device_code" ? (
          <DeviceCodeSurface detail={detail} />
        ) : active && panelOpen && !busyDecision ? (
          <CloudBrowserLiveView detail={detail} />
        ) : null}
      </col>
    </col>
  );
}
