import path from "node:path";
import { readPrivateJsonValueSync, writePrivateFile } from "../shared/private-fs.js";

import type { ApiConnectorConfig, ConnectorCommandConfig } from "./types.js";

const readJson = async <T = unknown>(filePath: string): Promise<T | null> => {
  try {
    return (readPrivateJsonValueSync(filePath) as T | undefined) ?? null;
  } catch {
    return null;
  }
};

export const getConnectorStateRoot = (stellaAppDir: string) =>
  path.join(stellaAppDir, "connectors");

export const getConfiguredCommandsPath = (stellaAppDir: string) =>
  path.join(getConnectorStateRoot(stellaAppDir), "commands.json");

export const getConfiguredApiConnectorsPath = (stellaAppDir: string) =>
  path.join(getConnectorStateRoot(stellaAppDir), "api-connectors.json");

export const listConfiguredConnectorCommands = async (
  stellaAppDir: string,
): Promise<ConnectorCommandConfig[]> => {
  const configured = await readJson<{ commands?: ConnectorCommandConfig[] }>(
    getConfiguredCommandsPath(stellaAppDir),
  );
  return Array.isArray(configured?.commands) ? configured.commands : [];
};

export const saveConfiguredConnectorCommands = async (
  stellaAppDir: string,
  commands: ConnectorCommandConfig[],
) => {
  const filePath = getConfiguredCommandsPath(stellaAppDir);
  await writePrivateFile(filePath, `${JSON.stringify({ commands }, null, 2)}\n`);
};

export const listConfiguredApiConnectors = async (
  stellaAppDir: string,
): Promise<ApiConnectorConfig[]> => {
  const configured = await readJson<{ apis?: ApiConnectorConfig[] }>(
    getConfiguredApiConnectorsPath(stellaAppDir),
  );
  return Array.isArray(configured?.apis) ? configured.apis : [];
};

export const saveConfiguredApiConnectors = async (
  stellaAppDir: string,
  apis: ApiConnectorConfig[],
) => {
  const filePath = getConfiguredApiConnectorsPath(stellaAppDir);
  await writePrivateFile(filePath, `${JSON.stringify({ apis }, null, 2)}\n`);
};

export const removeConfiguredConnector = async (
  stellaAppDir: string,
  id: string,
): Promise<{ removedCommands: ConnectorCommandConfig[]; removedApis: ApiConnectorConfig[] }> => {
  const [commands, apis] = await Promise.all([
    listConfiguredConnectorCommands(stellaAppDir),
    listConfiguredApiConnectors(stellaAppDir),
  ]);
  const removedCommands = commands.filter((command) => command.id === id);
  const removedApis = apis.filter((api) => api.id === id);
  if (removedCommands.length === 0 && removedApis.length === 0) {
    return { removedCommands, removedApis };
  }
  await Promise.all([
    removedCommands.length > 0
      ? saveConfiguredConnectorCommands(
          stellaAppDir,
          commands.filter((command) => command.id !== id),
        )
      : Promise.resolve(),
    removedApis.length > 0
      ? saveConfiguredApiConnectors(
          stellaAppDir,
          apis.filter((api) => api.id !== id),
        )
      : Promise.resolve(),
  ]);
  return { removedCommands, removedApis };
};
