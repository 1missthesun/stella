import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import type { ElectronNativeIntegration } from "@/shared/types/electron";
import { useT } from "@/shared/i18n";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/popover";
import { LoaderCircle, Plus, Search } from "@/ui/icons";
import "./connectors-popover.css";

type Phase = "idle" | "loading" | "ready" | "error";

export function ConnectorsPopover({
  trigger,
  open: controlledOpen,
  onOpenChange,
  side = "top",
  align = "end",
}: {
  trigger: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}) {
  const t = useT();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [phase, setPhase] = useState<Phase>("idle");
  const [connectors, setConnectors] = useState<ElectronNativeIntegration[]>([]);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [accountErrors, setAccountErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api?.list) {
      setPhase("error");
      return;
    }
    setPhase((current) => (current === "ready" ? current : "loading"));
    try {
      const list = await api.list();
      setConnectors(
        [...list].sort(
          (a, b) =>
            Number(b.enabled) - Number(a.enabled) ||
            a.name.localeCompare(b.name),
        ),
      );
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else setQuery("");
  }, [load, open]);

  const visibleConnectors = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return connectors;
    return connectors.filter((connector) =>
      `${connector.name} ${connector.category} ${connector.description}`
        .toLowerCase()
        .includes(trimmed),
    );
  }, [connectors, query]);

  const toggle = useCallback(async (connector: ElectronNativeIntegration) => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api) return;
    setBusyIds((current) => new Set(current).add(connector.id));
    try {
      const updated = connector.enabled
        ? await api.disable({ id: connector.id })
        : await api.enable({ id: connector.id });
      setConnectors((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch {
      // The row keeps its previous state; reopening refreshes the list.
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(connector.id);
        return next;
      });
    }
  }, []);

  const changeAccounts = useCallback(
    async (
      connector: ElectronNativeIntegration,
      busyKey: string,
      run: (
        api: NonNullable<typeof window.electronAPI>["nativeIntegrations"],
      ) => Promise<ElectronNativeIntegration>,
    ) => {
      const api = window.electronAPI?.nativeIntegrations;
      if (!api) return;
      setBusyIds((current) => new Set(current).add(busyKey));
      setAccountErrors((current) => {
        const next = { ...current };
        delete next[connector.id];
        return next;
      });
      try {
        const updated = await run(api);
        setConnectors((current) =>
          current.map((entry) => {
            if (entry.id === updated.id) return updated;
            if (
              updated.provider === "google-workspace" &&
              entry.provider === "google-workspace" &&
              updated.accounts
            ) {
              return { ...entry, accounts: updated.accounts };
            }
            return entry;
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message.replace(
                /^Error invoking remote method '[^']+': (Error: )?/u,
                "",
              )
            : "Something went wrong.";
        setAccountErrors((current) => ({
          ...current,
          [connector.id]: message,
        }));
      } finally {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(busyKey);
          return next;
        });
      }
    },
    [],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="connectors-popover"
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={8}
      >
        <PopoverBody>
          <div className="connectors-popover__head">
            <span className="connectors-popover__title">
              {t("shell.connectors.title")}
            </span>
            <label className="connectors-popover__search">
              <Search size={13} strokeWidth={1.75} aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t("shell.connectors.searchPlaceholder")}
                aria-label={t("shell.connectors.searchLabel")}
                disabled={phase !== "ready"}
              />
            </label>
          </div>
          {phase === "loading" || phase === "idle" ? (
            <div className="connectors-popover__status" role="status">
              <LoaderCircle
                className="stella-loader-circle"
                size={16}
                strokeWidth={2}
                aria-hidden="true"
              />
              {t("shell.connectors.loading")}
            </div>
          ) : phase === "error" ? (
            <div className="connectors-popover__status" role="alert">
              {t("shell.connectors.desktopRequired")}
            </div>
          ) : connectors.length === 0 ? (
            <div className="connectors-popover__status">
              {t("shell.connectors.empty")}
            </div>
          ) : visibleConnectors.length === 0 ? (
            <EmptyState
              motif="search"
              size="compact"
              title={t("shell.connectors.noMatchesTitle")}
              body={t("shell.connectors.noMatchesBody")}
            />
          ) : (
            <ul className="connectors-popover__list">
              {visibleConnectors.map((connector) => {
                const busy = busyIds.has(connector.id);
                const accounts =
                  connector.multiAccount && connector.enabled
                    ? (connector.accounts ?? [])
                    : [];
                const showAccounts =
                  connector.multiAccount && connector.enabled;
                const addKey = `${connector.id}:add`;
                return (
                  <li key={connector.id} className="connectors-popover__item">
                    <div className="connectors-popover__row">
                      {connector.iconUrl ? (
                        <img
                          className="connectors-popover__icon"
                          src={connector.iconUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span
                          className="connectors-popover__icon connectors-popover__icon--fallback"
                          aria-hidden="true"
                        >
                          {connector.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="connectors-popover__copy">
                        <span className="connectors-popover__name">
                          {connector.name}
                        </span>
                        <span className="connectors-popover__meta">
                          {connector.category}
                          {connector.toolCount > 0
                            ? ` · ${connector.toolCount} tools`
                            : ""}
                        </span>
                      </span>
                      {connector.connectable ? (
                        <button
                          type="button"
                          className="connectors-popover__toggle"
                          data-enabled={connector.enabled || undefined}
                          disabled={busy}
                          onClick={() => void toggle(connector)}
                        >
                          {busy ? "…" : connector.enabled ? "On" : "Off"}
                        </button>
                      ) : connector.enabled ? (
                        <span
                          className="connectors-popover__toggle"
                          data-enabled="true"
                        >
                          On
                        </span>
                      ) : null}
                    </div>
                    {showAccounts ? (
                      <ul
                        className="connectors-popover__accounts"
                        aria-label={`${connector.name} accounts`}
                      >
                        {accounts.map((account) => {
                          const key = `${connector.id}:${account.id}`;
                          const accountBusy = busyIds.has(key);
                          return (
                            <li
                              key={account.id}
                              className="connectors-popover__account"
                              data-disconnected={
                                !account.connected || undefined
                              }
                            >
                              <span
                                className="connectors-popover__account-email"
                                title={account.email ?? account.label}
                              >
                                {account.email ?? account.label}
                              </span>
                              {account.primary ? (
                                <span className="connectors-popover__badge">
                                  {t("shell.connectors.primary")}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="connectors-popover__link"
                                  disabled={accountBusy}
                                  onClick={() =>
                                    void changeAccounts(connector, key, (api) =>
                                      api.setPrimaryAccount({
                                        id: connector.id,
                                        account: account.email ?? account.id,
                                      }),
                                    )
                                  }
                                >
                                  {t("shell.connectors.setPrimary")}
                                </button>
                              )}
                              <button
                                type="button"
                                className="connectors-popover__link connectors-popover__link--danger"
                                disabled={accountBusy}
                                onClick={() =>
                                  void changeAccounts(connector, key, (api) =>
                                    api.removeAccount({
                                      id: connector.id,
                                      account: account.email ?? account.id,
                                    }),
                                  )
                                }
                              >
                                {accountBusy
                                  ? "…"
                                  : t("shell.connectors.removeAccount")}
                              </button>
                            </li>
                          );
                        })}
                        <li className="connectors-popover__account">
                          <button
                            type="button"
                            className="connectors-popover__add"
                            disabled={busyIds.has(addKey)}
                            onClick={() =>
                              void changeAccounts(connector, addKey, (api) =>
                                api.addAccount({ id: connector.id }),
                              )
                            }
                          >
                            {busyIds.has(addKey) ? (
                              <LoaderCircle
                                className="stella-loader-circle"
                                size={12}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            ) : (
                              <Plus
                                size={12}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            )}
                            {t("shell.connectors.addAccount")}
                          </button>
                        </li>
                        {accountErrors[connector.id] ? (
                          <li
                            className="connectors-popover__account-error"
                            role="alert"
                          >
                            {accountErrors[connector.id]}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
