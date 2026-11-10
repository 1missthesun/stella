import { useEffect, useState } from "react";
import { KeyRound } from "@/ui/icons";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { invalidateDictationRoute } from "@/features/dictation/services/dictation-transcriber";
import {
  invalidateOnDeviceDictation,
  onDeviceDictationStatus,
  openSystemDictationSettings,
} from "@/features/dictation/services/on-device-dictation";
import "./dictation-key-dialog.css";

export const DICTATION_KEY_NEEDED_EVENT = "stella:dictation-key-needed";
export const DICTATION_KEY_SAVED_EVENT = "stella:dictation-key-saved";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

// @reloadable the count follows what is mounted
let mountedHosts = 0;

export const requestDictationKey = (): boolean => {
  if (mountedHosts === 0) return false;
  window.dispatchEvent(new CustomEvent(DICTATION_KEY_NEEDED_EVENT));
  return true;
};

export function DictationKeyDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemDictationOff, setSystemDictationOff] = useState(false);

  useEffect(() => {
    const show = () => {
      setDraft("");
      setError(null);
      setSystemDictationOff(false);
      setOpen(true);
      void onDeviceDictationStatus().then((status) => {
        setSystemDictationOff(status?.available === false && status.reason === "dictation-off");
      });
    };
    mountedHosts += 1;
    window.addEventListener(DICTATION_KEY_NEEDED_EVENT, show);
    return () => {
      mountedHosts -= 1;
      window.removeEventListener(DICTATION_KEY_NEEDED_EVENT, show);
    };
  }, []);

  const save = async () => {
    const key = draft.trim();
    if (!key || saving) return;
    const saveCredential = window.electronAPI?.system?.saveLlmCredential;
    if (!saveCredential) {
      setError(t("features.dictation.keyDialog.unavailable"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveCredential({ provider: "openrouter", label: "OpenRouter", plaintext: key });
      invalidateDictationRoute();
      setOpen(false);
      window.dispatchEvent(new CustomEvent(DICTATION_KEY_SAVED_EVENT));
    } catch (err) {
      setError((err as Error).message || t("features.dictation.keyDialog.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open || !systemDictationOff) return;
    const recheck = () => {
      invalidateOnDeviceDictation();
      void onDeviceDictationStatus().then((status) => {
        if (!status?.available) return;
        invalidateDictationRoute();
        setOpen(false);
      });
    };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [open, systemDictationOff]);

  if (!open) return null;
  return (
    <Dialog open onOpenChange={(next) => (next ? null : setOpen(false))}>
      <DialogContent fit className="dictation-key-dialog">
        <DialogHeader>
          <DialogTitle>{t("features.dictation.keyDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("features.dictation.keyDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="dictation-key-dialog-body">
          {systemDictationOff ? (
            <p className="dictation-key-dialog-system">
              <span>{t("features.dictation.keyDialog.systemDictationOff")}</span>
              <button
                type="button"
                className="dictation-key-dialog-link"
                onClick={openSystemDictationSettings}
              >
                {t("features.dictation.keyDialog.openSystemSettings")}
              </button>
            </p>
          ) : null}
          <label className="dictation-key-dialog-field">
            <KeyRound size={13} strokeWidth={1.75} aria-hidden />
            <input
              type="password"
              placeholder="sk-or-…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
              aria-label={t("features.dictation.keyDialog.inputLabel")}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              disabled={saving}
            />
          </label>
          <button
            type="button"
            className="dictation-key-dialog-link"
            onClick={() => window.electronAPI?.system?.openExternal?.(OPENROUTER_KEYS_URL)}
          >
            {t("features.dictation.keyDialog.getKey")}
          </button>
          {error ? (
            <p className="dictation-key-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dictation-key-dialog-actions">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!draft.trim() || saving}>
              {saving ? t("features.dictation.keyDialog.saving") : t("features.dictation.keyDialog.save")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
