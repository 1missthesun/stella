
export type CatalogApi = string;
export type Api = CatalogApi;

export type CatalogModel<TApi extends CatalogApi = CatalogApi> = {
  id: string;
  name: string;
  api: TApi;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<
    Record<
      "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
      string | null
    >
  >;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: unknown;
};

export type Model<TApi extends Api = Api> = CatalogModel<TApi>;

export type RuntimeModelCatalogModel = {
  id: string;
  name: string;
  provider: string;
  api?: string;
  baseUrl?: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
};

/** flags: bit 0 = reasoning, bit 1 = image input. */
export type RuntimeModelCatalogRow = readonly [
  id: string,
  name: string | 0,
  contextWindow: number,
  maxTokens: number,
  flags: number,
];

export type RuntimeModelCatalogSnapshot = {
  revision: number;
  models?: RuntimeModelCatalogModel[];
  modelsByProvider?: Record<string, RuntimeModelCatalogRow[]>;
  runtimeManagedProviders: Array<{
    id: string;
    authManaged: boolean;
    credentialless: boolean;
  }>;
  refreshedAt: number | null;
  configError?: string;
  catalogError?: string;
};

export const expandRuntimeModelCatalogModels = (
  snapshot: RuntimeModelCatalogSnapshot | null | undefined,
): RuntimeModelCatalogModel[] => {
  if (!snapshot) return [];
  if (Array.isArray(snapshot.models)) {
    return snapshot.models;
  }
  if (!snapshot.modelsByProvider) return [];
  const expanded: RuntimeModelCatalogModel[] = [];
  for (const [provider, rows] of Object.entries(snapshot.modelsByProvider)) {
    for (const [id, name, contextWindow, maxTokens, flags] of rows) {
      expanded.push({
        id,
        name: name === 0 ? id : name,
        provider,
        reasoning: (flags & 1) !== 0,
        input: (flags & 2) !== 0 ? ["text", "image"] : ["text"],
        contextWindow,
        maxTokens,
      });
    }
  }
  return expanded;
};
