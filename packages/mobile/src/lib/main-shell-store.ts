import { useSyncExternalStore, type ReactNode } from "react";
import type { AutomaticExecutionTarget } from "./execution-placement";
import type { StoredPhoneAccess } from "./phone-access";
import type { ModelSettings } from "./use-cloud-model-settings";
import type { ChatArtifact, MobileTask } from "../types";

export type ActivityHubData = {
  tasks: MobileTask[];
  artifacts: ChatArtifact[];
  access: StoredPhoneAccess | null;
  conversationId?: string | null;
  revision?: string | null;
};

export type ComputerControl = {
  access: StoredPhoneAccess | null;
  pairedDesktops: StoredPhoneAccess[];
  platformLabel: string;
  statusLabel: string;
  statusAvailable: boolean | null;
  connecting: boolean;
  onRepaired: (access: StoredPhoneAccess) => void;
  executionTarget: AutomaticExecutionTarget;
  onExecutionTargetChange: (target: AutomaticExecutionTarget) => void;
  model: {
    label: string;
    settings: ModelSettings;
  } | null;
  composerModelPinned: boolean;
  onComposerModelPinnedChange: (next: boolean) => void;
};

export type BackOverride = {
  label: string;
  onPress: () => void;
};

type ShellState = {
  activity: ActivityHubData | null;
  computer: ComputerControl | null;
  back: BackOverride | null;
  accessory: ReactNode;
};

const EMPTY_STATE: ShellState = {
  activity: null,
  computer: null,
  back: null,
  accessory: null,
};

let state: ShellState = EMPTY_STATE;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function publishActivityHub(next: ActivityHubData | null): void {
  if (state.activity === next) return;
  state = { ...state, activity: next };
  emit();
}

export function publishComputerControl(next: ComputerControl | null): void {
  if (state.computer === next) return;
  state = { ...state, computer: next };
  emit();
}

export function publishBackOverride(next: BackOverride | null): void {
  if (state.back === next) return;
  state = { ...state, back: next };
  emit();
}

export function publishTopBarAccessory(next: ReactNode): void {
  if (state.accessory === next) return;
  state = { ...state, accessory: next };
  emit();
}

const readAccessory = () => state.accessory;
export function useTopBarAccessory(): ReactNode {
  return useSyncExternalStore(subscribe, readAccessory, readAccessory);
}

const readBack = () => state.back;
export function useBackOverride(): BackOverride | null {
  return useSyncExternalStore(subscribe, readBack, readBack);
}

const readActivity = () => state.activity;
const readComputer = () => state.computer;

export function useActivityHub(): ActivityHubData | null {
  return useSyncExternalStore(subscribe, readActivity, readActivity);
}

export function useComputerControl(): ComputerControl | null {
  return useSyncExternalStore(subscribe, readComputer, readComputer);
}

const openRequestListeners = new Set<() => void>();

export function requestOpenSidebar(): void {
  for (const listener of openRequestListeners) listener();
}

export function subscribeSidebarOpenRequests(listener: () => void): () => void {
  openRequestListeners.add(listener);
  return () => {
    openRequestListeners.delete(listener);
  };
}
