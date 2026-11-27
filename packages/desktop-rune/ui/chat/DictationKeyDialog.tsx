import { useEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import { invalidateDictationRoute } from "@/features/dictation/services/dictation-transcriber";
import { invalidateOnDeviceDictation, onDeviceDictationStatus, openSystemDictationSettings } from "@/features/dictation/services/on-device-dictation";
import { BODY_TEXT, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../kit/compat";
import { Icon, Icons } from "../kit";
import { derive, font, fontSize, mixOklch, radius, useTokens } from "../theme";

export const DICTATION_KEY_NEEDED_EVENT = "stella:dictation-key-needed";
export const DICTATION_KEY_SAVED_EVENT = "stella:dictation-key-saved";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";
const PAD_X = 24;
const DIALOG_MAX_W = 420;

let mountedHosts = 0;

export const requestDictationKey = (): boolean => {
  if (mountedHosts === 0) return false;
  window.dispatchEvent(new CustomEvent(DICTATION_KEY_NEEDED_EVENT));
  return true;
};

function LinkButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <box role="link" label={label} focusable cursor="pointer" selfAlign="start" onPress={onPress}>
      <text family={BODY_TEXT.family} size={fontSize.sm} lineHeight={fontSize.sm * 1.5} tracking={0} underline color={color}>
        {label}
      </text>
    </box>
  );
}

/** desktop-ui's `DictationKeyDialog`: asks for an OpenRouter key when dictation has no route, or points at the system's dictation setting. */
export function DictationKeyDialog() {
  const t = useT();
  const tokens = useTokens();
  const c = tokens.c;
  const look = derive(tokens, "chat:dictation-key-dialog", (k) => ({ field: mixOklch(k.c.foreground, 5, "transparent"), error: mixOklch(k.c.destructive, 10, "transparent") }));
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
      <DialogContent fit maxW={DIALOG_MAX_W} fill={c.glassTop} gradient={tokens.gradient.glass} border={c.borderWeak}>
        <DialogHeader align="start" justify="start" pt={20} pr={PAD_X} pb={14} pl={PAD_X} borderSides={[0, 0, 1, 0]} border={c.borderWeak}>
          <col w="full" align="start">
            <DialogTitle size={19.2} grow={0}>
              {t("features.dictation.keyDialog.title")}
            </DialogTitle>
            <DialogDescription size={fontSize.base} lh={1.55} color={c.textBase} pr={0} pb={0} pl={0} mt={6}>
              {t("features.dictation.keyDialog.description")}
            </DialogDescription>
          </col>
        </DialogHeader>
        <DialogBody pt={14} px={PAD_X} pb={20} gap={10} align="stretch">
          {systemDictationOff ? (
            <row wrap align="end" gap={8} rowGap={4} mb={4}>
              <text size={fontSize.sm} lineHeight={fontSize.sm * 1.5} color={c.textBase}>
                {t("features.dictation.keyDialog.systemDictationOff")}
              </text>
              <LinkButton label={t("features.dictation.keyDialog.openSystemSettings")} color={c.textStrong} onPress={openSystemDictationSettings} />
            </row>
          ) : null}
          <row w="full" align="center" gap={8} minH={34} py={3} px={12} radius={radius.full} fill={look.field}>
            <Icon icon={Icons.stella.KeyRound} size={13} strokeWidth={1.75} color={c.textWeak} />
            <input
              grow={1}
              minW={0}
              secure
              spellcheck={false}
              autoFocus
              disabled={saving}
              value={draft}
              placeholder="sk-or-…"
              placeholderColor={c.mutedForeground}
              label={t("features.dictation.keyDialog.inputLabel")}
              size={fontSize.base}
              family={font.sans}
              color={c.textStrong}
              onInput={setDraft}
              onSubmit={() => void save()}
            />
          </row>
          <LinkButton label={t("features.dictation.keyDialog.getKey")} color={c.textWeak} onPress={() => window.electronAPI?.system?.openExternal?.(OPENROUTER_KEYS_URL)} />
          {error ? (
            <text role="alert" w="full" py={8} px={12} radius={8} fill={look.error} size={fontSize.sm} color={c.destructive}>
              {error}
            </text>
          ) : null}
          <row w="full" justify="end" gap={10} mt={6}>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!draft.trim() || saving}>
              {saving ? t("features.dictation.keyDialog.saving") : t("features.dictation.keyDialog.save")}
            </Button>
          </row>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
