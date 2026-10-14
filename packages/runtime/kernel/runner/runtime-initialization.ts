import { mkdirSync, watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Scope,
} from "effect";
import {
  loadBundledAgents,
  mergeBundledAndExtensionAgents,
} from "../agents/agents.js";
import { loadExtensions } from "../extensions/loader.js";
import {
  configureRemotePrompts,
  scheduleRemotePromptRevalidation,
} from "../prompts/remote-prompts.js";
import type { ExtensionServices } from "../extensions/services.js";
import { createExtensionRuntimeApi } from "../extensions/runtime-api.js";
import { modelRuntime } from "../model-runtime.js";
import { createRuntimeLogger } from "../debug.js";
import type { RunnerContext } from "./types.js";
import { recordBootStep } from "../../observability/boot-timing.js";

const logger = createRuntimeLogger("runtime-init");

const timedBootStep =
  (name: string) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      const startedAt = performance.now();
      return effect.pipe(
        Effect.ensuring(
          Effect.sync(() =>
            recordBootStep(name, performance.now() - startedAt),
          ),
        ),
      );
    });

const initRuntime = ManagedRuntime.make(Layer.empty);
const initTimersScope = Scope.makeUnsafe();

const forkAfter = (ms: number, fn: () => void): Fiber.Fiber<void> =>
  initRuntime.runSync(
    Effect.forkIn(
      Effect.andThen(Effect.sleep(ms), Effect.sync(fn)),
      initTimersScope,
      { startImmediately: true },
    ),
  );

type ExtensionReloadResult = {
  status: "reloaded" | "busy" | "not-initialized" | "load-failed";
  reason?: string;
};

type LoadedExtensions = Awaited<ReturnType<typeof loadExtensions>>;

export type RuntimeInitializationLifecycleOverrides = {
  loadExtensions?: (args: {
    signal: AbortSignal;
    extensionsPath: string;
    services: ExtensionServices;
  }) => Promise<LoadedExtensions>;
  initializeModels?: (args: {
    signal: AbortSignal;
    stellaDataDir: string;
  }) => Promise<void>;
  refreshModels?: (args: {
    signal: AbortSignal;
    stellaDataDir: string;
  }) => Promise<void>;
  installLoadedExtensions?: (extensions: LoadedExtensions) => void;
  startWatchers?: () => void;
  stopWatchers?: () => void;
};

/**
 * Interruptible Promise seam whose finalizer joins the actual Promise.
 *
 * `Effect.tryPromise` supplies the lifecycle AbortSignal. Its interruption is
 * intentionally not enough on its own: an extension factory can ignore the
 * signal, and closing SQLite while that promise still holds extension services
 * would recreate the startup-after-shutdown race. The ensuring finalizer keeps
 * scope close parked until the underlying promise really settles.
 */
const interruptAndJoinPromise = <A>(
  operation: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, unknown> =>
  Effect.suspend(() => {
    let settlement: Promise<A> | null = null;
    return Effect.tryPromise({
      try: (signal) => {
        signal.throwIfAborted();
        settlement = operation(signal);
        return settlement;
      },
      catch: (error) => error,
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() =>
          settlement
            ? Effect.promise(() =>
                settlement!.then(
                  () => undefined,
                  () => undefined,
                ),
              )
            : Effect.void,
        ),
      ),
    );
  });

export type ExtensionWatchScope = "resource-tree" | "data-dir";

/**
 * The non-recursive data-directory watcher exists only to observe the atomic
 * replacement of the `system` mirror. SQLite databases and their WAL/SHM
 * files live beside it, so treating every sibling write as an extension edit
 * creates a permanent reload loop while agents are active.
 */
export const isExtensionWatchChangeRelevant = (
  scope: ExtensionWatchScope,
  filename: string | Buffer | null,
): boolean => {
  if (scope === "data-dir") {
    return filename !== null && path.basename(String(filename)) === "system";
  }
  if (filename === null) return true;
  const basename = path.basename(String(filename));
  return !basename.startsWith(".") && !basename.endsWith("~");
};

