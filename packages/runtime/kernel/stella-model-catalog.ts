import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { formatLlmRouteFailure } from "@stella/contracts/llm-route-failure";
import type { GatewayProtocol } from "@stella/contracts/gateway/api";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  STELLA_DEFAULT_MODEL,
  STELLA_MODELS_PATH,
  normalizeStellaSiteUrl,
} from "@stella/contracts/stella-api";
import { writePrivateFile } from "./shared/private-fs.js";
import type { ResolvedLlmRoute } from "./model-routing.js";
import {
  findRegistryModel,
  getEngineNativeStellaModelAlternative,
  getStellaVerbatimUpstreamModel,
} from "./model-routing-matching.js";
import {
  STELLA_PROVIDER,
  createStellaRoute,
  getManagedStellaRegistryLookup,
  resolveOfflineStellaModelId,
  type StellaSiteConfig,
} from "./model-routing-stella.js";
import {
  STELLA_GATEWAY_UNCONFIGURED_MESSAGE,
  getRememberedStellaGatewayOrigin,
  normalizeGatewayOrigin,
  rememberStellaGatewayOrigin,
} from "./gateway-session.js";

type CatalogModel = {
  id: string;
  name: string;
  provider: string;
  api?: GatewayProtocol;
  upstreamModel?: string;
};

type CatalogDefaultModel = {
  agentType: string;
  model: string;
  resolvedModel: string;
};

type CatalogApiModel = {
  id: string;
  name?: string;
  provider?: string;
  type?: string;
  api?: unknown;
  upstreamModel?: string;
};

type CatalogApiResponse = {
  data?: CatalogApiModel[];
  defaults?: CatalogDefaultModel[];
  gateway?: { origin?: unknown };
};

type StellaModelCatalog = {
  models: CatalogModel[];
  defaults: CatalogDefaultModel[];
  gateway: { origin: string };
};

type CatalogCacheEntry = StellaModelCatalog & { etag: string | null };

type ModelIdentity = Pick<Model<Api>, "api" | "provider" | "id" | "name">;

const catalogCache = new Map<string, CatalogCacheEntry>();
const inFlightCatalogRequests = new Map<
  string,
  Promise<StellaModelCatalog | null>
>();
const lastCatalogFetchAttemptAtMs = new Map<string, number>();

const parseCatalogApi = (value: unknown): GatewayProtocol | undefined => {
  switch (value) {
    case "openai-completions":
    case "openai-responses":
    case "anthropic-messages":
    case "google-generative-ai":
      return value;
    default:
      return undefined;
  }
};

const catalogRuntime = ManagedRuntime.make(Layer.empty);

const runCatalogEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await catalogRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

const tryCatalogOp = <A>(op: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: op, catch: (error) => error });

const CATALOG_FETCH_TIMEOUT_MS = 15_000;
const CATALOG_REFRESH_MIN_INTERVAL_MS = 30_000;

const publishCatalogToModelRuntime = async (
  catalog: StellaModelCatalog,
  site: StellaSiteConfig,
): Promise<void> => {
  // Every served catalog (memory, disk, network) re-asserts the gateway
  // origin so routes built outside this module can find it.
  if (site.baseUrl) {
    rememberStellaGatewayOrigin(site.baseUrl, catalog.gateway.origin);
  }
  const routes = catalog.models
    .filter((model) => model.id.startsWith(`${STELLA_PROVIDER}/`))
    .map((model) =>
      createStellaRoute({
        site,
        agentType: "orchestrator",
        modelId: model.id,
        resolvedModelId:
          model.upstreamModel ??
          resolveOfflineStellaModelId(model.id) ??
          undefined,
        ...(model.api ? { api: model.api } : {}),
        gatewayOrigin: catalog.gateway.origin,
      }),
    )
    .filter((route): route is NonNullable<typeof route> => Boolean(route));
  const { modelRuntime } = await import("./model-runtime.js");
  modelRuntime.setManagedProviderModels(
    STELLA_PROVIDER,
    routes.map((route) => ({ ...route.model, provider: STELLA_PROVIDER })),
  );
};

const diskCachePathForIdentity = (
  stellaDataDir: string,
  identityKey: string,
): string =>
  path.join(
    stellaDataDir,
    "cache",
    "model-catalog",
    `${createHash("sha256").update(identityKey).digest("hex")}.json`,
  );

const cloneCatalog = (catalog: StellaModelCatalog): StellaModelCatalog => ({
  models: catalog.models,
  defaults: catalog.defaults,
  gateway: { origin: catalog.gateway.origin },
});

