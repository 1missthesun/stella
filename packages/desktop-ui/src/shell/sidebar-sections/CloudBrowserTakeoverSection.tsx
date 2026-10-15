import { useCallback, useEffect, useState } from "react";
import {
  cloudBrowserLiveViewViewport,
  type CloudBrowserDeviceCodeDetail,
  type CloudBrowserInteractionDetail,
  type CloudBrowserLiveViewCapability,
  type CloudBrowserLiveViewViewport,
} from "@stella/contracts/cloud-browser";
import { AlertCircle, Check, Copy, ExternalLink, Lock } from "@/ui/icons";
import { Button } from "@/ui/button";
import { showToast } from "@/ui/toast";
import { useDisplayPanelOpen } from "@/features/workspace-display/tab-store";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useT } from "@/shared/i18n";
import {
  useCloudBrowserActions,
  useCloudBrowserInteraction,
} from "@/features/cloud/use-cloud-browser-interactions";
import { parseCloudBrowserLiveViewUrl } from "@/features/cloud/cloud-browser-live-view";
import "./cloud-browser-takeover.css";

const closeTakeoverTab = (interactionId: string) => {
  const tab = sidebarSections
    .getSnapshot()
    .tabs.find(
      (candidate) =>
        candidate.kind === "takeover" && candidate.location === interactionId,
    );
  if (tab) sidebarSections.closeTab(tab.id);
};

