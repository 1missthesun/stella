import { agentHasCapability } from "@stella/contracts/agent-runtime";
import { wrapSystemReminder } from "@stella/contracts/system-reminders";

import { loadHomeAgentsWithMetadata } from "../agents/agents.js";
import { getConnectorDecline } from "../connectors/connect-preferences.js";
import { getNativeConnectorConnectionState } from "../connectors/connection-status.js";
import {
  getConnectorKeywordIndex,
  matchConnectorsInMessage,
} from "../connectors/keyword-index.js";
import type { NativeConnectorCatalogEntry } from "../connectors/native-integrations.js";
import { createRuntimeLogger } from "../debug.js";
import type { RuntimeStore } from "../storage/runtime-store.js";

/**
 * Stable engine capabilities exposed to home-loaded extensions.
 *
 * Extension files live outside the application bundle, so they must not reach
 * back into repo-relative kernel modules. The loader passes this object to
 * every factory instead. It deliberately exposes callable capabilities rather
 * than source paths, keeping the install layout private to the engine.
 */
export const createExtensionRuntimeApi = (options: {
  stellaDataDir: string;
  stellaAppDir: string;
  store: RuntimeStore;
}) => ({
  loadHomeAgents(metadataDir: string | URL) {
    return loadHomeAgentsWithMetadata(options.stellaDataDir, metadataDir);
  },
  agentHasCapability,
  wrapSystemReminder,
  createLogger: createRuntimeLogger,
  connectors: {
    async match(prompt: string): Promise<NativeConnectorCatalogEntry[]> {
      const index = await getConnectorKeywordIndex(options.stellaDataDir);
      return matchConnectorsInMessage(index, prompt);
    },
    getConnectionState(entry: NativeConnectorCatalogEntry) {
      return getNativeConnectorConnectionState(options.stellaDataDir, entry);
    },
    getDecline(connectorId: string) {
      return getConnectorDecline(options.stellaDataDir, connectorId);
    },
  },
});

export type ExtensionRuntimeApi = ReturnType<typeof createExtensionRuntimeApi>;
