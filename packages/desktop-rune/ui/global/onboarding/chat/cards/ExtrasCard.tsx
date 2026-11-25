import { AppWindowMac, Button, Check, Eye, Globe, LoaderCircle, T } from "../../../../kit/compat";
import extensionIcon from "../../../../../../desktop-ui/public/stella-extension-icon-128.png";
import { useOnboardingChat } from "../onboarding-chat.styles";
import { usePrimitives } from "../../../shared/primitives.styles";
import { useCallback, useEffect, useState } from "react";
import { openExternalUrl } from "@/platform/electron/open-external";
import { getPlatform } from "@/platform/electron/platform";
import { useT } from "@/shared/i18n";
import {
  useDesktopPermissions,
  type DesktopPermissionKind,
  type DesktopPermissionStatus,
} from "@/global/permissions/use-desktop-permissions";
import { STELLA_BROWSER_EXTENSION_STORE_URL } from "@stella/contracts/browser-extension";
import type { OnboardingChatAnswer } from "@/global/onboarding/chat/onboarding-chat-flow";

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

const GMAIL_SVG =
  '<g transform="translate(0 3) scale(0.272727) translate(-52 -42)"><path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/><path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/><path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/></g>';

function GmailMark({ size }: { size: number }) {
  return <icon svg={GMAIL_SVG} name="obc/gmail" view={24} size={size} inert />;
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
  canConnectGmail: boolean;
  onAnswer: (answer: OnboardingChatAnswer) => void;
};

export function ExtrasCard({ active, answered, canConnectGmail, onAnswer }: ExtrasCardProps) {
  const s = useOnboardingChat();
  const sPrimitives = usePrimitives();
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
      <col {...s.obcCard} {...((true) ? s.obcCardSettled : null)}>
        <row {...s.obcCardSettledIcon}>
          <Check size={15} color={s.obcCardSettledIcon.color} />
        </row>
        <col {...s.obcCardSettledText}>
          <T {...s.obcCardSettledTitle}>
            {t("onboarding.chat.extras.settledTitle")}
          </T>
        </col>
      </col>
    );
  }

  return (
    <col {...s.obcCard}>
      <col {...s.obcCardSection}>
        <T role="heading" {...s.obcCardTitle}>{t("onboarding.chat.extras.heading")}</T>
        <T w="full" {...s.obcCardBody}>{t("onboarding.chat.extras.lead")}</T>
      </col>

      <col>
        {canConnectGmail ? (
          <row {...s.obcRowItem}>
            <row {...s.obcRowItemIcon}>
              <GmailMark size={20} />
            </row>
            <col {...s.obcRowItemText}>
              <T {...s.obcRowItemTitle}>{t("onboarding.chat.gmail.title")}</T>
              <T {...s.obcRowItemDesc}>{t("onboarding.chat.gmail.body")}</T>
            </col>
            {gmail.phase === "connected" ? (
              <row {...s.obcRowItemDone}>
                <Check size={14} color={s.obcRowItemDone.color} />
                {t("onboarding.chat.gmail.connected")}
              </row>
            ) : (
              <Button size="small" disabled={!active || gmail.phase === "connecting"} onClick={() => void gmail.connect()}>
                {gmail.phase === "connecting" ? (
                  <>
                    <LoaderCircle {...sPrimitives.stellaLoaderCircle} size={14} strokeWidth={2} color={sPrimitives.stellaLoaderCircle.color} />
                    {t("onboarding.chat.gmail.connecting")}
                  </>
                ) : (
                  t("onboarding.chat.gmail.connect")
                )}
              </Button>
            )}
          </row>
        ) : null}

        <row {...s.obcRowItem}>
          <row {...s.obcRowItemIcon}>
            <image src={extensionIcon} label="" w={26} h={26} />
          </row>
          <col {...s.obcRowItemText}>
            <T {...s.obcRowItemTitle}>
              {t("onboarding.chat.extras.extensionTitle")}
            </T>
            <T {...s.obcRowItemDesc}>
              {t("onboarding.chat.extras.extensionDesc")}
            </T>
          </col>
          {extensionOpened ? (
            <row {...s.obcRowItemDone}>
              <Globe size={14} color={s.obcRowItemDone.color} />
              {t("onboarding.chat.extras.extensionOpened")}
            </row>
          ) : (
            <Button size="small" disabled={!active} onClick={() => {
                openExternalUrl(STELLA_BROWSER_EXTENSION_STORE_URL);
                setExtensionOpened(true);
              }}>
              {t("onboarding.chat.extras.getExtension")}
            </Button>
          )}
        </row>

        {isMac
          ? PERMISSION_ROWS.map((row) => {
              const granted = permissions.status[row.kind];
              const busy = permissions.activeAction === row.kind;
              return (
                <row {...s.obcRowItem} key={row.kind}>
                  <row {...s.obcRowItemIcon}>
                    {row.kind === "screen" ? <AppWindowMac size={16} color={s.obcRowItemIcon.color} /> : <Eye size={16} color={s.obcRowItemIcon.color} />}
                  </row>
                  <col {...s.obcRowItemText}>
                    <T {...s.obcRowItemTitle}>{t(row.titleKey)}</T>
                    <T {...s.obcRowItemDesc}>{t(row.descKey)}</T>
                  </col>
                  {granted ? (
                    <row {...s.obcRowItemDone}>
                      <Check size={14} color={s.obcRowItemDone.color} />
                      {t("onboarding.chat.extras.enabled")}
                    </row>
                  ) : (
                    <Button size="small" disabled={!active || busy} onClick={() => handleEnable(row.kind)}>
                      {busy ? t("common.loading") : t("onboarding.chat.extras.enable")}
                    </Button>
                  )}
                </row>
              );
            })
          : null}
      </col>

      {gmail.phase === "error" ? (
        <T w="full" {...s.obcCardFine} {...s.obcCardFineError} role="alert">
          {t("onboarding.chat.gmail.error")}
        </T>
      ) : null}

      {isMac && permissions.restartRecommended ? (
        <row {...s.obcActions}>
          <T {...s.obcActionsHint}>{t("onboarding.chat.extras.restartHint")}</T>
          <row {...s.obcActionsSpacer} />
          <Button size="small" variant="ghost" disabled={permissions.isRestarting} onClick={() => void permissions.restart()}>
            {t("onboarding.chat.extras.restart")}
          </Button>
        </row>
      ) : null}

      <row {...s.obcActions}>
        <Button variant="primary" disabled={!active} onClick={() => onAnswer("done")}>
          {t("onboarding.chat.extras.start")}
        </Button>
        <row {...s.obcActionsSpacer} />
        <T {...s.obcActionsHint}>{t("onboarding.chat.extras.hint")}</T>
      </row>
    </col>
  );
}
