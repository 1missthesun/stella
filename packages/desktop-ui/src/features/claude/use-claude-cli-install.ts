import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaudeCliInstallProgress,
  ClaudeCliInstallResult,
} from "@stella/contracts/claude-local-accounts";

export type ClaudeCliInstallState =
  | { status: "idle" }
  | { status: "installing"; progress: ClaudeCliInstallProgress }
  | { status: "installed" }
  | { status: "error"; kind: "offline" | "unavailable" | "failed"; detail: string };

/** Installs Claude Code on this computer with Anthropic's installer, with progress. */
export function useClaudeCliInstall() {
  const available =
    typeof window !== "undefined" &&
    Boolean(window.electronAPI?.system?.installClaudeCli);
  const [state, setState] = useState<ClaudeCliInstallState>({ status: "idle" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const system = window.electronAPI?.system;
    if (!system?.installClaudeCli) return false;
    setState({ status: "installing", progress: { phase: "checking" } });
    const unsubscribe = system.onClaudeCliInstallProgress?.((progress) => {
      if (mounted.current) setState({ status: "installing", progress });
    });
    let result: ClaudeCliInstallResult;
    try {
      result = await system.installClaudeCli();
    } catch (error) {
      result = {
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      unsubscribe?.();
    }
    if (!mounted.current) return result.status === "installed";
    if (result.status === "installed") {
      setState({ status: "installed" });
      return true;
    }
    setState({ status: "error", kind: result.status, detail: result.detail });
    return false;
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { available, state, install, reset };
}

/** Whole-number percent for a download with a known size, else null. */
export const claudeInstallPercent = (progress: ClaudeCliInstallProgress): number | null =>
  progress.phase === "downloading" && progress.total
    ? Math.min(99, Math.floor((progress.received / progress.total) * 100))
    : null;

/**
 * Installs Claude Code, then goes straight on to signing in to the person's
 * Claude plan, the same way from onboarding, Settings and the chat.
 */
export function useClaudeInstallThenSignIn({
  reload,
  signIn,
}: {
  reload: () => Promise<void>;
  signIn: () => void;
}) {
  const { available, state, install, reset } = useClaudeCliInstall();
  const reloadRef = useRef(reload);
  const signInRef = useRef(signIn);
  useEffect(() => {
    reloadRef.current = reload;
    signInRef.current = signIn;
  });
  const run = useCallback(async (): Promise<boolean> => {
    if (!(await install())) return false;
    await reloadRef.current();
    signInRef.current();
    return true;
  }, [install]);
  return { available, state, run, reset, installing: state.status === "installing" };
}
