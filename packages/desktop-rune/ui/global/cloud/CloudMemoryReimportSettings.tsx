import { SettingsCard, SettingsCardDesc, SettingsRow } from "../../settings/parts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, T } from "../../kit/compat";
import { useSettings } from "../../settings/settings.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useLayoutEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import { useCloudMemoryReimport } from "@/features/cloud/use-cloud-memory-reimport";
import { useMemorySyncStatus } from "@/features/cloud/use-memory-sync-status";

const issueCopy = (code: string | null): string => {
  if (code === "stale_epoch" || code === "owner_generation_changed") {
    return "Your account or Memory epoch changed. Reload the authoritative status before trying again.";
  }
  if (code === "active") {
    return "A cloud Memory wipe is active. Memory can't be uploaded until it finishes.";
  }
  if (code === "not_required") {
    return "This Memory epoch no longer requires upload authorization. Reload its authoritative status.";
  }
  if (code === "unauthorized") {
    return "The signed-in cloud session changed. Reconnect before uploading Memory.";
  }
  if (code === "account_unavailable") {
    return "Cloud data for this account is temporarily unavailable.";
  }
  if (code === "idempotency_conflict" || code === "invalid_response") {
    return "Stella could not verify this authorization safely. Reload status before starting a new attempt.";
  }
  return "Stella could not verify the cloud Memory upload authorization.";
};


export function CloudMemoryReimportSettings() {
  const s = useSettings();
  const t = useT();
  const {
    identity,
    phase,
    status,
    issueCode,
    eligible,
    disabled,
    authorizeReimport,
    retry,
  } = useCloudMemoryReimport();
  const memorySync = useMemorySyncStatus();
  const heldHere =
    memorySync?.phase === "held" && memorySync.heldReason === "wiped";
  const [confirmation, setConfirmation] = useState<"upload" | "erase" | null>(
    null,
  );
  const [eraseState, setEraseState] = useState<
    { kind: "idle" } | { kind: "erasing" } | { kind: "failed"; error: string }
  >({ kind: "idle" });

  useLayoutEffect(() => {
    setConfirmation(null);
  }, [
    identity?.accountScope,
    identity?.identityRevision,
    identity?.ownerSubject,
    status?.ownerGeneration,
    status?.memoryEpoch,
    status?.importDisposition,
  ]);

  const confirmImport = useCallback(() => {
    if (disabled) return;
    setConfirmation(null);
    void authorizeReimport();
  }, [authorizeReimport, disabled]);

  const confirmErase = useCallback(() => {
    setConfirmation(null);
    const api = window.electronAPI?.memorySync;
    if (!api) return;
    setEraseState({ kind: "erasing" });
    void api
      .eraseLocal()
      .then((result) =>
        setEraseState(
          result.ok ? { kind: "idle" } : { kind: "failed", error: result.error },
        ),
      )
      .catch((error: unknown) =>
        setEraseState({
          kind: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  }, []);

  if (!identity || !eligible || !status) return null;

  return (
    <>
      <SettingsCard>
        <T role="heading" {...s.settingsCardTitle}>Memory from before the erase</T>
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              Upload Memory kept on computers
            </T>
            {phase === "error" ? (
              <SettingsCardDesc error role="alert">
                {issueCopy(issueCode)}
              </SettingsCardDesc>
            ) : null}
          </col>
          <row {...s.settingsRowControl}>
            {phase === "error" ? (
              <Button variant="ghost" className="pill-btn" data-action="retry-cloud-memory-reimport" onClick={() => void retry()}>
                {t("common.tryAgain")}
              </Button>
            ) : (
              <Button variant="ghost" className="pill-btn" data-action="open-cloud-memory-reimport" onClick={() => setConfirmation("upload")} disabled={disabled}>
                {phase === "authorizing" ? "Allowing…" : "Allow upload"}
              </Button>
            )}
          </row>
        </SettingsRow>
        {heldHere ? (
          <SettingsRow>
            <col {...s.settingsRowInfo}>
              <T w="full" {...s.settingsRowLabel}>This computer</T>
              <T w="full" {...s.settingsRowSublabel} role="status">
                Sync paused. Erase to start from the cloud's Memory.
              </T>
              {eraseState.kind === "failed" ? (
                <SettingsCardDesc error role="alert">
                  {eraseState.error}
                </SettingsCardDesc>
              ) : null}
            </col>
            <row {...s.settingsRowControl}>
              <Button variant="ghost" className="pill-btn pill-btn--danger" data-action="open-erase-local-memory" onClick={() => setConfirmation("erase")} disabled={eraseState.kind === "erasing"}>
                {eraseState.kind === "erasing"
                  ? "Erasing…"
                  : "Erase on this computer"}
              </Button>
            </row>
          </SettingsRow>
        ) : null}
      </SettingsCard>

      <Dialog open={confirmation === "upload"} onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}>
        <DialogContent data-cloud-memory-reimport-confirmation>
          <DialogHeader>
            <DialogTitle>Allow Memory upload for this account?</DialogTitle>
            <DialogDescription>
              Every computer signed in to this account that kept Memory from
              before the erase merges it into the cloud's new Memory. This
              computer starts right away. What was erased from the cloud stays
              erased. Skills are unaffected.
            </DialogDescription>
          </DialogHeader>
          <row justify="end" gap={8} mt={20}>
            <Button variant="ghost" className="pill-btn" onClick={() => setConfirmation(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="ghost" className="pill-btn" data-action="confirm-cloud-memory-reimport" onClick={confirmImport} disabled={disabled}>
              Allow upload
            </Button>
          </row>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmation === "erase"} onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}>
        <DialogContent data-erase-local-memory-confirmation>
          <DialogHeader>
            <DialogTitle>Erase this computer's Memory?</DialogTitle>
            <DialogDescription>
              Deletes PERSONALITY.md and the Markdown files
              under memories/ in this computer's Stella folder, then syncs with
              the cloud's Memory. Other computers keep theirs. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <row justify="end" gap={8} mt={20}>
            <Button variant="ghost" className="pill-btn" onClick={() => setConfirmation(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="ghost" className="pill-btn pill-btn--danger" data-action="confirm-erase-local-memory" onClick={confirmErase}>
              Erase
            </Button>
          </row>
        </DialogContent>
      </Dialog>
    </>
  );
}
