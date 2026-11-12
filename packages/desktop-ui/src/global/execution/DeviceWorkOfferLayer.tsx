import { useCallback, useEffect, useState } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { useExecutionDeviceList } from "@/features/cloud/use-execution-device-list";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import { backendUrl } from "@/platform/backend/backend-client";
import { getDeviceIdOrNull } from "@/platform/electron/device";
import { getElectronApi } from "@/platform/electron/electron";
import { uiState } from "@/platform/ui-state";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { useT } from "@/shared/i18n";
import "./remote-execution-consent.css";

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

/**
 * Asks once whether the user's other devices may start work on this computer, as soon as the
 * account has another computer: right after sign-in on a new one, or at a calm moment on the
 * first one when a second appears. "Not now" leaves it unconfigured, so starting a task here
 * still asks on this screen.
 */
export const DeviceWorkOfferLayer = () => {
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
    let lastInputAt = Date.now();
    const input = () => {
      lastInputAt = Date.now();
    };
    window.addEventListener("keydown", input, true);
    window.addEventListener("pointerdown", input, true);
    const timer = window.setInterval(() => {
      const calm =
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        !document.querySelector('[data-slot="dialog-content"]') &&
        Date.now() - lastInputAt >= CALM_IDLE_MS;
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !answering) finish();
      }}
    >
      <DialogContent fit className="remote-execution-consent" data-device-work-offer="">
        <DialogHeader>
          <DialogTitle>{t("global.deviceWorkOffer.title")}</DialogTitle>
          <DialogCloseButton aria-label={t("common.close")} />
        </DialogHeader>
        <DialogBody className="remote-execution-consent-body">
          <DialogDescription className="remote-execution-consent-text">
            {t("global.deviceWorkOffer.body")}
          </DialogDescription>
          <p className="remote-execution-consent-note">{t("global.deviceWorkOffer.note")}</p>
          {failed ? (
            <div className="remote-execution-consent-error">{t("global.deviceWorkOffer.failed")}</div>
          ) : null}
          <div className="remote-execution-consent-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={answering}
              className="pill-btn pill-btn--lg"
              data-offer-action="later"
              onClick={finish}
            >
              {t("global.deviceWorkOffer.later")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={answering}
              className="pill-btn pill-btn--primary pill-btn--lg"
              data-offer-action="allow"
              onClick={() => void allow()}
            >
              {t("global.deviceWorkOffer.allow")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
