import { SettingsCard, SettingsCardDesc, SettingsRow } from "../../settings/parts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, T, TextField } from "../../kit/compat";
import { useSettings } from "../../settings/settings.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useT } from "@/shared/i18n";
import type { MemoryWipeJob } from "@stella/contracts/backend/home";
import { useCloudMemoryWipe } from "@/features/cloud/use-cloud-memory-wipe";

const stageCopy = (job: MemoryWipeJob): string => {
  if (job.stage === "sweeping") {
    return "Permanently deleting encrypted Memory objects from cloud storage.";
  }
  if (job.stage === "metadata") {
    return "Removing Memory document metadata and indexes.";
  }
  if (job.stage === "releasing") {
    return "Releasing the previous Memory storage generation.";
  }
  return "The previous Memory epoch was permanently erased.";
};

const issueCopy = (code: string | null): string => {
  if (code === "stale_epoch" || code === "owner_generation_changed") {
    return "Your account or Memory epoch changed. Reload the authoritative status before trying again.";
  }
  if (code === "active") {
    return "A Memory wipe is already active. Reload its authoritative status.";
  }
  if (code === "unauthorized") {
    return "The signed-in cloud session changed. Reconnect before managing Memory.";
  }
  if (code === "account_unavailable") {
    return "Cloud data for this account is temporarily unavailable.";
  }
  if (code === "idempotency_conflict" || code === "invalid_response") {
    return "Stella could not verify this wipe safely. Reload status before starting a new attempt.";
  }
  return "Stella could not verify the cloud Memory wipe status.";
};


export function CloudMemoryWipeSettings() {
  const s = useSettings();
  const t = useT();
  const {
    identity,
    phase,
    status,
    issueCode,
    disabled,
    startWipe,
    refresh,
    retry,
  } = useCloudMemoryWipe();
  const identityKey = identity
    ? `${identity.accountScope}:${identity.identityRevision}:${identity.ownerSubject}`
    : null;
  const [confirmationStep, setConfirmationStep] = useState<0 | 1 | 2>(0);
  const [confirmationText, setConfirmationText] = useState("");

  useLayoutEffect(() => {
    setConfirmationStep(0);
    setConfirmationText("");
  }, [identityKey]);

  const closeConfirmation = useCallback(() => {
    setConfirmationStep(0);
    setConfirmationText("");
  }, []);

  const confirmWipe = useCallback(() => {
    if (confirmationText !== "ERASE" || disabled) return;
    closeConfirmation();
    void startWipe();
  }, [closeConfirmation, confirmationText, disabled, startWipe]);

  const progress = useMemo(() => {
    const job = status?.job;
    if (!job) return null;
    return `${job.objectsDeleted.toLocaleString()} cloud objects and ${job.rowsDeleted.toLocaleString()} metadata rows erased.`;
  }, [status?.job]);

  if (!identity) return null;

  const activeJob = status?.state === "wiping" ? status.job : null;
  const completedJob =
    status?.state === "open" && status.job?.stage === "completed"
      ? status.job
      : null;

  return (
    <>
      <SettingsCard>
        <T role="heading" {...s.settingsCardTitle}>Cloud Memory</T>

        {phase === "loading" ? (
          <T w="full" {...s.settingsRowSublabel} role="status">
            {t("common.loading")}
          </T>
        ) : null}

        {activeJob ? (
          <SettingsRow>
            <col {...s.settingsRowInfo}>
              <T w="full" {...s.settingsRowLabel} role="status">
                Erasing cloud Memory
              </T>
              <T w="full" {...s.settingsRowSublabel}>
                {stageCopy(activeJob)}
              </T>
              <T w="full" {...s.settingsRowSublabel}>{progress}</T>
              {activeJob.lastErrorCode ? (
                <T w="full" {...s.settingsRowSublabel} role="status">
                  The last pass didn't finish. Retrying soon.
                </T>
              ) : null}
            </col>
            <row {...s.settingsRowControl}>
              <Button variant="ghost" className="pill-btn" onClick={() => void refresh()}>
                Refresh status
              </Button>
            </row>
          </SettingsRow>
        ) : null}

        {completedJob ? (
          <SettingsRow>
            <col {...s.settingsRowInfo}>
              <T w="full" {...s.settingsRowLabel} role="status">
                Memory wipe completed
              </T>
              <T w="full" {...s.settingsRowSublabel}>{progress}</T>
            </col>
          </SettingsRow>
        ) : null}

        {phase === "error" ? (
          <SettingsRow>
            <col {...s.settingsRowInfo}>
              <SettingsCardDesc error role="alert">
                {issueCopy(issueCode)}
              </SettingsCardDesc>
            </col>
            <row {...s.settingsRowControl}>
              <Button variant="ghost" className="pill-btn" onClick={() => void retry()}>
                {t("common.tryAgain")}
              </Button>
            </row>
          </SettingsRow>
        ) : null}

        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowSublabel}>
              Can't be undone. Your computers keep their copies.
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Button variant="ghost" className="pill-btn pill-btn--danger" data-action="open-cloud-memory-wipe" onClick={() => setConfirmationStep(1)} disabled={disabled}>
              {phase === "starting" ? "Starting…" : "Erase cloud Memory"}
            </Button>
          </row>
        </SettingsRow>
      </SettingsCard>

      <Dialog open={confirmationStep === 1} onOpenChange={(open) => {
          if (!open) closeConfirmation();
        }}>
        <DialogContent data-cloud-memory-wipe-confirmation="review">
          <DialogHeader>
            <DialogTitle>Permanently erase cloud Memory?</DialogTitle>
            <DialogDescription>
              This deletes all Memory content, cloud objects, indexes, and
              document metadata for this account across cloud storage. It cannot
              be recovered. Stella retains only a non-content completion receipt
              so it can prove the wipe finished.
            </DialogDescription>
          </DialogHeader>
          <row justify="end" gap={8} mt={20}>
            <Button variant="ghost" className="pill-btn" onClick={closeConfirmation}>
              {t("common.cancel")}
            </Button>
            <Button variant="ghost" className="pill-btn pill-btn--danger" data-action="continue-cloud-memory-wipe" onClick={() => setConfirmationStep(2)}>
              {t("common.continue")}
            </Button>
          </row>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmationStep === 2} onOpenChange={(open) => {
          if (!open) closeConfirmation();
        }}>
        <DialogContent data-cloud-memory-wipe-confirmation="final">
          <DialogHeader>
            <DialogTitle>Final confirmation</DialogTitle>
            <DialogDescription>
              Type ERASE to permanently remove every prior Memory object and its
              document metadata. The new Memory epoch starts empty.
            </DialogDescription>
          </DialogHeader>
          <TextField label="Type ERASE to confirm" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} autoComplete="off" spellCheck={false} />
          <row justify="end" gap={8} mt={20}>
            <Button variant="ghost" className="pill-btn" onClick={closeConfirmation}>
              {t("common.cancel")}
            </Button>
            <Button variant="ghost" className="pill-btn pill-btn--danger" data-action="confirm-cloud-memory-wipe" onClick={confirmWipe} disabled={confirmationText !== "ERASE" || disabled}>
              Erase permanently
            </Button>
          </row>
        </DialogContent>
      </Dialog>
    </>
  );
}
