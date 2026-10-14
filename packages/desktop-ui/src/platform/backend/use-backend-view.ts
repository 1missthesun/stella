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
  const key = args === "skip" ? null : `${view}\u0000${stableStringify(args)}`;
  // `args` is captured by key, so an inline object literal doesn't resubscribe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableArgs = useMemo(() => args, [key]);
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

  return state;
}

export function useBackendValue<K extends ViewName>(
  view: K,
  args: ViewArgs<K> | "skip",
): ViewResult<K> | undefined {
  return useBackendView(view, args).value;
}
