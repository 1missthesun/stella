import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  ViewArgs,
  ViewName,
  ViewResult,
} from "@stella/contracts/backend/api";
import {
  stableStringify,
  type BackendRequestError,
} from "@stella/contracts/backend/client";
import {
  backendClient,
  readBackendAccountEpoch,
  subscribeBackendAccount,
} from "./backend-client";
import { useViewFixture, VIEW_FIXTURE_LOADING } from "./view-fixtures";

export type BackendViewState<T> =
  | { status: "loading"; value: T | undefined; error: undefined }
  | { status: "ready"; value: T; error: undefined }
  | { status: "error"; value: T | undefined; error: BackendRequestError };

const LOADING = { status: "loading", value: undefined, error: undefined } as const;

export const useBackendAccountEpoch = (): number =>
  useSyncExternalStore(subscribeBackendAccount, readBackendAccountEpoch);

export function useBackendView<K extends ViewName>(
  view: K,
  args: ViewArgs<K> | "skip",
  options: { keepPreviousValue?: boolean } = {},
): BackendViewState<ViewResult<K>> {
  const epoch = useBackendAccountEpoch();
  const argsJson = args === "skip" ? null : stableStringify(args);
  const stableArgs = useMemo(
    (): ViewArgs<K> | "skip" =>
      argsJson === null ? "skip" : (JSON.parse(argsJson) as ViewArgs<K>),
    [argsJson],
  );
  const [state, setState] = useState<BackendViewState<ViewResult<K>>>(LOADING);
  const subscribedEpoch = useRef(epoch);
  const keepPreviousValue = options.keepPreviousValue === true;

  useEffect(() => {
    const sameAccount = subscribedEpoch.current === epoch;
    subscribedEpoch.current = epoch;
    setState((previous) =>
      keepPreviousValue && sameAccount && stableArgs !== "skip"
        ? { status: "loading", value: previous.value, error: undefined }
        : LOADING,
    );
    if (stableArgs === "skip") return;
    return backendClient.watch(
      view,
      stableArgs,
      (value) => setState({ status: "ready", value, error: undefined }),
      (error) =>
        setState((previous) => ({
          status: "error",
          value: previous.value,
          error,
        })),
    );
  }, [view, stableArgs, epoch, keepPreviousValue]);

  const fixture = useViewFixture(view);
  if (fixture !== undefined && stableArgs !== "skip") {
    return fixture === VIEW_FIXTURE_LOADING
      ? LOADING
      : { status: "ready", value: fixture as ViewResult<K>, error: undefined };
  }
  return state;
}

export function useBackendValue<K extends ViewName>(
  view: K,
  args: ViewArgs<K> | "skip",
): ViewResult<K> | undefined {
  return useBackendView(view, args).value;
}
