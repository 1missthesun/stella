import { readFileSync } from "node:fs";
import { resolveRuntimeSourceAsset } from "../shared/runtime-paths.js";

export type OAuthCatalogTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  exactSlug?: boolean;
};

export type OAuthCatalogProvider = {
  id: string;
  name: string;
  category: string;
  auth: readonly ["OAUTH2"];
  catalogToolCount: number;
  description: string;
  sourceUrl: string;
  tools: readonly OAuthCatalogTool[];
};

export type OAuthCatalogProviderSummary = Omit<OAuthCatalogProvider, "tools">;

const CATALOG_JSON_BASENAME = "oauth-provider-catalog.json";
export const OAUTH_PROVIDER_CATALOG_INDEX_BASENAME =
  "oauth-provider-catalog.index.json";

export const toOAuthProviderCatalogIndex = (
  catalog: readonly OAuthCatalogProvider[],
): OAuthCatalogProviderSummary[] =>
  catalog.map(({ tools: _tools, ...summary }) => summary);

export const serializeOAuthProviderCatalogIndex = (
  index: readonly OAuthCatalogProviderSummary[],
): string => `${JSON.stringify(index, null, 2)}\n`;

const readCatalogAsset = <T>(basename: string): T => {
  const assetPath = resolveRuntimeSourceAsset("kernel", "connectors", basename);
  try {
    return JSON.parse(readFileSync(assetPath, "utf-8")) as T;
  } catch (error) {
    throw new Error(
      `Failed to load ${basename} (tried: ${assetPath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

let cachedCatalog: readonly OAuthCatalogProvider[] | null = null;
let cachedSummaries: readonly OAuthCatalogProviderSummary[] | null = null;
const cachedToolsById = new Map<string, readonly OAuthCatalogTool[]>();

export const getOAuthProviderSummaries =
  (): readonly OAuthCatalogProviderSummary[] => {
    if (cachedSummaries) {
      return cachedSummaries;
    }
    cachedSummaries = readCatalogAsset<OAuthCatalogProviderSummary[]>(
      OAUTH_PROVIDER_CATALOG_INDEX_BASENAME,
    );
    return cachedSummaries;
  };

export const getOAuthCatalogProviderTools = (
  id: string,
): readonly OAuthCatalogTool[] | undefined => {
  const cached = cachedToolsById.get(id);
  if (cached) return cached;
  if (!getOAuthProviderSummaries().some((entry) => entry.id === id)) {
    return undefined;
  }
  const catalog =
    cachedCatalog ??
    readCatalogAsset<OAuthCatalogProvider[]>(CATALOG_JSON_BASENAME);
  const tools = catalog.find((entry) => entry.id === id)?.tools;
  if (tools) cachedToolsById.set(id, tools);
  return tools;
};