export const createExtensionReloadScheduler = (
  reload: (options: { logBusy: boolean }) => Promise<ExtensionReloadResult>,
  options: { debounceMs?: number; busyRetryMs?: number } = {},
) => {
  const debounceMs = options.debounceMs ?? 500;
  const busyRetryMs = options.busyRetryMs ?? 2_000;
  let timer: Fiber.Fiber<void> | null = null;
  let generation = 0;
  let pending = false;
  let inFlight = false;
  let busyLogged = false;

  const queueAttempt = (delayMs: number) => {
    timer?.interruptUnsafe();
    timer = forkAfter(delayMs, () => {
      timer = null;
      void attemptReload();
    });
  };

  const attemptReload = async (): Promise<void> => {
    if (!pending || inFlight) return;
    inFlight = true;
    const attemptedGeneration = generation;
    let result: ExtensionReloadResult | undefined;
    let failed = false;
    let failure: unknown;
    try {
      result = await reload({ logBusy: !busyLogged });
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      inFlight = false;
    }
    if (!pending) return;

    if (failed) {
      logger.warn("extensions.reload.unexpected-failure", {
        error: failure instanceof Error ? failure.message : String(failure),
      });
      if (generation !== attemptedGeneration) {
        queueAttempt(debounceMs);
      } else {
        pending = false;
        busyLogged = false;
      }
      return;
    }

    if (result?.status === "busy") {
      busyLogged = true;
      queueAttempt(
        generation === attemptedGeneration ? busyRetryMs : debounceMs,
      );
      return;
    }
    if (generation !== attemptedGeneration) {
      queueAttempt(debounceMs);
      return;
    }
    pending = false;
    busyLogged = false;
  };

  return {
    schedule: () => {
      generation += 1;
      if (!pending) {
        pending = true;
        busyLogged = false;
      }
      queueAttempt(debounceMs);
    },
    cancel: () => {
      generation += 1;
      pending = false;
      busyLogged = false;
      timer?.interruptUnsafe();
      timer = null;
    },
  };
};

