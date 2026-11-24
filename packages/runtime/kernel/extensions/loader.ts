import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import * as Effect from "effect/Effect";
import type {
  ToolDefinition,
  HookDefinition,
  ProviderDefinition,
  PromptTemplate,
  LoadedExtensions,
  ExtensionFactory,
  ExtensionRegistrationApi,
} from "./types.js";
import type { ExtensionServices } from "./services.js";
import { extractFrontmatter } from "../frontmatter.js";
import { runExtensionEffect, tryExtensionOp } from "./effect-runtime.js";

const log = (...args: unknown[]) =>
  console.error("[stella:extensions]", ...args);
const logError = (...args: unknown[]) =>
  console.error("[stella:extensions]", ...args);

/**
 * Node's ESM loader caches modules by their full specifier and exposes no API
 * to evict one, so a query that changes per load (mtime plus a per-load token)
 * makes an edited file import fresh, leaking the old module record. Bun keys
 * its module registry by path and ignores the query, so there the file's
 * registry entry is evicted instead.
 */
const cacheBusterEffect = (
  filePath: string,
  loadToken: string,
): Effect.Effect<string> =>
  Effect.sync(() => {
    if (typeof Bun !== "undefined") delete require.cache[path.resolve(filePath)];
  }).pipe(
    Effect.andThen(tryExtensionOp(() => fs.stat(filePath))),
    Effect.map((stat) => stat.mtimeMs),
    Effect.catch(() => Effect.succeed(0)),
    Effect.map((mtime) => `?v=${mtime}-${loadToken}`),
  );

const readDirOrEmpty = (dir: string): Effect.Effect<string[]> =>
  tryExtensionOp(() => fs.readdir(dir)).pipe(
    Effect.catch(() => Effect.succeed([] as string[])),
  );

const importModules = <T>(
  dir: string,
  suffix: string,
  loadToken: string,
): Effect.Effect<T[]> =>
  Effect.gen(function* () {
    const results: T[] = [];
    const entries = yield* readDirOrEmpty(dir);

    for (const entry of entries) {
      if (!entry.endsWith(suffix)) continue;
      const filePath = path.join(dir, entry);
      yield* Effect.gen(function* () {
        const resolvedPath = path.resolve(filePath);
        const fileUrl =
          pathToFileURL(resolvedPath).href +
          (yield* cacheBusterEffect(filePath, loadToken));
        const mod = yield* tryExtensionOp(
          () => import(/* @vite-ignore */ fileUrl),
        );
        const definition = mod.default ?? mod;
        if (definition && typeof definition === "object") {
          results.push(definition as T);
          log(`Loaded ${suffix}: ${entry}`);
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logError(`Failed to load ${filePath}:`, (error as Error).message);
          }),
        ),
      );
    }

    return results;
  });

const loadExtensionFactories = (
  baseDir: string,
  loadToken: string,
  services: ExtensionServices,
): Effect.Effect<LoadedExtensions> =>
  Effect.gen(function* () {
    const collected: LoadedExtensions = {
      tools: [],
      hooks: [],
      providers: [],
      prompts: [],
      agents: [],
    };

    const entries = yield* readDirOrEmpty(baseDir);

    for (const entry of entries) {
      if (entry.startsWith(".")) {
        continue;
      }
      const extensionDir = path.join(baseDir, entry);
      const stat = yield* tryExtensionOp(() => fs.stat(extensionDir)).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      if (!stat?.isDirectory()) {
        continue;
      }

      const entryCandidates = ["index.js", "index.ts"].map((fileName) =>
        path.join(extensionDir, fileName),
      );
      let filePath: string | undefined;
      for (const candidate of entryCandidates) {
        const accessible = yield* tryExtensionOp(() =>
          fs.access(candidate),
        ).pipe(
          Effect.map(() => true),
          Effect.catch(() => Effect.succeed(false)),
        );
        if (accessible) {
          filePath = candidate;
          break;
        }
      }
      if (!filePath) {
        continue;
      }

      const entryFilePath = filePath;
      yield* Effect.gen(function* () {
        const resolvedPath = path.resolve(entryFilePath);
        const fileUrl =
          pathToFileURL(resolvedPath).href +
          (yield* cacheBusterEffect(entryFilePath, loadToken));
        const mod = yield* tryExtensionOp(
          () => import(/* @vite-ignore */ fileUrl),
        );
        const factory = (mod.default ?? mod) as ExtensionFactory;
        if (typeof factory !== "function") {
          return;
        }

        const api: ExtensionRegistrationApi = {
          on(event, handler, filter) {
            collected.hooks.push({
              event,
              filter,
              handler,
            });
          },
          registerTool(tool) {
            collected.tools.push(tool);
          },
          registerProvider(provider) {
            collected.providers.push(provider);
          },
          registerPrompt(prompt) {
            collected.prompts.push(prompt);
          },
          registerAgent(agent) {
            collected.agents.push(agent);
          },
        };

        yield* tryExtensionOp(async () => factory(api, services));
        log(`Loaded extension: ${entry}`);
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logError(
              `Failed to load extension ${entryFilePath}:`,
              (error as Error).message,
            );
          }),
        ),
      );
    }

    return collected;
  });

