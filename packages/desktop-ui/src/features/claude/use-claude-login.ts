import { useCallback, useEffect, useRef, useState } from "react";
import { cloudEnginesApi } from "@/features/cloud/cloud-engines-api";
import { openExternalUrl } from "@/platform/electron/open-external";

export type ClaudeLoginTarget =
  | { place: "local"; configId?: string; email?: string }
  | { place: "cloud"; email?: string }
  | { place: "device"; deviceId: string; deviceName?: string; email?: string };

export type ClaudeLoginFlow = {
  target: ClaudeLoginTarget;
  loginId: string;
  authorizeUrl: string;
  pasting: boolean;
};

export type ClaudeLoginResult = { email?: string };

const messageOf = (error: unknown): string | null =>
  error instanceof Error && error.message
    ?
      error.message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/u, "")
    : null;

const cancelLogin = (flow: ClaudeLoginFlow) => {
  if (flow.target.place === "local") {
    void window.electronAPI?.system?.cancelClaudeLocalLogin?.(flow.loginId).catch(() => undefined);
  } else if (flow.target.place === "device") {
    void cloudEnginesApi
      .cancelClaudeDeviceLogin(flow.target.deviceId, flow.loginId)
      .catch(() => undefined);
  } else {
    void cloudEnginesApi.cancelClaudeCloudLogin(flow.loginId).catch(() => undefined);
  }
};

export function useClaudeLogin({
  onSignedIn,
}: {
  onSignedIn?: (result: ClaudeLoginResult, target: ClaudeLoginTarget) => void;
} = {}) {
  const [flow, setFlow] = useState<ClaudeLoginFlow | null>(null);
  const [starting, setStarting] = useState<ClaudeLoginTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<ClaudeLoginTarget | null>(null);
  const flowRef = useRef<ClaudeLoginFlow | null>(null);
  flowRef.current = flow;
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const awaitLocal = useCallback(async (started: ClaudeLoginFlow) => {
    const wait = window.electronAPI?.system?.waitClaudeLocalLogin;
    if (!wait) return;
    const current = () => flowRef.current?.loginId === started.loginId;
    try {
      const config = await wait(started.loginId);
      if (!current()) return;
      flowRef.current = null;
      setFlow(null);
      onSignedInRef.current?.(config.email ? { email: config.email } : {}, started.target);
    } catch (caught) {
      if (!current()) return;
      setError(messageOf(caught));
      flowRef.current = null;
      setFlow(null);
      setFailed(started.target);
    }
  }, []);

  const start = useCallback(async (target: ClaudeLoginTarget) => {
    const current = flowRef.current;
    if (current) cancelLogin(current);
    flowRef.current = null;
    setFlow(null);
    setError(null);
    setFailed(null);
    setStarting(target);
    try {
      let next: ClaudeLoginFlow;
      if (target.place === "local") {
        const run = window.electronAPI?.system?.startClaudeLocalLogin;
        if (!run) throw new Error();
        const started = await run({
          ...(target.configId ? { configId: target.configId } : {}),
          ...(target.email ? { email: target.email } : {}),
        });
        next = { target, ...started, pasting: false };
      } else if (target.place === "device") {
        const started = await cloudEnginesApi.startClaudeDeviceLogin(target.deviceId, target.email);
        next = { target, ...started, pasting: true };
        openExternalUrl(started.authorizeUrl);
      } else {
        const started = await cloudEnginesApi.startClaudeCloudLogin(target.email);
        next = { target, ...started, pasting: true };
        openExternalUrl(started.authorizeUrl);
      }
      flowRef.current = next;
      setFlow(next);
      if (next.target.place === "local") void awaitLocal(next);
    } catch (caught) {
      setError(messageOf(caught));
      setFailed(target);
    } finally {
      setStarting(null);
    }
  }, [awaitLocal]);

  const submit = useCallback(async (code: string) => {
    const current = flowRef.current;
    const trimmed = code.trim();
    if (!current || !trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      let result: ClaudeLoginResult;
      if (current.target.place === "local") {
        const finish = window.electronAPI?.system?.finishClaudeLocalLogin;
        if (!finish) throw new Error();
        const config = await finish(current.loginId, trimmed);
        result = config.email ? { email: config.email } : {};
      } else if (current.target.place === "device") {
        result = await cloudEnginesApi.finishClaudeDeviceLogin(
          current.target.deviceId,
          current.loginId,
          trimmed,
        );
      } else {
        const done = await cloudEnginesApi.finishClaudeCloudLogin(current.loginId, trimmed);
        result = { email: done.email };
      }
      if (flowRef.current !== current) return;
      flowRef.current = null;
      setFlow(null);
      onSignedInRef.current?.(result, current.target);
    } catch (caught) {
      if (flowRef.current !== current) return;
      cancelLogin(current);
      setError(messageOf(caught));
      flowRef.current = null;
      setFlow(null);
      setFailed(current.target);
    } finally {
      setSubmitting(false);
    }
  }, []);

  const cancel = useCallback(() => {
    const current = flowRef.current;
    if (current) cancelLogin(current);
    flowRef.current = null;
    setFlow(null);
    setError(null);
    setFailed(null);
  }, []);

  const restart = useCallback(() => {
    if (failed) void start(failed);
  }, [failed, start]);

  const reopen = useCallback(() => {
    const current = flowRef.current;
    if (!current) return;
    openExternalUrl(current.authorizeUrl);
    if (!current.pasting) {
      const next = { ...current, pasting: true };
      flowRef.current = next;
      setFlow(next);
    }
  }, []);

  useEffect(
    () => () => {
      const current = flowRef.current;
      if (current) cancelLogin(current);
    },
    [],
  );

  return {
    flow,
    starting,
    submitting,
    error,
    failed,
    open: flow !== null || starting !== null || failed !== null,
    start,
    submit,
    cancel,
    restart,
    reopen,
  };
}

export type ClaudeLogin = ReturnType<typeof useClaudeLogin>;