export const createRuntimeInitialization = (
  context: RunnerContext,
  deps: {
    disposeBackendClient: () => void;
    shutdownTasks: () => void | Promise<void>;
    lifecycle?: RuntimeInitializationLifecycleOverrides;
  },
) => {
  const lifecycle = deps.lifecycle;
  let initializationScope: Scope.Closeable | null = null;
  let initializationGeneration = 0;
  let runtimeStopPromise: Promise<void> | null = null;

  /**
   * Keep extension registry swaps synchronous so the orchestrator queue never
   * observes a partially installed extension set.
   */
  const installLoadedExtensions = (extensions: LoadedExtensions): void => {
    context.state.loadedAgents = mergeBundledAndExtensionAgents(
      extensions.agents,
    );
    for (const hook of extensions.hooks) {
      // Force `source: "extension"` even if the disk-loaded hook
      // declared something else. Bundled hooks register through
      // `registerBundledHooks` (a separate code path that runs at
      // worker startup), so anything coming out of `loadExtensions`
      // is by definition user-installable. Without this clamp, a
      // hook that exported `{ source: "bundled", ... }` would survive
      // every subsequent `clearBySource("extension")` sweep and
      // accumulate duplicate registrations on each F1 reload.
      context.hookEmitter.register({
        ...hook,
        source: "extension",
      });
    }
    context.toolHost.registerExtensionTools(extensions.tools);
    modelRuntime.setExtensionProviders(extensions.providers);
    for (const providerDef of extensions.providers) {
      logger.info(`extensions.provider.registered.${providerDef.name}`, {
        modelCount: providerDef.models.length,
      });
    }
    logger.info("extensions.ready", {
      tools: extensions.tools.length,
      hooks: extensions.hooks.length,
      providers: extensions.providers.length,
      prompts: extensions.prompts.length,
    });
    configureRemotePrompts({
      stellaDataDir: context.stellaDataDir,
      getBackendUrl: () => context.state.backendUrl ?? null,
    });
    scheduleRemotePromptRevalidation();
  };

  const extensionRuntimeApi = createExtensionRuntimeApi({
    stellaDataDir: context.stellaDataDir,
    stellaAppDir: context.stellaAppDir,
    store: context.runtimeStore,
  });
  const buildExtensionServices = (): ExtensionServices => ({
    stellaDataDir: context.stellaDataDir,
    stellaAppDir: context.stellaAppDir,
    store: context.runtimeStore,
    runtime: extensionRuntimeApi,
  });

  const initializeRuntime = () => {
    if (context.state.initializationPromise) {
      return context.state.initializationPromise;
    }
    const generation = ++initializationGeneration;
    const scope = Scope.makeUnsafe();
    initializationScope = scope;
    const isCurrentGeneration = (): boolean =>
      context.state.isRunning &&
      initializationGeneration === generation &&
      initializationScope === scope;

    const extensionsLoad = interruptAndJoinPromise((signal) =>
      lifecycle?.loadExtensions
        ? lifecycle.loadExtensions({
            signal,
            extensionsPath: context.paths.extensionsPath,
            services: buildExtensionServices(),
          })
        : loadExtensions(
            context.paths.extensionsPath,
            buildExtensionServices(),
          ),
    ).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.sync(() => {
            if (!isCurrentGeneration()) return;
            context.state.loadedAgents = loadBundledAgents();
            console.error(
              "[stella:extensions] Failed to load extensions:",
              error instanceof Error ? error.message : String(error),
            );
          }),
        onSuccess: (extensions) =>
          Effect.sync(() => {
            if (!isCurrentGeneration()) return;
            (lifecycle?.installLoadedExtensions ?? installLoadedExtensions)(
              extensions,
            );
          }),
      }),
      timedBootStep("runnerExtensions"),
    );
    const modelsLoad = interruptAndJoinPromise((signal) =>
      lifecycle?.initializeModels
        ? lifecycle.initializeModels({
            signal,
            stellaDataDir: context.stellaDataDir,
          })
        : modelRuntime.initialize({
            stellaDataDir: context.stellaDataDir,
            allowNetwork: false,
          }),
    ).pipe(timedBootStep("runnerModelsJson"));

    const startup = Effect.all([extensionsLoad, modelsLoad], {
      concurrency: "unbounded",
    }).pipe(
      Effect.flatMap(() =>
        Effect.sync(() => {
          if (!isCurrentGeneration()) return false;
          context.state.isInitialized = true;
          if (lifecycle?.startWatchers) {
            lifecycle.startWatchers();
          } else {
            startExtensionWatcher();
            startModelConfigWatcher();
          }
          return true;
        }),
      ),
      Effect.flatMap((initialized) => {
        if (!initialized) return Effect.void;
        const refresh = interruptAndJoinPromise((signal) =>
          lifecycle?.refreshModels
            ? lifecycle.refreshModels({
                signal,
                stellaDataDir: context.stellaDataDir,
              })
            : modelRuntime.refresh({ allowNetwork: true, signal }),
        ).pipe(
          timedBootStep("catalogRefresh"),
          Effect.tap(() =>
            Effect.sync(() => {
              if (!isCurrentGeneration()) return;
              logger.info("model-runtime.catalog.ready", {
                modelCount: modelRuntime.getModelCount(),
              });
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              if (!isCurrentGeneration()) return;
              logger.warn("model-runtime.catalog.load-failed", {
                error: error instanceof Error ? error.message : String(error),
              });
            }),
          ),
        );
        return Effect.asVoid(
          Effect.forkIn(refresh, scope, { startImmediately: true }),
        );
      }),
    );
    const fiber = initRuntime.runSync(
      Effect.forkIn(startup, scope, { startImmediately: true }),
    );
    const completion = initRuntime
      .runPromise(Fiber.await(fiber))
      .then((exit) => {
        if (Exit.isSuccess(exit)) return;
        if (Cause.hasInterrupts(exit.cause) && !isCurrentGeneration()) return;
        throw Cause.squash(exit.cause);
      });
    context.state.initializationPromise = completion;
    context.state.initializationStarted.open();
    void completion.catch((error) => {
      if (!isCurrentGeneration()) return;
      logger.warn("runtime-initialization.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return completion;
  };

  const reloadUserExtensions = async (
    options: { logBusy?: boolean } = {},
  ): Promise<ExtensionReloadResult> => {
    if (!context.state.isInitialized) {
      return { status: "not-initialized" };
    }
    logger.info("extensions.reload.start");
    // Load-then-swap to keep the reload atomic w.r.t. the orchestrator
    // queue. If we swept first and awaited the disk load between sweep
    // and install, a user message landing during the await would
    // dequeue against an empty extension registry: missing tools,
    // missing extension-provided model providers, mid-flight provider
    // resolution failing over to fallbacks. Doing the disk read FIRST
    // (the only async step) means the OLD registry stays intact during
    // I/O; only the synchronous sweep+install block below mutates live
    // state, and the orchestrator queue can't slip a turn into the
    // middle of a synchronous block.
    let extensions: Awaited<ReturnType<typeof loadExtensions>>;
    try {
      extensions = await loadExtensions(
        context.paths.extensionsPath,
        buildExtensionServices(),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn("extensions.reload.load-failed", { error: reason });
      return { status: "load-failed", reason };
    }
    // Synchronous swap: clear old + install new in one block. No
    // awaits between these statements.
    context.hookEmitter.clearBySource("extension");
    context.toolHost.unregisterExtensionTools();
    installLoadedExtensions(extensions);
    await modelRuntime.reloadConfig();
    logger.info("extensions.reload.done");
    return { status: "reloaded" };
  };

  let resourceWatchers: FSWatcher[] = [];
  let modelConfigWatcher: FSWatcher | null = null;
  let modelConfigDebounce: Fiber.Fiber<void> | null = null;
  const FILE_WATCH_DEBOUNCE_MS = 500;
  const RELOAD_BUSY_RETRY_MS = 2_000;
  const extensionReloadScheduler = createExtensionReloadScheduler(
    ({ logBusy }) => reloadUserExtensions({ logBusy }),
    {
      debounceMs: FILE_WATCH_DEBOUNCE_MS,
      busyRetryMs: RELOAD_BUSY_RETRY_MS,
    },
  );

  const startExtensionWatcher = () => {
    if (resourceWatchers.length > 0) return;
    const agentsPath = path.join(context.stellaDataDir, "agents");
    try {
      mkdirSync(agentsPath, { recursive: true });
    } catch (error) {
      logger.warn("extensions.watch.prepare-failed", {
        error: error instanceof Error ? error.message : String(error),
        path: agentsPath,
      });
    }
    const watchPaths = [
      {
        path: context.paths.extensionsPath,
        recursive: true,
        scope: "resource-tree" as const,
      },
      {
        path: agentsPath,
        recursive: true,
        scope: "resource-tree" as const,
      },
      // The system mirror is replaced by an atomic directory swap, which a
      // recursive watcher on the old inode would miss — watch the data dir
      // itself (non-recursive) so the `system` entry rename triggers a reload.
      {
        path: context.stellaDataDir,
        recursive: false,
        scope: "data-dir" as const,
      },
    ];
    for (const { path: watchPath, recursive, scope } of watchPaths) {
      try {
        const watcher = fsWatch(
          watchPath,
          { recursive },
          (_eventType, filename) => {
            if (!isExtensionWatchChangeRelevant(scope, filename)) return;
            extensionReloadScheduler.schedule();
          },
        );
        watcher.on("error", (error) => {
          logger.warn("extensions.watch.error", {
            error: error instanceof Error ? error.message : String(error),
            path: watchPath,
          });
        });
        resourceWatchers.push(watcher);
        logger.info("extensions.watch.started", { path: watchPath });
      } catch (error) {
        logger.warn("extensions.watch.start-failed", {
          error: error instanceof Error ? error.message : String(error),
          path: watchPath,
        });
      }
    }
  };

  const scheduleModelConfigReload = () => {
    modelConfigDebounce?.interruptUnsafe();
    modelConfigDebounce = forkAfter(FILE_WATCH_DEBOUNCE_MS, () => {
      modelConfigDebounce = null;
      void modelRuntime
        .reloadConfig()
        .then(() => {
          const configError = modelRuntime.getSnapshot().configError;
          if (configError) {
            logger.warn("model-runtime.config.invalid", { error: configError });
          } else {
            logger.info("model-runtime.config.reloaded");
          }
        })
        .catch((error) => {
          logger.warn("model-runtime.config.reload-failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  };

  const startModelConfigWatcher = () => {
    if (modelConfigWatcher) return;
    try {
      modelConfigWatcher = fsWatch(
        context.stellaDataDir,
        { recursive: false },
        (_eventType, filename) => {
          if (filename && path.basename(String(filename)) === "models.json") {
            scheduleModelConfigReload();
          }
        },
      );
      modelConfigWatcher.on("error", (error) => {
        logger.warn("model-runtime.config.watch.error", {
          error: error instanceof Error ? error.message : String(error),
          path: context.stellaDataDir,
        });
      });
      logger.info("model-runtime.config.watch.started", {
        path: path.join(context.stellaDataDir, "models.json"),
      });
    } catch (error) {
      logger.warn("model-runtime.config.watch.start-failed", {
        error: error instanceof Error ? error.message : String(error),
        path: context.stellaDataDir,
      });
    }
  };

  const stopExtensionWatcher = () => {
    extensionReloadScheduler.cancel();
    modelConfigDebounce?.interruptUnsafe();
    modelConfigDebounce = null;
    try {
      modelConfigWatcher?.close();
    } catch {
      // Best-effort.
    }
    modelConfigWatcher = null;
    for (const watcher of resourceWatchers) {
      try {
        watcher.close();
      } catch {
        // Best-effort.
      }
    }
    resourceWatchers = [];
    lifecycle?.stopWatchers?.();
  };

  const start = () => {
    if (context.state.isRunning || runtimeStopPromise) return;
    context.state.isRunning = true;
    context.state.isInitialized = false;
    void initializeRuntime();
  };

  /**
   * Interrupt and join the complete startup scope before any dependency that
   * extension factories or model initialization can observe is disposed.
   * Closing the scope also aborts/joins the post-ready catalog refresh.
   */
  const stopInitialization = async (): Promise<void> => {
    initializationGeneration += 1;
    const scope = initializationScope;
    initializationScope = null;
    const completion = context.state.initializationPromise;
    context.state.initializationPromise = null;
    if (scope) {
      await initRuntime.runPromise(
        Scope.close(scope, Exit.failCause(Cause.interrupt())),
      );
    }
    await completion?.catch(() => undefined);
  };

  const stopRuntime = async (): Promise<void> => {
    logger.warn("runner.stop", {});
    stopExtensionWatcher();
    context.state.isRunning = false;
    context.state.isInitialized = false;
    context.state.initializationStarted.reset();
    // This join is deliberately before the backend client, tool-host, and ultimately
    // session-storage teardown. Even a user extension factory that ignores its
    // abort signal must settle before its captured services can be closed.
    await stopInitialization();
    deps.disposeBackendClient();
    context.cloudTranscript.stop();
    context.state.backgroundExitWake?.dispose();
    const tasksShutdown = Promise.resolve(deps.shutdownTasks()).catch(
      (error) => {
        logger.warn("runner.stop.task-shutdown-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    await context.toolHost.shutdown();
    await tasksShutdown;
  };

  const stop = (): Promise<void> => {
    if (runtimeStopPromise) return runtimeStopPromise;
    runtimeStopPromise = stopRuntime();
    return runtimeStopPromise;
  };

  return {
    initializeRuntime,
    reloadUserExtensions,
    start,
    stop,
  };
};
