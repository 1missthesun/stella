import { useCallback, useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { AppWindowMac, Check, Eye, Globe, LoaderCircle } from "@/ui/icons";
import { openExternalUrl } from "@/platform/electron/open-external";
import { getPlatform } from "@/platform/electron/platform";
import { useT } from "@/shared/i18n";
import {
  useDesktopPermissions,
  type DesktopPermissionKind,
  type DesktopPermissionStatus,
} from "@/global/permissions/use-desktop-permissions";
import { STELLA_BROWSER_EXTENSION_STORE_URL } from "@stella/contracts/browser-extension";
import type { OnboardingChatAnswer } from "../onboarding-chat-flow";

const PERMISSION_POLL_MS = 3000;
const GMAIL_CONNECTOR_ID = "gmail";

const INITIAL_PERMISSION_STATUS: DesktopPermissionStatus = {
  accessibility: false,
  screen: false,
  microphone: false,
  microphoneStatus: "unknown",
};

const PERMISSION_ROWS: {
  kind: Exclude<DesktopPermissionKind, "microphone">;
  titleKey: string;
  descKey: string;
}[] = [
  {
    kind: "accessibility",
    titleKey: "onboarding.chat.extras.accessibilityTitle",
    descKey: "onboarding.chat.extras.accessibilityDesc",
  },
  {
    kind: "screen",
    titleKey: "onboarding.chat.extras.screenTitle",
    descKey: "onboarding.chat.extras.screenDesc",
  },
];

type GmailPhase = "idle" | "connecting" | "connected" | "error";

function GmailMark({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
    >
      <g transform="translate(0 3) scale(0.272727) translate(-52 -42)">
        <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path
          fill="#fbbc04"
          d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"
        />
        <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
        <path
          fill="#c5221f"
          d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"
        />
      </g>
    </svg>
  );
}

function useGmailConnect(enabled: boolean) {
  const [phase, setPhase] = useState<GmailPhase>("idle");

  useEffect(() => {
    if (!enabled) return;
    const api = window.electronAPI?.nativeIntegrations;
    if (!api?.list) return;
    let cancelled = false;
    void api
      .list()
      .then((list) => {
        if (cancelled) return;
        if (list.some((entry) => entry.id === GMAIL_CONNECTOR_ID && entry.enabled)) {
          setPhase((current) => (current === "idle" ? "connected" : current));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const connect = useCallback(async () => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api?.enable) {
      setPhase("error");
      return;
    }
    setPhase("connecting");
    try {
      const updated = await api.enable({ id: GMAIL_CONNECTOR_ID });
      setPhase(updated.enabled ? "connected" : "error");
    } catch (error) {
      console.warn("[onboarding-chat] Gmail connect failed", error);
      setPhase("error");
    }
  }, []);

  return { phase, connect };
}

type ExtrasCardProps = {
  active: boolean;
  answered: OnboardingChatAnswer | undefined;
  /** Gmail is offered only with a Stella account, where its connector lives. */
  canConnectGmail: boolean;
  onAnswer: (answer: OnboardingChatAnswer) => void;
};

/** The last setup step: optional Gmail, browser extension and (on macOS) permissions, then into the chat. */
export function ExtrasCard({ active, answered, canConnectGmail, onAnswer }: ExtrasCardProps) {
  const t = useT();
  const isMac = getPlatform() === "darwin";
  const open = answered === undefined;
  const permissions = useDesktopPermissions({
    enabled: isMac && open,
    pollMs: PERMISSION_POLL_MS,
    initialStatus: INITIAL_PERMISSION_STATUS,
    restartKinds: ["screen"],
  });
  const gmail = useGmailConnect(canConnectGmail && open);
  const [extensionOpened, setExtensionOpened] = useState(false);

  const handleEnable = useCallback(
    (kind: DesktopPermissionKind) => {
      void permissions.requestWithSettingsFallback(kind).catch((error) => {
        console.warn("[onboarding-chat] Permission request failed", error);
      });
    },
    [permissions],
  );

  if (!open) {
    return (
      <div className="obc-card" data-settled>
        <span className="obc-card__settled-icon">
          <Check size={15} />
        </span>
        <span className="obc-card__settled-text">
          <span className="obc-card__settled-title">
            {t("onboarding.chat.extras.settledTitle")}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="obc-card" data-testid="onboarding-extras">
      <div className="obc-card__section">
        <h3 className="obc-card__title">{t("onboarding.chat.extras.heading")}</h3>
        <p className="obc-card__body">{t("onboarding.chat.extras.lead")}</p>
      </div>

      <div className="obc-rows">
        {canConnectGmail ? (
          <div className="obc-row-item">
            <span className="obc-row-item__icon">
              <GmailMark size={20} />
            </span>
            <span className="obc-row-item__text">
              <span className="obc-row-item__title">{t("onboarding.chat.gmail.title")}</span>
              <span className="obc-row-item__desc">{t("onboarding.chat.gmail.body")}</span>
            </span>
            {gmail.phase === "connected" ? (
              <span className="obc-row-item__done">
                <Check size={14} />
                {t("onboarding.chat.gmail.connected")}
              </span>
            ) : (
              <Button
                type="button"
                size="small"
                disabled={!active || gmail.phase === "connecting"}
                onClick={() => void gmail.connect()}
              >
                {gmail.phase === "connecting" ? (
                  <>
                    <LoaderCircle
                      className="stella-loader-circle"
                      size={14}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                    {t("onboarding.chat.gmail.connecting")}
                  </>
                ) : (
                  t("onboarding.chat.gmail.connect")
                )}
              </Button>
            )}
          </div>
        ) : null}

        <div className="obc-row-item">
          <span className="obc-row-item__icon">
            <img
              src="stella-extension-icon-128.png"
              alt=""
              width={26}
              height={26}
              draggable={false}
            />
          </span>
          <span className="obc-row-item__text">
            <span className="obc-row-item__title">
              {t("onboarding.chat.extras.extensionTitle")}
            </span>
            <span className="obc-row-item__desc">
              {t("onboarding.chat.extras.extensionDesc")}
            </span>
          </span>
          {extensionOpened ? (
            <span className="obc-row-item__done">
              <Globe size={14} />
              {t("onboarding.chat.extras.extensionOpened")}
            </span>
          ) : (
            <Button
              type="button"
              size="small"
              disabled={!active}
              onClick={() => {
                openExternalUrl(STELLA_BROWSER_EXTENSION_STORE_URL);
                setExtensionOpened(true);
              }}
            >
              {t("onboarding.chat.extras.getExtension")}
            </Button>
          )}
        </div>

        {isMac
          ? PERMISSION_ROWS.map((row) => {
              const granted = permissions.status[row.kind];
              const busy = permissions.activeAction === row.kind;
              return (
                <div className="obc-row-item" key={row.kind}>
                  <span className="obc-row-item__icon">
                    {row.kind === "screen" ? <AppWindowMac size={16} /> : <Eye size={16} />}
                  </span>
                  <span className="obc-row-item__text">
                    <span className="obc-row-item__title">{t(row.titleKey)}</span>
                    <span className="obc-row-item__desc">{t(row.descKey)}</span>
                  </span>
                  {granted ? (
                    <span className="obc-row-item__done">
                      <Check size={14} />
                      {t("onboarding.chat.extras.enabled")}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="small"
                      disabled={!active || busy}
                      onClick={() => handleEnable(row.kind)}
                    >
                      {busy ? t("common.loading") : t("onboarding.chat.extras.enable")}
                    </Button>
                  )}
                </div>
              );
            })
          : null}
      </div>

      {gmail.phase === "error" ? (
        <p className="obc-card__fine obc-card__fine--error" role="alert">
          {t("onboarding.chat.gmail.error")}
        </p>
      ) : null}

      {isMac && permissions.restartRecommended ? (
        <div className="obc-actions">
          <span className="obc-actions__hint">{t("onboarding.chat.extras.restartHint")}</span>
          <span className="obc-actions__spacer" />
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={permissions.isRestarting}
            onClick={() => void permissions.restart()}
          >
            {t("onboarding.chat.extras.restart")}
          </Button>
        </div>
      ) : null}

      <div className="obc-actions">
        <Button
          type="button"
          variant="primary"
          disabled={!active}
          data-testid="onboarding-start-chatting"
          onClick={() => onAnswer("done")}
        >
          {t("onboarding.chat.extras.start")}
        </Button>
        <span className="obc-actions__spacer" />
        <span className="obc-actions__hint">{t("onboarding.chat.extras.hint")}</span>
      </div>
    </div>
  );
}
