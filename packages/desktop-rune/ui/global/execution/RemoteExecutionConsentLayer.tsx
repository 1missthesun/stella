import { Button, Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogTitle, T } from "../../kit/compat";
import { useRemoteExecutionConsent } from "./remote-execution-consent.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useEffect, useState } from "react";
import { getElectronApi } from "@/platform/electron/electron";
import { useT } from "@/shared/i18n";

type PendingRemoteExecutionRequest = {
  requestedAt: number;
  requesterLabel?: string;
};

export const RemoteExecutionConsentLayer = () => {
  const s = useRemoteExecutionConsent();
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
    <Dialog open onOpenChange={(next) => {
        if (!next && !answering) setPending(null);
      }}>
      <DialogContent fit {...s.remoteExecutionConsent}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogCloseButton aria-label={t("common.close")} />
        </DialogHeader>
        <DialogBody {...s.remoteExecutionConsentBody}>
          <DialogDescription {...s.remoteExecutionConsentText} {...s.remoteExecutionConsentBody_remoteExecutionConsentText}>
            {body}
          </DialogDescription>
          <T w="full" {...s.remoteExecutionConsentNote}>
            {t("global.remoteExecutionConsent.note")}
          </T>
          {failed ? (
            <T w="full" {...s.remoteExecutionConsentError}>
              {t("global.remoteExecutionConsent.failed")}
            </T>
          ) : null}
          <row {...s.remoteExecutionConsentActions}>
            <Button variant="ghost" disabled={answering} className="pill-btn pill-btn--lg" data-consent-action="decline" onClick={() => void answer(false)}>
              {t("global.remoteExecutionConsent.decline")}
            </Button>
            <Button variant="primary" disabled={answering} className="pill-btn pill-btn--primary pill-btn--lg" data-consent-action="allow" onClick={() => void answer(true)}>
              {t("global.remoteExecutionConsent.allow")}
            </Button>
          </row>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
