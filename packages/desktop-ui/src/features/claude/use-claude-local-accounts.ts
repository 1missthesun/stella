import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeLocalAccountsState } from "@stella/contracts/claude-local-accounts";

export function useClaudeLocalAccounts() {
  const available =
    typeof window !== "undefined" &&
    Boolean(window.electronAPI?.system?.listClaudeLocalAccounts);
  const [state, setState] = useState<ClaudeLocalAccountsState | null>(null);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    const list = window.electronAPI?.system?.listClaudeLocalAccounts;
    if (!list) return;
    try {
      const next = await list();
      if (mounted.current) setState(next);
    } catch {
      // Keep the last state; the next change reloads it.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const unsubscribe = window.electronAPI?.system?.onClaudeLocalAccountsChanged?.(() => {
      void reload();
    });
    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
  }, [reload]);

  const configs = state?.configs ?? [];
  return {
    available,
    loaded: state !== null,
    cliInstalled: state?.cliInstalled ?? false,
    configs,
    activeConfigId: state?.activeConfigId ?? null,
    activeReason: state?.activeReason,
    signedIn: configs.some((config) => config.loggedIn),
    defaultSignedOut: configs.some((config) => config.isDefault && !config.loggedIn),
    signOut: async (configId: string) => {
      try {
        await window.electronAPI?.system?.signOutClaudeLocalConfig?.(configId);
      } finally {
        void reload();
      }
    },
    reload,
  };
}