const isCatalogModel = (value: unknown): value is CatalogModel => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CatalogModel>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.provider === "string" &&
    (candidate.api === undefined ||
      parseCatalogApi(candidate.api) !== undefined) &&
    (candidate.upstreamModel === undefined ||
      typeof candidate.upstreamModel === "string")
  );
};

const isCatalogDefault = (value: unknown): value is CatalogDefaultModel => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CatalogDefaultModel>;
  return (
    typeof candidate.agentType === "string" &&
    typeof candidate.model === "string" &&
    typeof candidate.resolvedModel === "string"
  );
};

const parsePersistedCatalog = (value: unknown): CatalogCacheEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    etag?: unknown;
    catalog?: {
      models?: unknown;
      defaults?: unknown;
      gateway?: { origin?: unknown };
    };
  };
  const models = candidate.catalog?.models;
  const defaults = candidate.catalog?.defaults;
  if (!Array.isArray(models) || !Array.isArray(defaults)) return null;
  if (!models.every(isCatalogModel) || !defaults.every(isCatalogDefault)) {
    return null;
  }
  const gatewayOrigin = normalizeGatewayOrigin(candidate.catalog?.gateway?.origin);
  if (!gatewayOrigin) return null;
  return {
    models,
    defaults,
    gateway: { origin: gatewayOrigin },
    etag: typeof candidate.etag === "string" ? candidate.etag : null,
  };
};

const readCatalogFromDiskEffect = (
  stellaDataDir: string | undefined,
  identityKey: string,
): Effect.Effect<CatalogCacheEntry | null> =>
  Effect.suspend(() => {
    if (!stellaDataDir?.trim()) {
      return Effect.succeed(null);
    }
    return tryCatalogOp(async () => {
      const raw = await fs.readFile(
        diskCachePathForIdentity(stellaDataDir, identityKey),
        "utf-8",
      );
      return parsePersistedCatalog(JSON.parse(raw));
    }).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
  });

const writeCatalogToDiskEffect = (
  stellaDataDir: string | undefined,
  identityKey: string,
  entry: CatalogCacheEntry,
): Effect.Effect<void, unknown> =>
  Effect.suspend(() => {
    if (!stellaDataDir?.trim()) {
      return Effect.void;
    }
    return tryCatalogOp(() =>
      writePrivateFile(
        diskCachePathForIdentity(stellaDataDir, identityKey),
        JSON.stringify({ etag: entry.etag, catalog: cloneCatalog(entry) }, null, 2),
      ),
    );
  });

const getJwtCacheIdentity = (authorization: string | undefined): string => {
  if (!authorization?.startsWith("Bearer ")) {
    return "auth:none";
  }
  const token = authorization.slice("Bearer ".length);
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const issuer = typeof payload.iss === "string" ? payload.iss : "";
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    const tokenIdentifier =
      typeof payload.tokenIdentifier === "string"
        ? payload.tokenIdentifier
        : "";
    const audience = Array.isArray(payload.aud)
      ? payload.aud.join(",")
      : typeof payload.aud === "string"
        ? payload.aud
        : "";
    const isAnonymous =
      typeof payload.isAnonymous === "boolean"
        ? String(payload.isAnonymous)
        : "";
    return [
      "auth:jwt",
      issuer,
      subject,
      tokenIdentifier,
      audience,
      isAnonymous,
    ].join(":");
  } catch {
    return `auth:jwt-unreadable:${createHash("sha256").update(token).digest("hex")}`;
  }
};

