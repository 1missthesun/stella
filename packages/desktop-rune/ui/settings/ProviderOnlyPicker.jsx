import { BrandIcon, Button, Check, KeyRound, LogIn, Press, T, TextField, tx } from "../kit/compat";
import { useProviderOnlyPicker } from "./ProviderOnlyPicker.styles";
import { useCallback, useState } from "react";
import { findApiKey, findOauthCredential, findOauthProvider, useLlmCredentials, } from "@/global/settings/hooks/use-llm-credentials";
import { PROVIDER_CREDENTIALS, isApiKeyOnlyPlaceholder, } from "@/global/settings/lib/llm-providers";
import { useT } from "@/shared/i18n";
const STELLA_PROVIDER_KEY = "stella";
export function ProviderOnlyPicker({ providers, value, onSelect, disabled = false, ariaLabel, }) {
  const s = useProviderOnlyPicker();
    const t = useT();
    const credentials = useLlmCredentials();
    const [expandedProvider, setExpandedProvider] = useState(null);
    const [draftKey, setDraftKey] = useState("");
    const [savingProvider, setSavingProvider] = useState(null);
    const [oauthInFlight, setOauthInFlight] = useState(null);
    const [authError, setAuthError] = useState(null);
    const isConnected = useCallback((key) => {
        if (key === STELLA_PROVIDER_KEY)
            return true;
        if (findApiKey(credentials.apiKeys, key))
            return true;
        if (findOauthCredential(credentials.oauthCredentials, key))
            return true;
        return false;
    }, [credentials.apiKeys, credentials.oauthCredentials]);
    const handleRowClick = useCallback((key) => {
        if (disabled)
            return;
        if (isConnected(key)) {
            setExpandedProvider(null);
            setAuthError(null);
            onSelect(key);
            return;
        }
        setExpandedProvider((current) => (current === key ? null : key));
        setDraftKey("");
        setAuthError(null);
    }, [disabled, isConnected, onSelect]);
    const handleSaveKey = useCallback(async (key, label) => {
        const trimmed = draftKey.trim();
        if (!trimmed)
            return;
        setSavingProvider(key);
        setAuthError(null);
        try {
            await credentials.saveApiKey(key, label, trimmed);
            setDraftKey("");
            setExpandedProvider(null);
            onSelect(key);
        }
        catch (caught) {
            setAuthError(caught instanceof Error
                ? caught.message
                : t("settings.modelPicker.errors.saveApiKey"));
        }
        finally {
            setSavingProvider(null);
        }
    }, [credentials, draftKey, onSelect, t]);
    const handleLoginOAuth = useCallback(async (key) => {
        setOauthInFlight(key);
        setAuthError(null);
        try {
            await credentials.loginOAuth(key);
            setExpandedProvider(null);
            onSelect(key);
        }
        catch (caught) {
            setAuthError(caught instanceof Error
                ? caught.message
                : t("settings.modelPicker.errors.oauthLogin"));
        }
        finally {
            setOauthInFlight(null);
        }
    }, [credentials, onSelect, t]);
    return (<col {...s.providerOnlyPicker} role="radiogroup" label={ariaLabel}>
      {providers.map((provider) => {
            const llmEntry = PROVIDER_CREDENTIALS.find((entry) => entry.key === provider.key);
            const oauthProvider = findOauthProvider(credentials.oauthProviders, provider.key);
            const connected = isConnected(provider.key);
            const selected = value === provider.key;
            const expanded = expandedProvider === provider.key && !connected;
            const supportsOAuth = Boolean(oauthProvider);
            const supportsApiKey = Boolean(llmEntry) &&
                !isApiKeyOnlyPlaceholder(llmEntry?.placeholder ?? "");
            return (<col {...s.providerOnlyRow} key={provider.key} {...((selected || undefined) ? s.providerOnlyRowSelected : null)} {...((expanded || undefined) ? s.providerOnlyRowExpanded : null)}>
            <Press {...s.providerOnlyRowMain} role="radio" checked={selected} onPress={() => handleRowClick(provider.key)} disabled={disabled} {...((disabled) ? s.providerOnlyRowMainDisabled : null)}>
              <row {...s.providerOnlyRowIcon}>
                <BrandIcon brand={provider.key} size={16} />
              </row>
              <col {...s.providerOnlyRowText}>
                <T {...tx(s.providerOnlyRowMain)} {...s.providerOnlyRowName}>{provider.label}</T>
                {provider.description ? (<T {...tx(s.providerOnlyRowMain)} {...s.providerOnlyRowDesc}>
                    {provider.description}
                  </T>) : null}
              </col>
              <row {...s.providerOnlyRowMeta}>
                {provider.key !== STELLA_PROVIDER_KEY ? (<T {...tx(s.providerOnlyRowMain)} {...s.providerOnlyRowStatus} {...((connected || undefined) ? s.providerOnlyRowStatusOn : null)}>
                    {connected
                        ? t("settings.providerPicker.connected")
                        : t("settings.providerPicker.connect")}
                  </T>) : null}
                {selected ? (<Check size={13} {...s.providerOnlyRowCheck} color={s.providerOnlyRowCheck.color} />) : null}
              </row>
            </Press>
            {expanded ? (<col {...s.providerOnlyRowAuth}>
                {supportsOAuth ? (<row {...s.providerOnlyRowAuthLine}>
                    <LogIn size={13} />
                    <Button variant="ghost" onClick={() => void handleLoginOAuth(provider.key)} disabled={oauthInFlight !== null || disabled}>
                      {oauthInFlight === provider.key
                            ? t("settings.providerPicker.opening")
                            : t("settings.modelPicker.signInWith", { provider: provider.label })}
                    </Button>
                  </row>) : null}
                {supportsApiKey ? (<row {...s.providerOnlyRowAuthLine}>
                    <KeyRound size={13} />
                    <TextField type="password" label={t("settings.modelPicker.apiKeyAriaLabel", { provider: provider.label })} hideLabel placeholder={llmEntry?.placeholder ?? t("settings.modelPicker.apiKeyPlaceholder")} value={draftKey} onChange={(event) => setDraftKey(event.target.value)} onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                void handleSaveKey(provider.key, provider.label);
                            }
                        }} autoFocus={!supportsOAuth} disabled={disabled} />
                    <Button variant="primary" onClick={() => void handleSaveKey(provider.key, provider.label)} disabled={!draftKey.trim() ||
                            savingProvider === provider.key ||
                            disabled}>
                      {savingProvider === provider.key
                        ? t("settings.modelPicker.saving")
                        : t("common.save")}
                    </Button>
                  </row>) : null}
                {authError ? (<T w="full" {...s.providerOnlyRowAuthError} role="alert">
                    {authError}
                  </T>) : null}
              </col>) : null}
          </col>);
        })}
    </col>);
}
