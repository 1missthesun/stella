import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AntigravitySignInProgress, AntigravityStatus } from "@stella/contracts/antigravity";
import { createResourceStore, useResourceStore } from "@/shared/lib/resource-cache";

const KEY = "default" as const;

const statusStore = createResourceStore<typeof KEY, AntigravityStatus | null>({
  fetcher: async () => (await window.electronAPI?.system?.antigravityStatus?.()) ?? null,
  staleMs: 30_000,
});

export type AntigravitySignIn =
  | { state: "idle" }
  | { state: "running"; progress: AntigravitySignInProgress; submitting: boolean }
  | { state: "failed"; message: string };

const IDLE: AntigravitySignIn = { state: "idle" };
// @reloadable a sign-in under way in the host; a reload only loses this view of it
let current: AntigravitySignIn = IDLE;
const listeners = new Set<() => void>();
const set = (next: AntigravitySignIn) => {
  current = next;
  for (const listener of [...listeners]) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : "").replace(/^Error invoking remote method '[^']*': (?:Error: )?/u, "");

export function useAntigravity() {
  const { data: status, refresh } = useResourceStore(statusStore, KEY);
  const signIn = useSyncExternalStore(subscribe, () => current, () => current);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  /** Resolves true once signed in, false when the person canceled it. Throws nothing: a failure shows in `signIn`. */
  const start = useCallback(async (): Promise<boolean> => {
    const system = window.electronAPI?.system;
    if (!system?.signInAntigravity) return false;
    set({ state: "running", progress: { phase: "preparing" }, submitting: false });
    const stop = system.onAntigravitySignInProgress((progress) =>
      set({ state: "running", progress, submitting: false }),
    );
    try {
      statusStore.set(KEY, await system.signInAntigravity());
      set(IDLE);
      return true;
    } catch (error) {
      const message = messageOf(error);
      set(/cancel/iu.test(message) ? IDLE : { state: "failed", message });
      return false;
    } finally {
      stop();
    }
  }, []);

  const submit = useCallback(async (code: string): Promise<void> => {
    if (current.state !== "running" || current.progress.phase !== "code" || !code.trim()) return;
    const { progress } = current;
    set({ state: "running", progress, submitting: true });
    try {
      await window.electronAPI?.system?.answerAntigravitySignIn(progress.loginId, code);
    } catch (error) {
      set({ state: "running", progress, submitting: false });
      throw new Error(messageOf(error));
    }
  }, []);

  const cancel = useCallback(() => {
    set(IDLE);
    void window.electronAPI?.system?.cancelAntigravitySignIn();
  }, []);

  const signOut = useCallback(async () => {
    const next = await window.electronAPI?.system?.signOutAntigravity();
    if (next) statusStore.set(KEY, next);
  }, []);

  return { status: status ?? null, signIn, start, submit, cancel, signOut };
}

export type Antigravity = ReturnType<typeof useAntigravity>;
