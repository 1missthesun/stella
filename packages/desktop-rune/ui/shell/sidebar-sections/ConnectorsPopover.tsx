import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ElectronNativeIntegration } from "@/shared/types/electron";
import { useT } from "@/shared/i18n";
import { EmptyState, Icon, Icons } from "../../kit";
import { Popover, PopoverBody, PopoverContent } from "../../kit/compat";
import { fontSize, look, mix, mixOklch, radius, useTokens, weight } from "../../theme";

type Phase = "idle" | "loading" | "ready" | "error";
type NativeIntegrationsApi = NonNullable<typeof window.electronAPI>["nativeIntegrations"];

const SM = look(fontSize.sm, weight.regular);
const META = look(11, weight.regular);
const MAX_H = 420;
const HEAD_H = 2 + 26 + 8;
const LIST_MAX_H = MAX_H - 2 - 12 * 2 - HEAD_H;

/** desktop-ui's `ConnectorsPopover`, opened from the settings menu at `anchor`. */
export function ConnectorsPopover({
  open,
  onOpenChange,
  side = "top",
  align = "end",
  anchor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  anchor: string;
}) {
  const t = useT();
  const tk = useTokens();
  const [phase, setPhase] = useState<Phase>("idle");
  const [connectors, setConnectors] = useState<ElectronNativeIntegration[]>([]);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [accountErrors, setAccountErrors] = useState<Readonly<Record<string, string>>>({});
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api?.list) {
      setPhase("error");
      return;
    }
    setPhase((current) => (current === "ready" ? current : "loading"));
    try {
      const list = await api.list();
      setConnectors([...list].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)));
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
    return connectors.filter((connector) => `${connector.name} ${connector.category} ${connector.description}`.toLowerCase().includes(trimmed));
  }, [connectors, query]);

  const markBusy = (key: string, busy: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });

  const toggle = useCallback(async (connector: ElectronNativeIntegration) => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api) return;
    markBusy(connector.id, true);
    try {
      const updated = connector.enabled ? await api.disable({ id: connector.id }) : await api.enable({ id: connector.id });
      setConnectors((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch {
    } finally {
      markBusy(connector.id, false);
    }
  }, []);

  const changeAccounts = useCallback(async (connector: ElectronNativeIntegration, busyKey: string, run: (api: NativeIntegrationsApi) => Promise<ElectronNativeIntegration>) => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api) return;
    markBusy(busyKey, true);
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
          if (updated.provider === "google-workspace" && entry.provider === "google-workspace" && updated.accounts) return { ...entry, accounts: updated.accounts };
          return entry;
        }),
      );
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/u, "") : "Something went wrong.";
      setAccountErrors((current) => ({ ...current, [connector.id]: message }));
    } finally {
      markBusy(busyKey, false);
    }
  }, []);

  const status = (children: ReactNode, role?: "status" | "alert") => (
    <row role={role} align="center" gap={8} pt={10} pr={12} pb={12} pl={6}>
      {children}
    </row>
  );
  const statusText = (text: string) => (
    <text {...SM} color={tk.c.textWeak}>
      {text}
    </text>
  );
  const enabledPill = { border: mix(tk.c.accent, 55, tk.c.border), fill: mix(tk.c.accent, 12, "transparent"), color: tk.c.textStrong };
  const pill = (enabled: boolean) => ({
    h: 24,
    px: 10 + 1,
    shrink: false,
    center: true,
    radius: radius.full,
    border: enabled ? enabledPill.border : tk.c.border,
    fill: enabled ? enabledPill.fill : undefined,
  });
  const pillText = (enabled: boolean) => ({ ...look(11, weight.medium), color: enabled ? enabledPill.color : tk.c.textWeak });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent id="connectors-popover" w={320} minW={320} maxW={320} maxH={MAX_H} side={side} align={align} anchorTo={anchor} sideOffset={8} collisionPadding={8}>
        <PopoverBody pr={0}>
          <row align="center" gap={8} shrink={false} pt={2} pr={12} pb={8} pl={6}>
            <text {...look(fontSize.sm, weight.medium)} color={tk.c.textStrong} shrink={false} nowrap>
              {t("shell.connectors.title")}
            </text>
            <row
              align="center"
              gap={6}
              grow={1}
              w={0}
              minW={0}
              minH={26}
              px={9 + 1}
              radius={radius.full}
              border={searchFocused ? tk.c.borderStrong : tk.c.border}
              fill={tk.c.surfaceInset}
              shadows={searchFocused ? tk.shadow.focusRing : undefined}
            >
              <Icon icon={Icons.stella.Search} size={13} strokeWidth={1.75} color={tk.c.textWeak} />
              <input
                id="connectors-popover-search"
                grow={1}
                minW={0}
                h={24}
                value={query}
                placeholder={t("shell.connectors.searchPlaceholder")}
                placeholderColor={tk.c.textWeaker}
                label={t("shell.connectors.searchLabel")}
                disabled={phase !== "ready"}
                {...SM}
                color={tk.c.textStrong}
                onInput={setQuery}
                onFocus={(focused) => setSearchFocused(focused)}
              />
            </row>
          </row>
          {phase === "loading" || phase === "idle" ? (
            status(
              <>
                <Icon icon={Icons.stella.LoaderCircle} size={16} strokeWidth={2} color={tk.c.textWeak} spin={0.8} />
                {statusText(t("shell.connectors.loading"))}
              </>,
              "status",
            )
          ) : phase === "error" ? (
            status(statusText(t("shell.connectors.desktopRequired")), "alert")
          ) : connectors.length === 0 ? (
            status(statusText(t("shell.connectors.empty")))
          ) : visibleConnectors.length === 0 ? (
            <EmptyState id="connectors-popover-no-matches" motif="search" size="compact" title={t("shell.connectors.noMatchesTitle")} body={t("shell.connectors.noMatchesBody")} />
          ) : (
            <col id="connectors-popover-list" role="list" gap={1} maxH={LIST_MAX_H} scrollY>
              {visibleConnectors.map((connector) => {
                const busy = busyIds.has(connector.id);
                const showAccounts = connector.multiAccount && connector.enabled;
                const accounts = showAccounts ? (connector.accounts ?? []) : [];
                const addKey = `${connector.id}:add`;
                const addBusy = busyIds.has(addKey);
                return (
                  <col key={connector.id} role="listitem">
                    <row align="center" gap={10} minH={40} py={5} px={6} radius={radius.md} hoverFill={mixOklch(tk.c.foreground, 5, "transparent")}>
                      {connector.iconUrl ? (
                        <box w={22} h={22} shrink={false} radius={6} clip={6}>
                          <image src={connector.iconUrl} w={22} h={22} fit="contain" />
                        </box>
                      ) : (
                        <box w={22} h={22} shrink={false} center radius={6} fill={mixOklch(tk.c.foreground, 10, "transparent")} inert>
                          <text {...look(11, weight.semibold)} color={tk.c.textWeak}>
                            {connector.name.slice(0, 1).toUpperCase()}
                          </text>
                        </box>
                      )}
                      <col grow={1} w={0} minW={0} gap={1}>
                        <text {...SM} color={tk.c.textStrong} nowrap truncate>
                          {connector.name}
                        </text>
                        <text {...META} color={tk.c.textWeak} nowrap truncate>
                          {connector.category}
                          {connector.toolCount > 0 ? ` · ${connector.toolCount} tools` : ""}
                        </text>
                      </col>
                      {connector.connectable ? (
                        <box role="button" {...pill(connector.enabled)} disabled={busy} cursor="default" onPress={() => void toggle(connector)}>
                          <text {...pillText(connector.enabled)}>{busy ? "…" : connector.enabled ? "On" : "Off"}</text>
                        </box>
                      ) : connector.enabled ? (
                        <box {...pill(true)}>
                          <text {...pillText(true)}>On</text>
                        </box>
                      ) : null}
                    </row>
                    {showAccounts ? (
                      <col role="list" label={`${connector.name} accounts`} gap={2} mb={6} ml={38} pr={6}>
                        {accounts.map((account) => {
                          const key = `${connector.id}:${account.id}`;
                          const accountBusy = busyIds.has(key);
                          const accountRef = account.email ?? account.id;
                          return (
                            <row key={account.id} role="listitem" align="center" gap={8} minH={24}>
                              <text
                                {...look(12, weight.regular)}
                                color={account.connected ? tk.c.textStrong : tk.c.textWeaker}
                                strike={!account.connected}
                                grow={1}
                                w={0}
                                minW={0}
                                nowrap
                                truncate
                                title={account.email ?? account.label}
                              >
                                {account.email ?? account.label}
                              </text>
                              {account.primary ? (
                                <box shrink={false} py={1} px={7} radius={radius.full} fill={mix(tk.c.accent, 14, "transparent")}>
                                  <text {...look(10.5, weight.medium)} color={tk.c.textStrong}>
                                    {t("shell.connectors.primary")}
                                  </text>
                                </box>
                              ) : (
                                <AccountLink
                                  label={t("shell.connectors.setPrimary")}
                                  disabled={accountBusy}
                                  onPress={() => void changeAccounts(connector, key, (api) => api.setPrimaryAccount({ id: connector.id, account: accountRef }))}
                                />
                              )}
                              <AccountLink
                                danger
                                label={accountBusy ? "…" : t("shell.connectors.removeAccount")}
                                disabled={accountBusy}
                                onPress={() => void changeAccounts(connector, key, (api) => api.removeAccount({ id: connector.id, account: accountRef }))}
                              />
                            </row>
                          );
                        })}
                        <row role="listitem" align="center" minH={24}>
                          <AddAccountButton
                            label={t("shell.connectors.addAccount")}
                            busy={addBusy}
                            onPress={() => void changeAccounts(connector, addKey, (api) => api.addAccount({ id: connector.id }))}
                          />
                        </row>
                        {accountErrors[connector.id] ? (
                          <text role="alert" {...look(11, weight.regular, { lh: 1.35 })} color={tk.c.danger}>
                            {accountErrors[connector.id]}
                          </text>
                        ) : null}
                      </col>
                    ) : null}
                  </col>
                );
              })}
            </col>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

function AccountLink({ label, disabled, danger, onPress }: { label: string; disabled: boolean; danger?: boolean; onPress: () => void }) {
  const tk = useTokens();
  return (
    <box role="button" shrink={false} radius={4} disabled={disabled} hoverGroup cursor="default" onPress={onPress}>
      <text {...look(11, weight.regular)} color={tk.c.textWeak} hoverColor={disabled ? undefined : danger ? tk.c.danger : tk.c.textStrong}>
        {label}
      </text>
    </box>
  );
}

function AddAccountButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  const color = hovered && !busy ? tk.c.textStrong : tk.c.textWeak;
  return (
    <row role="button" align="center" gap={5} radius={4} disabled={busy} cursor="default" onHover={setHovered} onPress={onPress}>
      <Icon icon={busy ? Icons.stella.LoaderCircle : Icons.stella.Plus} size={12} strokeWidth={2} color={color} spin={busy ? 0.8 : undefined} />
      <text {...look(12, weight.regular)} color={color}>
        {label}
      </text>
    </row>
  );
}