const buildCatalogRequest = (args: {
  site: StellaSiteConfig;
  deviceId?: string;
  backendUrl?: string | null;
}): {
  endpoint: string;
  headers: Record<string, string>;
  identityKey: string;
} | null => {
  const backendUrl = args.backendUrl?.trim();
  const authToken = args.site.getAuthToken()?.trim();
  if (!backendUrl || !authToken) {
    return null;
  }

  const endpoint = `${normalizeStellaSiteUrl(backendUrl)}${STELLA_MODELS_PATH}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
  };
  if (args.deviceId?.trim()) {
    headers["X-Device-ID"] = args.deviceId.trim();
  }
  const identityKey = [
    endpoint,
    getJwtCacheIdentity(headers.Authorization),
    headers["X-Device-ID"] ?? "device:none",
  ].join("|");
  return { endpoint, headers, identityKey };
};

type CatalogRequest = NonNullable<ReturnType<typeof buildCatalogRequest>>;

const fetchCatalogFromNetwork = (
  request: CatalogRequest,
  stellaDataDir: string | undefined,
  stored: CatalogCacheEntry | null,
): Promise<StellaModelCatalog | null> => {
  const existing = inFlightCatalogRequests.get(request.identityKey);
  if (existing) {
    return existing;
  }
  lastCatalogFetchAttemptAtMs.set(request.identityKey, Date.now());
  const inFlight = catalogRuntime.runPromise(
    Effect.gen(function* () {
      const res = yield* tryCatalogOp(() =>
        fetch(request.endpoint, {
          headers: stored?.etag
            ? { ...request.headers, "If-None-Match": stored.etag }
            : request.headers,
          signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
        }),
      );
      if (res.status === 304 && stored) {
        catalogCache.set(request.identityKey, stored);
        return cloneCatalog(stored) as StellaModelCatalog | null;
      }
      if (!res.ok) {
        return yield* Effect.fail(new Error(`HTTP ${res.status}`));
      }
      const data = (yield* tryCatalogOp(() => res.json())) as CatalogApiResponse;
      const gatewayOrigin = normalizeGatewayOrigin(data.gateway?.origin);
      if (!gatewayOrigin) {
        return yield* Effect.fail(new Error(STELLA_GATEWAY_UNCONFIGURED_MESSAGE));
      }
      const catalog: StellaModelCatalog = {
        models: (data.data ?? [])
          .filter((model) => !model.type || model.type === "language")
          .map((model) => {
            const api = parseCatalogApi(model.api);
            return {
              id: model.id,
              name: model.name ?? model.id,
              provider: model.provider ?? STELLA_PROVIDER,
              ...(api ? { api } : {}),
              upstreamModel: model.upstreamModel,
            };
          }),
        defaults: data.defaults ?? [],
        gateway: { origin: gatewayOrigin },
      };
      const entry: CatalogCacheEntry = {
        ...cloneCatalog(catalog),
        etag: res.headers.get("etag"),
      };
      catalogCache.set(request.identityKey, entry);
      yield* writeCatalogToDiskEffect(
        stellaDataDir,
        request.identityKey,
        entry,
      ).pipe(Effect.catch(() => Effect.void));
      return catalog as StellaModelCatalog | null;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn(
            `[stella-model-catalog] Catalog fetch failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          inFlightCatalogRequests.delete(request.identityKey);
        }),
      ),
    ),
  );
  inFlightCatalogRequests.set(request.identityKey, inFlight);
  return inFlight;
};

const fetchStellaModelCatalogEffect = (args: {
  site: StellaSiteConfig;
  deviceId?: string;
  backendUrl?: string | null;
  stellaDataDir?: string;
}): Effect.Effect<StellaModelCatalog | null, unknown> =>
  Effect.gen(function* () {
    const request = buildCatalogRequest(args);
    if (!request) {
      return null;
    }

    const cached = catalogCache.get(request.identityKey);
    if (cached) {
      yield* tryCatalogOp(() => publishCatalogToModelRuntime(cached, args.site));
      return cloneCatalog(cached);
    }

    const diskCached = yield* readCatalogFromDiskEffect(
      args.stellaDataDir,
      request.identityKey,
    );
    if (diskCached) {
      const lastAttempt =
        lastCatalogFetchAttemptAtMs.get(request.identityKey) ?? 0;
      if (
        !inFlightCatalogRequests.has(request.identityKey) &&
        Date.now() - lastAttempt >= CATALOG_REFRESH_MIN_INTERVAL_MS
      ) {
        catalogRuntime.runFork(
          tryCatalogOp(() =>
            fetchCatalogFromNetwork(request, args.stellaDataDir, diskCached),
          ).pipe(
            Effect.flatMap((catalog) =>
              catalog
                ? tryCatalogOp(() =>
                    publishCatalogToModelRuntime(catalog, args.site),
                  )
                : Effect.void,
            ),
          ),
        );
      }
      yield* tryCatalogOp(() =>
        publishCatalogToModelRuntime(diskCached, args.site),
      );
      return cloneCatalog(diskCached);
    }

    const fetched = yield* tryCatalogOp(() =>
      fetchCatalogFromNetwork(request, args.stellaDataDir, null),
    );
    if (fetched) {
      yield* tryCatalogOp(() =>
        publishCatalogToModelRuntime(fetched, args.site),
      );
    }
    return fetched;
  });

const modelIdentityFromId = (modelId: string): ModelIdentity => {
  const normalized = modelId.trim();
  const [provider, ...rest] = normalized.split("/");
  const hasProvider = Boolean(provider && rest.length > 0);
  return {
    id: normalized,
    name: hasProvider ? rest.join("/") : normalized,
    provider: hasProvider ? provider : "",
    api: hasProvider ? provider : "",
  };
};

type CatalogModelResolution = {
  resolvedModelId: string;
  api?: GatewayProtocol;
};