const loadPrompts = (dir: string): Effect.Effect<PromptTemplate[]> =>
  Effect.gen(function* () {
    const results: PromptTemplate[] = [];
    const entries = yield* readDirOrEmpty(dir);

    for (const entry of entries) {
      if (!entry.endsWith(".prompt.md")) continue;
      const filePath = path.join(dir, entry);
      yield* tryExtensionOp(async () => {
        const raw = await fs.readFile(filePath, "utf-8");
        const { metadata, body } = extractFrontmatter(raw);
        const baseName = entry.replace(/\.prompt\.md$/, "");
        results.push({
          name: typeof metadata.name === "string" ? metadata.name : baseName,
          description:
            typeof metadata.description === "string"
              ? metadata.description
              : "",
          template: body.trim() || raw,
          filePath,
        });
        log(`Loaded prompt: ${entry}`);
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logError(
              `Failed to load prompt ${filePath}:`,
              (error as Error).message,
            );
          }),
        ),
      );
    }

    return results;
  });

let loadExtensionsCallCount = 0;
const LOADER_RELOAD_WARN_THRESHOLD = 50;

export function loadExtensions(
  baseDir: string,
  services: ExtensionServices,
): Promise<LoadedExtensions> {
  return runExtensionEffect(
    Effect.gen(function* () {
      loadExtensionsCallCount += 1;
      if (loadExtensionsCallCount === LOADER_RELOAD_WARN_THRESHOLD) {
        log(
          `Extensions have been (re)loaded ${loadExtensionsCallCount} times this session. ` +
            "Each reload leaks the previous version's module records into the Node ESM loader cache. " +
            "If you're seeing memory pressure, restart Stella to clear the cache.",
        );
      }
      log(`Loading extensions from ${baseDir}`);

      const loadToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const [tools, hooks, providers, prompts, registered] = yield* Effect.all(
        [
          importModules<ToolDefinition>(
            path.join(baseDir, "tools"),
            ".tool.ts",
            loadToken,
          ),
          importModules<HookDefinition>(
            path.join(baseDir, "hooks"),
            ".hook.ts",
            loadToken,
          ),
          importModules<ProviderDefinition>(
            path.join(baseDir, "providers"),
            ".provider.ts",
            loadToken,
          ),
          loadPrompts(path.join(baseDir, "prompts")),
          loadExtensionFactories(baseDir, loadToken, services),
        ],
        { concurrency: "unbounded" },
      );

      const loaded: LoadedExtensions = {
        tools: [...tools, ...registered.tools],
        hooks: [...hooks, ...registered.hooks],
        providers: [...providers, ...registered.providers],
        prompts: [...prompts, ...registered.prompts],
        agents: [...registered.agents],
      };

      log(
        `Loaded ${loaded.tools.length} tools, ${loaded.hooks.length} hooks, ${loaded.providers.length} providers, ${loaded.prompts.length} prompts, ${loaded.agents.length} agents`,
      );

      return loaded;
    }),
  );
}