const publicVerificationUrl = (detail: CloudBrowserDeviceCodeDetail) => {
  try {
    const url = new URL(
      detail.verificationUriComplete ?? detail.verificationUri,
    );
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const LIVE_VIEW_RESIZE_SETTLE_MS = 400;

const useSettledViewport = (
  element: HTMLElement | null,
): CloudBrowserLiveViewViewport | null => {
  const [viewport, setViewport] = useState<CloudBrowserLiveViewViewport | null>(
    null,
  );
  useEffect(() => {
    if (!element) return;
    let timer: number | undefined;
    const measure = (immediate: boolean) => {
      const next = cloudBrowserLiveViewViewport(
        element.clientWidth,
        element.clientHeight,
      );
      if (!next) return;
      window.clearTimeout(timer);
      const apply = () =>
        setViewport((current) =>
          current &&
          current.width === next.width &&
          current.height === next.height
            ? current
            : next,
        );
      if (immediate) apply();
      else timer = window.setTimeout(apply, LIVE_VIEW_RESIZE_SETTLE_MS);
    };
    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [element]);
  return viewport;
};

function CloudBrowserLiveView({
  detail,
}: {
  detail: Extract<CloudBrowserInteractionDetail, { kind: "login_takeover" }>;
}) {
  const t = useT();
  const { mintLiveView } = useCloudBrowserActions();
  const [frameHost, setFrameHost] = useState<HTMLDivElement | null>(null);
  const viewport = useSettledViewport(frameHost);
  const [capability, setCapability] =
    useState<CloudBrowserLiveViewCapability | null>(null);
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    if (!viewport) return;
    let disposed = false;
    setIssue(null);
    void mintLiveView({
      interactionId: detail.interactionId,
      expectedRevision: detail.revision,
      viewport,
    })
      .then((next) => {
        if (disposed) return;
        const url = parseCloudBrowserLiveViewUrl(next.url);
        if (
          !url ||
          next.interactionId !== detail.interactionId ||
          next.revision !== detail.revision ||
          next.expiresAt <= Date.now()
        ) {
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
    <div ref={setFrameHost} className="cloud-browser-takeover__frame-host">
      {issue ? (
        <div className="cloud-browser-takeover__status" role="alert">
          <AlertCircle size={22} />
          <strong>{issue}</strong>
        </div>
      ) : !capability ? (
        <div className="cloud-browser-takeover__status" role="status">
          <span className="stella-loader-circle" aria-hidden="true" />
          <strong>{t("cloudBrowser.takeover.preparing")}</strong>
        </div>
      ) : (
        <iframe
          key={capability.url}
          className="cloud-browser-takeover__frame"
          src={capability.url}
          title={t("cloudBrowser.takeover.frameTitle", {
            origin: detail.displayOrigin,
          })}
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-same-origin allow-scripts"
        />
      )}
    </div>
  );
}

function DeviceCodeSurface({
  detail,
}: {
  detail: CloudBrowserDeviceCodeDetail;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const openVerification = () => {
    const url = publicVerificationUrl(detail);
    if (!url) {
      showToast({
        title: t("cloudBrowser.errors.verificationUrl"),
        variant: "error",
      });
      return;
    }
    openExternalUrl(url);
  };
  return (
    <div className="cloud-browser-takeover__device">
      <Lock size={26} aria-hidden="true" />
      <h2>
        {t("cloudBrowser.deviceCode.title", { origin: detail.displayOrigin })}
      </h2>
      <p>{t("cloudBrowser.deviceCode.body")}</p>
      <code>{detail.userCode}</code>
      <div className="cloud-browser-takeover__device-actions">
        <Button
          type="button"
          variant="ghost"
          className="pill-btn"
          onClick={() =>
            void copyTextToClipboard(detail.userCode).then(setCopied)
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied
            ? t("cloudBrowser.deviceCode.copied")
            : t("cloudBrowser.deviceCode.copy")}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="pill-btn pill-btn--primary"
          onClick={openVerification}
        >
          <ExternalLink size={14} />
          {t("cloudBrowser.deviceCode.open")}
        </Button>
      </div>
    </div>
  );
}

export function CloudBrowserTakeoverSection({
  location,
  active,
}: {
  location: string | null;
  active: boolean;
}) {
  const t = useT();
  const panelOpen = useDisplayPanelOpen();
  const detail = useCloudBrowserInteraction(location);
  const { decide } = useCloudBrowserActions();
  const [busyDecision, setBusyDecision] = useState<"done" | "cancel" | null>(
    null,
  );

  const decideInteraction = useCallback(
    async (decision: "done" | "cancel") => {
      if (!detail || busyDecision) return;
      setBusyDecision(decision);
      try {
        await decide({
          interactionId: detail.interactionId,
          expectedRevision: detail.revision,
          decision,
        });
        closeTakeoverTab(detail.interactionId);
      } catch {
        showToast({
          title: t("cloudBrowser.errors.decision"),
          variant: "error",
        });
      } finally {
        setBusyDecision(null);
      }
    },
    [busyDecision, decide, detail, t],
  );

  return (
    <section
      className="cloud-browser-takeover"
      aria-label={
        detail
          ? t("cloudBrowser.takeover.frameTitle", {
              origin: detail.displayOrigin,
            })
          : t("common.signIn")
      }
    >
      {detail ? (
        <div className="cloud-browser-takeover__controls">
          <span className="cloud-browser-takeover__origin">
            <Lock size={12} aria-hidden="true" />
            <strong>{detail.displayOrigin}</strong>
            <span>{t("cloudBrowser.takeover.privateNotice")}</span>
          </span>
          <div>
            <Button
              type="button"
              variant="ghost"
              className="pill-btn"
              disabled={Boolean(busyDecision)}
              onClick={() => void decideInteraction("cancel")}
            >
              {busyDecision === "cancel"
                ? t("cloudBrowser.actions.canceling")
                : t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="pill-btn pill-btn--primary"
              disabled={Boolean(busyDecision)}
              onClick={() => void decideInteraction("done")}
            >
              {busyDecision === "done"
                ? t("cloudBrowser.actions.finishing")
                : t("cloudBrowser.actions.done")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="cloud-browser-takeover__viewport">
        {!location || detail === null ? (
          <div className="cloud-browser-takeover__status" role="alert">
            <AlertCircle size={22} />
            <strong>{t("cloudBrowser.errors.expired")}</strong>
          </div>
        ) : detail === undefined ? (
          <div className="cloud-browser-takeover__status" role="status">
            <span className="stella-loader-circle" aria-hidden="true" />
            <strong>{t("common.loading")}</strong>
          </div>
        ) : detail.kind === "device_code" ? (
          <DeviceCodeSurface detail={detail} />
        ) : active && panelOpen && !busyDecision ? (
          <CloudBrowserLiveView detail={detail} />
        ) : null}
      </div>
    </section>
  );
}
