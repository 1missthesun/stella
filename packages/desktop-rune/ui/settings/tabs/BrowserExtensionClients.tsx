import { SettingsCardDesc, SettingsRow, SettingsSelect } from "../parts";
import { Select, Switch, T } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BrowserExtensionClient,
  BrowserExtensionClientStatus,
  BrowserExtensionClientsState,
  BrowserExtensionRouting,
} from "@stella/contracts/desktop/browser-view";
import { useT } from "@/shared/i18n";

const AUTOMATIC = "__automatic__";

const STATUS_KEYS: Record<BrowserExtensionClientStatus, string> = {
  in_use: "settings.browserExtension.status.inUse",
  connected: "settings.browserExtension.status.connected",
  not_connected: "settings.browserExtension.status.notConnected",
  off: "settings.browserExtension.status.off",
};

const clientName = (client: BrowserExtensionClient, fallback: string) => {
  const browser = client.browser.trim() || fallback;
  const profile = client.profile?.trim();
  const email = client.email?.trim();
  const who =
    profile && email && profile !== email
      ? `${profile} (${email})`
      : profile || email;
  return who ? `${browser} · ${who}` : browser;
};

export function BrowserExtensionClients() {
  const s = useSettings();
  const t = useT();
  const [state, setState] = useState<BrowserExtensionClientsState | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const savingRef = useRef(false);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.browserView;
    if (!api?.getExtensionClients || savingRef.current) return;
    try {
      const next = await api.getExtensionClients();
      if (!savingRef.current) setState(next);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.electronAPI?.browserView?.onExtensionClients?.((next) => {
      if (!savingRef.current) setState(next);
    });
  }, [refresh]);

  const apply = useCallback(
    async (routing: BrowserExtensionRouting) => {
      const api = window.electronAPI?.browserView;
      if (!api?.setExtensionRouting || !state) return;
      const previous = state;
      savingRef.current = true;
      setSaving(true);
      setError(false);
      setState({ ...state, ...routing });
      try {
        setState(await api.setExtensionRouting(routing));
      } catch {
        setState(previous);
        setError(true);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [state],
  );

  if (!state || state.clients.length === 0) return null;

  const fallbackName = t("settings.browserExtension.unknownBrowser");
  const disabled = new Set(state.disabledKeys);
  const preferredKnown = state.clients.some(
    (client) => client.key === state.preferredKey,
  );
  const options = [
    { value: AUTOMATIC, label: t("settings.browserExtension.automatic") },
    ...state.clients.map((client) => ({
      value: client.key,
      label: clientName(client, fallbackName),
      disabled: disabled.has(client.key),
    })),
  ];

  return (
    <>
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.browserExtension.useLabel")}
          </T>
          <T w="full" {...s.settingsRowSublabel}>
            {t("settings.browserExtension.useDescription")}
          </T>
        </col>
        <row {...s.settingsRowControl}>
          <SettingsSelect aria-label={t("settings.browserExtension.useLabel")} value={
              preferredKnown && state.preferredKey
                ? state.preferredKey
                : AUTOMATIC
            } disabled={saving} options={options} onValueChange={(value) =>
              void apply({
                preferredKey: value === AUTOMATIC ? null : value,
                disabledKeys: state.disabledKeys.filter((key) => key !== value),
              })
            } />
        </row>
      </SettingsRow>
      {state.clients.map((client) => {
        const name = clientName(client, fallbackName);
        return (
          <SettingsRow key={client.key}>
            <col {...s.settingsRowInfo}>
              <T w="full" {...s.settingsRowLabel}>{name}</T>
              <T w="full" {...s.settingsRowSublabel}>
                {t(STATUS_KEYS[client.status])}
              </T>
            </col>
            <row {...s.settingsRowControl}>
              <Switch checked={client.enabled} disabled={saving} aria-label={name} hideLabel onCheckedChange={(next) => {
                  const others = state.disabledKeys.filter(
                    (key) => key !== client.key,
                  );
                  void apply({
                    preferredKey:
                      !next && state.preferredKey === client.key
                        ? null
                        : state.preferredKey,
                    disabledKeys: next ? others : [...others, client.key],
                  });
                }} />
            </row>
          </SettingsRow>
        );
      })}
      {error ? (
        <SettingsCardDesc error>
          {t("settings.browserExtension.saveError")}
        </SettingsCardDesc>
      ) : null}
    </>
  );
}