const resolveStellaModelAliasEffect = (args: {
  route: ResolvedLlmRoute;
  agentType: string;
  site: StellaSiteConfig;
  deviceId?: string;
  backendUrl?: string | null;
  stellaDataDir?: string;
}): Effect.Effect<CatalogModelResolution | null, unknown> =>
  Effect.gen(function* () {
    if (args.route.route !== "stella") {
      return null;
    }

    const modelId = args.route.model.id.trim();
    const passthrough = getStellaVerbatimUpstreamModel(modelId);
    if (passthrough) {
      const catalog = yield* fetchStellaModelCatalogEffect({
        site: args.site,
        deviceId: args.deviceId,
        backendUrl: args.backendUrl,
        stellaDataDir: args.stellaDataDir,
      });
      const catalogModel = catalog?.models.find(
        (model) => model.id === modelId || model.upstreamModel === passthrough,
      );
      return {
        resolvedModelId: passthrough,
        ...(catalogModel?.api ? { api: catalogModel.api } : {}),
      };
    }

    const catalog = yield* fetchStellaModelCatalogEffect({
      site: args.site,
      deviceId: args.deviceId,
      backendUrl: args.backendUrl,
      stellaDataDir: args.stellaDataDir,
    });
    if (!catalog) {
      return null;
    }

    if (modelId === STELLA_DEFAULT_MODEL) {
      const resolvedModelId = catalog.defaults.find(
        (entry) => entry.agentType === args.agentType,
      )?.resolvedModel;
      if (!resolvedModelId) return null;
      const catalogModel = catalog.models.find(
        (model) => model.upstreamModel === resolvedModelId,
      );
      return {
        resolvedModelId,
        ...(catalogModel?.api ? { api: catalogModel.api } : {}),
      };
    }

    const catalogModel = catalog.models.find((model) => model.id === modelId);
    if (!catalogModel?.upstreamModel) return null;
    return {
      resolvedModelId: catalogModel.upstreamModel,
      ...(catalogModel.api ? { api: catalogModel.api } : {}),
    };
  });

export const withStellaModelCatalogMetadata = (args: {
  route: ResolvedLlmRoute;
  agentType: string;
  site: StellaSiteConfig;
  deviceId?: string;
  backendUrl?: string | null;
  stellaDataDir?: string;
  reasoningEffort?: string;
}): Promise<ResolvedLlmRoute> =>
  runCatalogEffect(
    Effect.gen(function* () {
      if (args.route.route !== "stella") {
        return args.route;
      }

      const resolution = yield* resolveStellaModelAliasEffect(args);
      if (!resolution) {
        if (resolveOfflineStellaModelId(args.route.model.id) === null) {
          const suggestedModel = getEngineNativeStellaModelAlternative(
            args.route.model.id,
            args.reasoningEffort,
          );
          return yield* Effect.fail(
            new Error(
              formatLlmRouteFailure({
                kind: "unknown-model",
                provider: STELLA_PROVIDER,
                model: args.route.model.id,
                ...(suggestedModel ? { suggestedModel } : {}),
              }),
            ),
          );
        }
        // Offline fallback: the alias resolved locally, but the route still
        // has to relay through a known gateway. Rebuild it so a provisional
        // (pre-catalog) baseUrl never reaches a provider adapter.
        const gatewayOrigin = yield* requireGatewayOrigin(args.site);
        return (
          createStellaRoute({
            site: args.site,
            agentType: args.agentType,
            modelId: args.route.model.id,
            gatewayOrigin,
          }) ?? args.route
        );
      }

      const gatewayOrigin = yield* requireGatewayOrigin(args.site);
      const { resolvedModelId } = resolution;
      const lookup = getManagedStellaRegistryLookup(resolvedModelId);
      const registryModel =
        findRegistryModel(lookup.provider, lookup.candidates) ??
        (yield* tryCatalogOp(async () => {
          const { modelRuntime } = await import("./model-runtime.js");
          return modelRuntime
            .ensureProviderModel(lookup.provider, lookup.candidates)
            .catch(() => undefined);
        }));

      const resolvedRoute = createStellaRoute({
        site: args.site,
        agentType: args.agentType,
        modelId: args.route.model.id,
        resolvedModelId,
        registryModel,
        ...(resolution.api ? { api: resolution.api } : {}),
        gatewayOrigin,
      });

      return {
        ...(resolvedRoute ?? args.route),
        toolPolicyModel: modelIdentityFromId(resolvedModelId),
      };
    }),
  );

const requireGatewayOrigin = (
  site: StellaSiteConfig,
): Effect.Effect<string, Error> =>
  Effect.suspend(() => {
    const origin = getRememberedStellaGatewayOrigin(site.baseUrl);
    return origin
      ? Effect.succeed(origin)
      : Effect.fail(new Error(STELLA_GATEWAY_UNCONFIGURED_MESSAGE));
  });
