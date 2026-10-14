import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BrowserExtensionClient,
  BrowserExtensionClientStatus,
  BrowserExtensionClientsState,
  BrowserExtensionRouting,
} from "@stella/contracts/desktop/browser-view";
import { Select } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { useT } from "@/shared/i18n";

const POLL_MS = 3_000;
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
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
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
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-label">
            {t("settings.browserExtension.useLabel")}
          </div>
          <div className="settings-row-sublabel">
            {t("settings.browserExtension.useDescription")}
          </div>
        </div>
        <div className="settings-row-control">
          <Select
            className="settings-runtime-select"
            aria-label={t("settings.browserExtension.useLabel")}
            value={
              preferredKnown && state.preferredKey
                ? state.preferredKey
                : AUTOMATIC
            }
            disabled={saving}
            options={options}
            onValueChange={(value) =>
              void apply({
                preferredKey: value === AUTOMATIC ? null : value,
                disabledKeys: state.disabledKeys.filter((key) => key !== value),
              })
            }
          />
        </div>
      </div>
      {state.clients.map((client) => {
        const name = clientName(client, fallbackName);
        return (
          <div
            key={client.key}
            className="settings-row"
            data-browser-client-status={client.status}
          >
            <div className="settings-row-info">
              <div className="settings-row-label">{name}</div>
              <div className="settings-row-sublabel">
                {t(STATUS_KEYS[client.status])}
              </div>
            </div>
            <div className="settings-row-control">
              <Switch
                checked={client.enabled}
                disabled={saving}
                aria-label={name}
                hideLabel
                onCheckedChange={(next) => {
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
                }}
              />
            </div>
          </div>
        );
      })}
      {error ? (
        <p className="settings-card-desc settings-card-desc--error">
          {t("settings.browserExtension.saveError")}
        </p>
      ) : null}
    </>
  );
}
