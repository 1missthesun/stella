import { useCallback, useEffect, useState } from "react";
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
import "./remote-execution-consent.css";

type PendingRemoteExecutionRequest = {
  requestedAt: number;
  requesterLabel?: string;
};

export const RemoteExecutionConsentLayer = () => {
  const t = useT();
  const [pending, setPending] = useState<PendingRemoteExecutionRequest | null>(
    null,
  );
  const [answering, setAnswering] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const remoteExecution = getElectronApi()?.remoteExecution;
    if (!remoteExecution?.onRequest) return;
    let received = false;
    const unsubscribe = remoteExecution.onRequest((request) => {
      received = true;
      setFailed(false);
      setAnswering(false);
      setPending(request);
    });
    void remoteExecution
      .pending?.()
      .then((request) => {
        if (request && !received) setPending(request);
      })
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  const answer = useCallback(async (allow: boolean) => {
    const remoteExecution = getElectronApi()?.remoteExecution;
    if (!remoteExecution?.answer) return;
    setAnswering(true);
    setFailed(false);
    try {
      await remoteExecution.answer(allow);
      setPending(null);
    } catch {
      setFailed(true);
    } finally {
      setAnswering(false);
    }
  }, []);

  if (!pending) return null;

  const title = t("global.remoteExecutionConsent.title");
  const body = pending.requesterLabel
    ? t("global.remoteExecutionConsent.bodyFrom", {
        requester: pending.requesterLabel,
      })
    : t("global.remoteExecutionConsent.body");

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !answering) setPending(null);
      }}
    >
      <DialogContent fit className="remote-execution-consent">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogCloseButton aria-label={t("common.close")} />
        </DialogHeader>
        <DialogBody className="remote-execution-consent-body">
          <DialogDescription className="remote-execution-consent-text">
            {body}
          </DialogDescription>
          <p className="remote-execution-consent-note">
            {t("global.remoteExecutionConsent.note")}
          </p>
          {failed ? (
            <div className="remote-execution-consent-error">
              {t("global.remoteExecutionConsent.failed")}
            </div>
          ) : null}
          <div className="remote-execution-consent-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={answering}
              className="pill-btn pill-btn--lg"
              data-consent-action="decline"
              onClick={() => void answer(false)}
            >
              {t("global.remoteExecutionConsent.decline")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={answering}
              className="pill-btn pill-btn--primary pill-btn--lg"
              data-consent-action="allow"
              onClick={() => void answer(true)}
            >
              {t("global.remoteExecutionConsent.allow")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
