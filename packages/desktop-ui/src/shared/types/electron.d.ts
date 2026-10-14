import type { ElectronAPI } from "@stella/contracts/desktop/electron-api";

export type {
  ChatContext,
  ChatContextFile,
  ChatContextUpdate,
  LocalLlmCredentialSummary,
  VoiceRuntimeSnapshot,
} from "@stella/contracts";
export type { BrowserViewState } from "@stella/contracts/desktop/browser-view";
export type {
  LocalLlmOAuthProviderSummary,
  LockedComputerUseStatus,
  NativeIntegration as ElectronNativeIntegration,
} from "@stella/contracts/desktop/ipc-contract";

export type ElectronApi = ElectronAPI;

export type ElectronBrowserViewApi = ElectronApi["browserView"];
export type ElectronLocalChatApi = ElectronApi["localChat"];

declare global {
  interface Window {
    electronAPI?: ElectronApi;
    __stellaUiState?: Record<string, string>;
  }
}

export {};
