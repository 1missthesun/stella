import { useEffect, useState } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { formatJoinCode } from "@stella/contracts/saved-values-trust";
import { useExecutionDeviceList } from "@/features/cloud/use-execution-device-list";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import { backendUrl } from "@/platform/backend/backend-client";
import { getDeviceIdOrNull } from "@/platform/electron/device";
import { getElectronApi } from "@/platform/electron/electron";
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
import { useSavedValuesSync } from "./use-saved-values-sync";
import "@/global/execution/remote-execution-consent.css";
import "./saved-values-device.css";

const FREE_POLL_MS = 1_000;

const useScreenFree = (wanted: boolean): boolean => {
  const [free, setFree] = useState(false);
  useEffect(() => {
    if (!wanted) {
      setFree(false);
      return;
    }
    const check = () => {
      const other = [...document.querySelectorAll('[data-slot="dialog-content"]')].some(
        (node) => !node.classList.contains("saved-values-device"),
      );
      setFree(!other);
    };
    check();
    const timer = window.setInterval(check, FREE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [wanted]);
  return free;
};

export const SavedValuesDeviceLayer = () => {
  const t = useT();
  const { hasConnectedAccount } = useAuthSessionState();
  const onboarding = useOnboardingState();
  const { status, act } = useSavedValuesSync();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceDestination[] | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getDeviceIdOrNull().then(setDeviceId, () => setDeviceId(null));
  }, []);
  useExecutionDeviceList({
    httpOrigin: hasConnectedAccount && backendUrl ? backendUrl : null,
    onDevices: (next) => setDevices(next),
  });

  const request = status?.standing === "member" ? status.requests.find((entry) => !dismissed.has(entry.joinId)) : undefined;
  // This device asking to join. It asks only when something here first needs
  // a saved value (or the user asks from Saved logins), and the card shows
  // from that moment, so both screens follow the same request. Skipping keeps
  // it off the list until it asks again from Saved logins.
  const waiting = status?.standing === "waiting" ? status.waiting : undefined;
  const asking =
    !!waiting &&
    !waiting.declined &&
    !waiting.removed &&
    !waiting.skipped &&
    !waiting.confirmed &&
    !waiting.askFailed &&
    (Boolean(waiting.code) || Boolean(waiting.askedAt));
  const ready = onboarding.hydrated && onboarding.completed;
  const showRequest = ready && Boolean(request);
  const showAsking = hasConnectedAccount && asking;
  const free = useScreenFree(showRequest || showAsking);

  const dismiss = (key: string) => {
    setDismissed((current) => new Set([...current, key]));
    setFailed(false);
  };

  const run = async (work: () => Promise<{ ok: boolean }>, after?: () => void) => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await work();
      if (!result.ok) setFailed(true);
      else after?.();
    } finally {
      setBusy(false);
    }
  };

  if (!free) return null;

  if (showRequest && request) {
    const allow = async () => {
      const result = await act({ action: "allow", joinId: request.joinId });
      const self = devices?.find((device) => device.deviceId === deviceId);
      if (result.ok && self?.remoteExecution === "unconfigured") {
        await getElectronApi()?.remoteExecution?.answer?.(true).catch(() => undefined);
      }
      return result;
    };
    const decline = () =>
      void run(() => act({ action: "decline", joinId: request.joinId }), () => dismiss(request.joinId));
    return (
      <Dialog open onOpenChange={(next) => !next && !busy && decline()}>
        <DialogContent fit className="remote-execution-consent saved-values-device" data-saved-values-allow="">
          <DialogHeader>
            <DialogTitle>
              {request.code
                ? t("global.savedValuesDevices.matchTitle", { name: request.name })
                : t("global.savedValuesDevices.allowTitle", { name: request.name })}
            </DialogTitle>
            <DialogCloseButton aria-label={t("common.close")} />
          </DialogHeader>
          <DialogBody className="remote-execution-consent-body">
            {request.code ? (
              <div className="saved-values-device-code" data-saved-values-code="">
                {formatJoinCode(request.code)}
              </div>
            ) : request.answered ? (
              <DialogDescription className="remote-execution-consent-text">
                {t("settings.secureValues.waitingFor", { name: request.name })}
              </DialogDescription>
            ) : (
              <DialogDescription className="remote-execution-consent-text">
                {t("global.savedValuesDevices.allowBody", { name: request.name })}
              </DialogDescription>
            )}
            {failed ? <div className="remote-execution-consent-error">{t("global.savedValuesDevices.failed")}</div> : null}
            <div className="remote-execution-consent-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                className="pill-btn pill-btn--lg"
                onClick={decline}
              >
                {t("global.savedValuesDevices.notNow")}
              </Button>
              {request.code ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy}
                  className="pill-btn pill-btn--primary pill-btn--lg"
                  onClick={() => void run(allow, () => dismiss(request.joinId))}
                >
                  {t("global.savedValuesDevices.matches")}
                </Button>
              ) : request.answered ? null : (
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy}
                  className="pill-btn pill-btn--primary pill-btn--lg"
                  onClick={() => void run(() => act({ action: "answer", joinId: request.joinId }))}
                >
                  {t("global.savedValuesDevices.allow")}
                </Button>
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  if (!showAsking || !waiting) return null;

  const skip = () => void run(() => act({ action: "skip" }));
  const names = waiting.approvers?.join(" / ") || t("global.savedValuesDevices.otherDevice");
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && skip()}>
      <DialogContent
        fit
        className="remote-execution-consent saved-values-device"
        data-saved-values-match={waiting.code ? "" : undefined}
        data-saved-values-asking=""
      >
        <DialogHeader>
          <DialogTitle>{t("global.savedValuesDevices.unlockTitle")}</DialogTitle>
          <DialogCloseButton aria-label={t("common.close")} />
        </DialogHeader>
        <DialogBody className="remote-execution-consent-body">
          <DialogDescription className="remote-execution-consent-text">
            {waiting.code
              ? t("global.savedValuesDevices.matchTitle", {
                  name: waiting.approver || t("global.savedValuesDevices.otherDevice"),
                })
              : waiting.forService
                ? t("global.savedValuesDevices.unlockBodyFor", { service: waiting.forService, names })
                : t("global.savedValuesDevices.unlockBody", { names })}
          </DialogDescription>
          {waiting.code ? (
            <div className="saved-values-device-code" data-saved-values-code="">
              {formatJoinCode(waiting.code)}
            </div>
          ) : null}
          {failed ? <div className="remote-execution-consent-error">{t("global.savedValuesDevices.failed")}</div> : null}
          <div className="remote-execution-consent-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="pill-btn pill-btn--lg"
              data-saved-values-skip=""
              onClick={skip}
            >
              {t("global.savedValuesDevices.notNow")}
            </Button>
            {waiting.code ? (
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                className="pill-btn pill-btn--primary pill-btn--lg"
                onClick={() => void run(() => act({ action: "confirm" }))}
              >
                {t("global.savedValuesDevices.matches")}
              </Button>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
