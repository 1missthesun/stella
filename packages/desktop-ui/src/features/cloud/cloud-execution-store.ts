import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";

export const CLOUD_EXECUTION_CHANGED_EVENT = "stella:cloud-execution-changed";

let localSelection: CloudExecutionSelection | null = null;
let authorityAccountScope: string | null = null;
const listeners = new Set<() => void>();

const sameExecution = (
  left: CloudExecutionSelection,
  right: CloudExecutionSelection,
): boolean =>
  left.engine === right.engine &&
  left.provider === right.provider &&
  left.model === right.model &&
  left.reasoningEffort === right.reasoningEffort;

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const publishCloudExecutionSelection = (
  execution: CloudExecutionSelection,
): void => {
  localSelection = execution;
  emit();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<CloudExecutionSelection>(CLOUD_EXECUTION_CHANGED_EVENT, {
        detail: execution,
      }),
    );
  }
};

export const reconcileCloudExecutionSelection = (
  serverSelection: CloudExecutionSelection | undefined,
): void => {
  if (
    localSelection &&
    serverSelection &&
    sameExecution(localSelection, serverSelection)
  ) {
    localSelection = null;
    emit();
  }
};

export const getCloudExecutionSelectionSnapshot =
  (): CloudExecutionSelection | null => localSelection;

export const subscribeCloudExecutionSelection = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const retireCloudExecutionClientAuthority = (
  accountScope: string,
): void => {
  if (authorityAccountScope === accountScope) return;
  authorityAccountScope = accountScope;
  if (localSelection === null) return;
  localSelection = null;
  emit();
};

