import { Button, Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogTitle, T } from "../../kit/compat";
import { useRemoteExecutionConsent } from "./remote-execution-consent.styles";
import { usePill } from "../shared/pill.styles";
import { steadyNow } from "@stella/contracts/server-clock";
import { useCallback, useEffect, useState } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { useExecutionDeviceList } from "@/features/cloud/use-execution-device-list";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import { backendUrl } from "@/platform/backend/backend-client";
import { getDeviceIdOrNull } from "@/platform/electron/device";
import { getElectronApi } from "@/platform/electron/electron";
import { uiState } from "@/platform/ui-state";
import { useT } from "@/shared/i18n";

const ASKED_KEY = "stella:device-work-offer-asked";
const CALM_IDLE_MS = 3_000;
const CALM_POLL_MS = 1_000;

const askedHere = (deviceId: string): boolean => {
  try {
    const asked = JSON.parse(uiState.getItem(ASKED_KEY) ?? "[]") as unknown;
    return Array.isArray(asked) && asked.includes(deviceId);
  } catch {
    return false;
  }
};

const markAsked = (deviceId: string): void => {
  let asked: unknown = [];
  try {
    asked = JSON.parse(uiState.getItem(ASKED_KEY) ?? "[]");
  } catch {
    asked = [];
  }
  const list = Array.isArray(asked) ? asked.filter((id) => typeof id === "string") : [];
  if (!list.includes(deviceId)) uiState.setItem(ASKED_KEY, JSON.stringify([...list, deviceId]));
};

export const DeviceWorkOfferLayer = () => {
  const s = useRemoteExecutionConsent();
  const t = useT();
  const { hasConnectedAccount } = useAuthSessionState();
  const onboarding = useOnboardingState();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceDestination[] | null>(null);
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getDeviceIdOrNull().then(
      (id) => {
        setDeviceId(id);
        if (id) setAsked(askedHere(id));
      },
      () => setDeviceId(null),
    );
  }, []);

  useExecutionDeviceList({
    httpOrigin: hasConnectedAccount && backendUrl ? backendUrl : null,
    onDevices: (next) => setDevices(next),
  });

  const self = devices?.find((device) => device.deviceId === deviceId);
  const eligible = Boolean(
    deviceId &&
      !asked &&
      onboarding.hydrated &&
      onboarding.completed &&
      self?.remoteExecution === "unconfigured" &&
      devices?.some((device) => device.deviceId !== deviceId),
  );

  useEffect(() => {
    if (!eligible || open) return;
    let lastInputAt = steadyNow();
    const input = () => {
      lastInputAt = steadyNow();
    };
    window.addEventListener("keydown", input, true);
    window.addEventListener("pointerdown", input, true);
    const timer = window.setInterval(() => {
      const calm =
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        !document.querySelector('[data-slot="dialog-content"]') &&
        steadyNow() - lastInputAt >= CALM_IDLE_MS;
      if (calm) setOpen(true);
    }, CALM_POLL_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", input, true);
      window.removeEventListener("pointerdown", input, true);
    };
  }, [eligible, open]);

  const finish = useCallback(() => {
    if (deviceId) markAsked(deviceId);
    setAsked(true);
    setOpen(false);
  }, [deviceId]);

  const allow = useCallback(async () => {
    const remoteExecution = getElectronApi()?.remoteExecution;
    if (!remoteExecution?.answer) return;
    setAnswering(true);
    setFailed(false);
    try {
      await remoteExecution.answer(true);
      finish();
    } catch {
      setFailed(true);
    } finally {
      setAnswering(false);
    }
  }, [finish]);

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => {
        if (!next && !answering) finish();
      }}>
      <DialogContent fit {...s.remoteExecutionConsent} data-device-work-offer="">
        <DialogHeader>
          <DialogTitle>{t("global.deviceWorkOffer.title")}</DialogTitle>
          <DialogCloseButton aria-label={t("common.close")} />
        </DialogHeader>
        <DialogBody {...s.remoteExecutionConsentBody}>
          <DialogDescription {...s.remoteExecutionConsentText} {...s.remoteExecutionConsentBody_remoteExecutionConsentText}>
            {t("global.deviceWorkOffer.body")}
          </DialogDescription>
          <T w="full" {...s.remoteExecutionConsentNote}>{t("global.deviceWorkOffer.note")}</T>
          {failed ? (
            <T w="full" {...s.remoteExecutionConsentError}>{t("global.deviceWorkOffer.failed")}</T>
          ) : null}
          <row {...s.remoteExecutionConsentActions}>
            <Button variant="ghost" disabled={answering} className="pill-btn pill-btn--lg" data-offer-action="later" onClick={finish}>
              {t("global.deviceWorkOffer.later")}
            </Button>
            <Button variant="primary" disabled={answering} className="pill-btn pill-btn--primary pill-btn--lg" data-offer-action="allow" onClick={() => void allow()}>
              {t("global.deviceWorkOffer.allow")}
            </Button>
          </row>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
