import type { ElectronAPI } from "@stella/contracts/desktop/electron-api";
import type { Theme } from "@stella/theme";

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

/**
 * Main reads installed theme files from disk and only checks that their
 * `id`, `name`, `light` and `dark` fields are present; the renderer registers
 * them as `Theme`s.
 */
export type ElectronApi = Omit<ElectronAPI, "theme"> & {
  theme: { listInstalled: () => Promise<Theme[]> };
};

export type ElectronBrowserViewApi = ElectronApi["browserView"];
export type ElectronLocalChatApi = ElectronApi["localChat"];

declare global {
  interface Window {
    electronAPI?: ElectronApi;
    __stellaUiState?: Record<string, string>;
  }
}

export {};
