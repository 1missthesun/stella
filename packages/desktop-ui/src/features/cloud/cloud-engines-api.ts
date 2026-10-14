import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type {
  EngineProvider,
  EngineSettings,
} from "@stella/contracts/backend/engines";
import type { ProviderSettings } from "@stella/contracts/backend/providers";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";

export const useCloudEngines = (enabled: boolean): EngineSettings | undefined =>
  useBackendValue("engines.get", enabled ? {} : "skip");

export const useAccountProviders = (
  enabled: boolean,
): ProviderSettings | undefined =>
  useBackendValue("providers.get", enabled ? {} : "skip");

export const cloudEnginesApi = {
  disconnect: (provider: EngineProvider, accountId?: string, options?: { forget?: boolean }) =>
    backendClient.call("engines.disconnect", {
      provider,
      ...(accountId ? { accountId } : {}),
      ...(options?.forget ? { forget: true } : {}),
    }),
  setActiveAccount: (provider: EngineProvider, accountId: string, deviceId?: string) =>
    backendClient.call("engines.setActiveAccount", {
      provider,
      accountId,
      ...(deviceId ? { deviceId } : {}),
    }),
  startClaudeCloudLogin: (email?: string) =>
    backendClient.call("engines.startClaudeCloudLogin", email ? { email } : {}),
  finishClaudeCloudLogin: (loginId: string, code: string) =>
    backendClient.call("engines.finishClaudeCloudLogin", { loginId, code }),
  cancelClaudeCloudLogin: (loginId: string) =>
    backendClient.call("engines.cancelClaudeCloudLogin", { loginId }),
  chooseClaudeAccount: (accountId: string | null) =>
    backendClient.call("engines.chooseClaudeAccount", accountId ? { accountId } : {}),
  startClaudeDeviceLogin: (deviceId: string, email?: string) =>
    backendClient.call("engines.startClaudeDeviceLogin", {
      deviceId,
      ...(email ? { email } : {}),
    }),
  finishClaudeDeviceLogin: (deviceId: string, loginId: string, code: string) =>
    backendClient.call("engines.finishClaudeDeviceLogin", { deviceId, loginId, code }),
  cancelClaudeDeviceLogin: (deviceId: string, loginId: string) =>
    backendClient.call("engines.cancelClaudeDeviceLogin", { deviceId, loginId }),
  signOutClaudeCloud: (accountId: string) =>
    backendClient.call("engines.signOutClaudeCloud", { accountId }),
  setExecution: (execution: CloudExecutionSelection) =>
    backendClient.call("engines.setExecution", { execution }),
};
