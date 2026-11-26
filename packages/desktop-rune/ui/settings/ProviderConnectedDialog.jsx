import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, T } from "../kit/compat";
import { useProviderConnectedDialog } from "./ProviderConnectedDialog.styles";
import { usePill } from "../global/shared/pill.styles";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PROVIDER_CREDENTIALS } from "@/global/settings/lib/llm-providers";
import { PROVIDER_CONNECTED_EVENT, } from "@/global/settings/hooks/use-llm-credentials";
import { useT } from "@/shared/i18n";
import { ASSISTANT_AGENT_KEYS, DEFAULT_MODEL_BY_PROVIDER, } from "@/global/settings/lib/provider-default-models";
const PROVIDER_SURFACES = {
    openai: { assistant: true, image: "openai", voice: "openai" },
    anthropic: { assistant: true, image: null, voice: null },
    google: { assistant: true, image: null, voice: null },
    meta: { assistant: true, image: null, voice: null },
    openrouter: { assistant: true, image: "openrouter", voice: null },
    fal: { assistant: false, image: "fal", voice: null },
    xai: { assistant: true, image: null, voice: "xai" },
};
export function ProviderConnectedDialog() {
  const s = useProviderConnectedDialog();
    const t = useT();
    const [stage, setStage] = useState(null);
    const [assistant, setAssistant] = useState(true);
    const [image, setImage] = useState(true);
    const [voice, setVoice] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        const handler = (event) => {
            const detail = event.detail;
            const surfaces = PROVIDER_SURFACES[detail.provider];
            if (!surfaces)
                return;
            const offeredCount = (surfaces.assistant ? 1 : 0) +
                (surfaces.image ? 1 : 0) +
                (surfaces.voice ? 1 : 0);
            if (offeredCount === 0)
                return;
            if (offeredCount === 1) {
                if (!surfaces.assistant && (surfaces.image || surfaces.voice)) {
                    const patch = {};
                    if (surfaces.image) {
                        patch.imageGeneration = { provider: surfaces.image };
                    }
                    if (surfaces.voice) {
                        patch.realtimeVoice = { provider: surfaces.voice };
                    }
                    void window.electronAPI?.system
                        ?.setLocalModelPreferences?.(patch)
                        .then(() => {
                        window.dispatchEvent(new CustomEvent("stella:local-model-preferences-changed"));
                    });
                }
                return;
            }
            const llmEntry = PROVIDER_CREDENTIALS.find((entry) => entry.key === detail.provider);
            setStage({
                detail,
                surfaces,
                providerLabel: llmEntry?.label ?? detail.provider,
            });
            setAssistant(surfaces.assistant);
            setImage(Boolean(surfaces.image));
            setVoice(Boolean(surfaces.voice));
            setError(null);
        };
        window.addEventListener(PROVIDER_CONNECTED_EVENT, handler);
        return () => window.removeEventListener(PROVIDER_CONNECTED_EVENT, handler);
    }, []);
    const onClose = useCallback(() => {
        setStage(null);
        setError(null);
    }, []);
    const onApply = useCallback(async () => {
        if (!stage)
            return;
        const { detail, surfaces } = stage;
        const patch = {};
        if (surfaces.assistant && assistant) {
            const existing = (await window.electronAPI?.system?.getLocalModelPreferences?.())
                ?.modelOverrides ?? {};
            const next = { ...existing };
            const model = DEFAULT_MODEL_BY_PROVIDER[detail.provider];
            if (model) {
                for (const key of ASSISTANT_AGENT_KEYS) {
                    next[key] = model;
                }
                patch.modelOverrides = next;
            }
        }
        if (surfaces.image && image) {
            patch.imageGeneration = { provider: surfaces.image };
        }
        if (surfaces.voice && voice) {
            patch.realtimeVoice = { provider: surfaces.voice };
        }
        if (Object.keys(patch).length === 0) {
            onClose();
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await window.electronAPI?.system?.setLocalModelPreferences?.(patch);
            window.dispatchEvent(new CustomEvent("stella:local-model-preferences-changed"));
            onClose();
        }
        catch (caught) {
            setError(caught instanceof Error
                ? caught.message
                : t("settings.providerConnected.errors.apply"));
        }
        finally {
            setBusy(false);
        }
    }, [assistant, image, onClose, stage, t, voice]);
    const anyChecked = useMemo(() => {
        if (!stage)
            return false;
        const { surfaces } = stage;
        return ((surfaces.assistant && assistant) ||
            (Boolean(surfaces.image) && image) ||
            (Boolean(surfaces.voice) && voice));
    }, [assistant, image, stage, voice]);
    if (!stage)
        return null;
    const { providerLabel, surfaces } = stage;
    return (<Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent fit {...s.providerConnectedDialog}>
        <DialogHeader {...s.providerConnectedDialog_dialogHeader}>
          <col w="full">
            <DialogTitle {...s.providerConnectedDialog_dialogTitle}>
              {t("settings.providerConnected.title", { provider: providerLabel })}
            </DialogTitle>
            <DialogDescription {...s.providerConnectedDialog_dialogDescription}>
              {t("settings.providerConnected.description", {
                  provider: providerLabel,
              })}
            </DialogDescription>
          </col>
        </DialogHeader>
        <DialogBody {...s.providerConnectedDialog_dialogBody} {...s.providerConnectedDialogBody}>
          {surfaces.assistant ? (<row {...s.providerConnectedRow}>
              <Input type="checkbox" checked={assistant} onChange={(event) => setAssistant(event.target.checked)} />
              <row>
                <T {...s.providerConnectedRowLabel}>
                  {t("settings.providerConnected.assistant.label")}
                </T>
                <T {...s.providerConnectedRowDesc}>
                  {t("settings.providerConnected.assistant.description", {
                    provider: providerLabel,
                })}
                </T>
              </row>
            </row>) : null}
          {surfaces.image ? (<row {...s.providerConnectedRow}>
              <Input type="checkbox" checked={image} onChange={(event) => setImage(event.target.checked)} />
              <row>
                <T {...s.providerConnectedRowLabel}>
                  {t("settings.providerConnected.image.label")}
                </T>
                <T {...s.providerConnectedRowDesc}>
                  {t("settings.providerConnected.image.description", {
                    provider: providerLabel,
                })}
                </T>
              </row>
            </row>) : null}
          {surfaces.voice ? (<row {...s.providerConnectedRow}>
              <Input type="checkbox" checked={voice} onChange={(event) => setVoice(event.target.checked)} />
              <row>
                <T {...s.providerConnectedRowLabel}>
                  {t("settings.providerConnected.voice.label")}
                </T>
                <T {...s.providerConnectedRowDesc}>
                  {t("settings.providerConnected.voice.description", {
                    provider: providerLabel,
                })}
                </T>
              </row>
            </row>) : null}
          {error ? (<T w="full" {...s.providerConnectedError} role="alert">
              {error}
            </T>) : null}
          <row {...s.providerConnectedActions}>
            <Button variant="ghost" className="pill-btn" onClick={onClose} disabled={busy}>
              {t("settings.providerConnected.skip")}
            </Button>
            <Button variant="primary" className="pill-btn pill-btn--primary" onClick={() => void onApply()} disabled={busy || !anyChecked}>
              {busy
                ? t("settings.providerConnected.applying")
                : t("settings.providerConnected.apply")}
            </Button>
          </row>
        </DialogBody>
      </DialogContent>
    </Dialog>);
}
