import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { app, protocol, session, utilityProcess, webContents } from "electron";
import { RENDERER_ORIGIN, RENDERER_SCHEME, SOURCE_DATA_ARG } from "./origin.js";
import { MEDIA_SCHEME_PRIVILEGES, serveMediaProtocol } from "./media-protocol.js";
import { CANVAS_SCHEME_PRIVILEGES, serveCanvasProtocol } from "./canvas-protocol.js";
import type { RanImports } from "./renderer-source.js";
import type { SourceWorkerData, SourceWorkerMessage, SourceWorkerRequest } from "./source-worker.js";

/** Must run before `ready`: the scheme behaves like https (ESM, fetch, CSP 'self'). */
export const registerRendererScheme = () => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
    MEDIA_SCHEME_PRIVILEGES,
    CANVAS_SCHEME_PRIVILEGES,
  ]);
};

export const isRendererSourceUrl = (url: string) => url.startsWith(`${RENDERER_ORIGIN}/`);

const earlyPublicFile = (uiRoot: string, url: URL) => {
  const name = url.pathname.slice(1);
  if (url.search || !/^[\w.-]+\.js$/.test(name)) return null;
  const file = path.join(uiRoot, "public", name);
  return fs.existsSync(file) ? file : null;
};

export type RendererBuildMode = "development" | "production";

export const STELLA_RENDERER_MODE_ENV = "STELLA_RENDERER_MODE";

export const resolveRendererBuildMode = (options: {
  isInstalledProduct: boolean;
  env?: NodeJS.ProcessEnv;
}): RendererBuildMode => {
  const requested = (options.env ?? process.env)[STELLA_RENDERER_MODE_ENV]
    ?.trim()
    .toLowerCase();
  if (requested === "development" || requested === "production") return requested;
  return options.isInstalledProduct ? "production" : "development";
};

/**
 * How a change reached the windows. `swap`: the full window took it in place.
 * `reload`: the windows loaded again and came back. `failed`: the new code
 * does not load or does not render; the window is showing what it showed
 * before (after a failed reload, whatever the files now hold once reloaded).
 */
export type RendererApplyOutcome =
  | { mode: "none" | "hot" }
  | { mode: "swap"; swaps: number }
  | { mode: "reload"; reason?: string }
  | { mode: "failed"; error: string; reloaded: boolean };

export type RendererSourceHandle = {
  /** `reload`: load the windows again whatever the change allows. */
  applyChanges(paths: string[], options?: { reload?: boolean }): Promise<RendererApplyOutcome>;
  /** Milliseconds since the user last touched the full window; null when there is none to ask. */
  quietFor(): Promise<number | null>;
  dispose(): void;
};

const SWAP_PAGE = "index.html";
const SWAP_PAGE_PATHS = new Set(["/", "/index.html"]);
const pageName = (url: string) => {
  const pathname = new URL(url).pathname;
  return SWAP_PAGE_PATHS.has(pathname) ? SWAP_PAGE : pathname.slice(1);
};

const RELOAD_HEALTH_TIMEOUT_MS = 15_000;
const RELOAD_EMPTY_TIMEOUT_MS = 3_000;
const HEALTH_SCRIPT = `(() => {
  if (document.querySelector(".error-boundary")) return "crashed";
  if (document.readyState !== "complete") return "loading";
  if (document.getElementById("stella-mini-boot")) return "empty";
  const splash = document.getElementById("stella-launch");
  return !splash || splash.dataset.exiting === "true" ? "ok" : "loading";
})()`;
const ANSI_STYLE = /\u001b\[[0-9;]*m/g;

/** Whether a window that loaded again shows the app rather than a crash or a page that never starts. */
const cameBack = async (contents: Electron.WebContents): Promise<string | null> => {
  const deadline = Date.now() + RELOAD_HEALTH_TIMEOUT_MS;
  let emptySince: number | null = null;
  while (Date.now() < deadline) {
    if (contents.isDestroyed()) return null;
    const state = contents.isLoading()
      ? "loading"
      : await (contents.executeJavaScript(HEALTH_SCRIPT) as Promise<string>).catch(() => "loading");
    if (state === "ok") return null;
    if (state === "crashed") return "The new version stopped with an error when it started.";
    if (state === "empty") {
      emptySince ??= Date.now();
      if (Date.now() - emptySince >= RELOAD_EMPTY_TIMEOUT_MS) break;
    } else {
      emptySince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return "The new version did not start.";
};

type Answer = { status: number; contentType: string; body: Uint8Array };
type ApplyAnswer = Extract<SourceWorkerMessage, { type: "applied" }>["result"];

type SourceChannel = {
  post: (message: SourceWorkerRequest) => void;
  terminate: () => void;
};

const SOURCE_WORKER_URL = new URL("./source-worker.js", import.meta.url);

/**
 * A thread in this process, or a process of its own. The native tools
 * (rolldown's allocator above all) keep what a thread allocated after it
 * exits, so a source server that comes and goes runs as a process.
 */
const openSourceChannel = (
  workerData: SourceWorkerData,
  isolate: "thread" | "process",
  handlers: {
    message: (message: SourceWorkerMessage) => void;
    error: (error: unknown) => void;
    exit: (code: number) => void;
  },
): SourceChannel => {
  if (isolate === "thread") {
    const worker = new Worker(SOURCE_WORKER_URL, { workerData });
    worker.on("message", handlers.message);
    worker.on("error", handlers.error);
    worker.on("exit", handlers.exit);
    return {
      post: (message) => worker.postMessage(message),
      terminate: () => void worker.terminate(),
    };
  }
  const child = utilityProcess.fork(fileURLToPath(SOURCE_WORKER_URL), [`${SOURCE_DATA_ARG}${JSON.stringify(workerData)}`], {
    serviceName: "Stella source server",
    stdio: "ignore",
    allowLoadingUnsignedLibraries: process.platform === "darwin",
    // rolldown keeps a heap per pool thread (one per core by default) and
    // returns freed pages lazily: a cold dependency bundle then holds about
    // twice the memory for no gain in speed.
    env: { ...process.env, ROLLDOWN_WORKER_THREADS: "4", RAYON_NUM_THREADS: "4", MIMALLOC_PURGE_DELAY: "0" },
  });
  child.on("message", handlers.message);
  child.on("error", (type, location) => handlers.error(new Error(`${type} at ${location}`)));
  child.on("exit", handlers.exit);
  return {
    post: (message) => child.postMessage(message),
    terminate: () => void child.kill(),
  };
};

const startSourceWorker = (options: {
  workerData: SourceWorkerData;
  isolate: "thread" | "process";
  log: (message: string) => void;
  onReloadNeeded: () => void;
}) => {
  let worker: SourceChannel | null = null;
  let isolate = options.isolate;
  let heard = false;
  let disposed = false;
  let restarts = 0;
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>();
  const start = () => {
    const current: SourceChannel = openSourceChannel(options.workerData, isolate, {
      message: (message) => {
        heard = true;
        if (message.type === "log") {
          options.log(message.message);
        } else if (message.type === "reload") {
          options.onReloadNeeded();
        } else {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          if (message.type === "applied" && message.error !== undefined) request.reject(new Error(message.error));
          else request.resolve(message as never);
        }
      },
      error: (error) => {
        options.log(`[source] worker failed: ${error instanceof Error ? error.message : String(error)}`);
      },
      exit: (code) => {
        if (worker !== current) return;
        worker = null;
        for (const request of pending.values()) request.reject(new Error(`The source worker exited (${code}).`));
        pending.clear();
        if (!disposed && restarts < 3) {
          restarts += 1;
          if (isolate === "process" && !heard) {
            options.log(`[source] the source process could not start (${code}); serving from a thread`);
            isolate = "thread";
          }
          start();
        }
      },
    });
    worker = current;
  };
  start();
  const call = <T>(message: SourceWorkerRequest extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (!worker) {
        reject(new Error("The source worker is not running."));
        return;
      }
      nextId += 1;
      pending.set(nextId, { resolve: resolve as (value: never) => void, reject });
      worker.post({ ...message, id: nextId } as SourceWorkerRequest);
    });
  return {
    request: (url: string) => call<Answer>({ type: "request", url }),
    apply: (paths: string[], ran: RanImports | null) =>
      call<{ result?: ApplyAnswer }>({ type: "apply", paths, ran }).then(
        (answer) => answer.result ?? { mode: "none" as const },
      ),
    dispose: () => {
      disposed = true;
      worker?.terminate();
    },
  };
};

const NO_CACHE = { "cache-control": "no-cache" };

export const serveRendererSource = (options: {
  partition: string;
  sourceRoot: string;
  envRoot?: string;
  mode: RendererBuildMode;
  isolate?: "thread" | "process";
  log: (message: string) => void;
  firstPage?: (html: string) => string;
}): RendererSourceHandle => {
  const partitionSession = session.fromPartition(options.partition);
  serveMediaProtocol(options.partition, { readerOrigin: RENDERER_ORIGIN });
  serveCanvasProtocol(options.partition);
  const pages = () =>
    webContents
      .getAllWebContents()
      .filter(
        (contents) =>
          !contents.isDestroyed() &&
          contents.session === partitionSession &&
          isRendererSourceUrl(contents.getURL()),
      );
  const reloadPages = () => {
    for (const contents of pages()) contents.reload();
  };
  const fullPage = () => pages().find((contents) => pageName(contents.getURL()) === SWAP_PAGE) ?? null;
  const uiRoot = path.join(options.sourceRoot, "packages", "desktop-ui");
  const source = startSourceWorker({
    workerData: {
      uiRoot,
      repoRoot: options.sourceRoot,
      envDir: path.join(options.envRoot ?? options.sourceRoot, "packages", "desktop-ui"),
      cacheDir: path.join(app.getPath("userData"), "Renderer Source Cache"),
      mode: options.mode,
    },
    isolate: options.isolate ?? "thread",
    log: options.log,
    onReloadNeeded: reloadPages,
  });
  let firstPage = options.firstPage ?? null;
  const html = (body: string): Answer => ({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: Buffer.from(body),
  });

  const answer = async (requestUrl: string): Promise<Answer> => {
    const url = new URL(requestUrl);
    const early = options.mode === "production" ? earlyPublicFile(uiRoot, url) : null;
    if (early) {
      const body = await fs.promises.readFile(early).catch(() => null);
      if (body) return { status: 200, contentType: "text/javascript; charset=utf-8", body };
    }
    if (
      firstPage &&
      (url.pathname === "/" || url.pathname === "/index.html") &&
      url.searchParams.get("window") === "full"
    ) {
      const rewrite = firstPage;
      firstPage = null;
      if (options.mode === "production") {
        const page = await fs.promises.readFile(path.join(uiRoot, "index.html"), "utf8").catch(() => null);
        if (page !== null) return html(rewrite(page));
      }
      const response = await source.request(requestUrl);
      if (response.status !== 200) return response;
      return html(rewrite(Buffer.from(response.body).toString("utf8")));
    }
    return source.request(requestUrl);
  };
  const failure = (error: unknown): Answer => ({
    status: 500,
    contentType: "text/plain; charset=utf-8",
    body: Buffer.from(error instanceof Error ? error.message : String(error)),
  });

  const sessionProtocol = partitionSession.protocol;
  const buffered = typeof sessionProtocol.registerBufferProtocol === "function";
  if (buffered) {
    sessionProtocol.registerBufferProtocol(RENDERER_SCHEME, (request, callback) => {
      void answer(request.url)
        .catch(failure)
        .then((response) => {
          const [mimeType, ...parameters] = response.contentType.split(";");
          const charset = parameters.map((part) => part.trim()).find((part) => part.startsWith("charset="));
          const body = response.body;
          callback({
            statusCode: response.status,
            mimeType: mimeType!.trim(),
            ...(charset ? { charset: charset.slice("charset=".length) } : {}),
            headers: NO_CACHE,
            data: Buffer.isBuffer(body) ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength),
          });
        });
    });
  } else {
    sessionProtocol.handle(RENDERER_SCHEME, async (request) => {
      const response = await answer(request.url).catch(failure);
      return new Response(response.body as Uint8Array<ArrayBuffer>, {
        status: response.status,
        headers: { "content-type": response.contentType, ...NO_CACHE },
      });
    });
  }
  return {
    quietFor: async () => {
      const full = fullPage();
      if (!full) return null;
      return (full.executeJavaScript("globalThis.__stellaSwap?.quietFor() ?? null") as Promise<number | null>).catch(
        () => null,
      );
    },
    applyChanges: async (paths, { reload = false } = {}) => {
      const full = fullPage();
      const ran = full
        ? await (full.executeJavaScript("globalThis.__stellaSwap?.ran() ?? null") as Promise<RanImports | null>).catch(
            () => null,
          )
        : null;
      const result = await source.apply(paths, ran);
      if (result.mode === "failed" && !reload) {
        return { mode: "failed", error: result.error.replace(ANSI_STYLE, ""), reloaded: false };
      }
      if (result.mode === "reload" || reload) {
        reloadPages();
        const problem = full ? await cameBack(full) : null;
        return problem
          ? { mode: "failed", error: problem, reloaded: true }
          : { mode: "reload", reason: result.mode === "reload" ? result.reason : "asked" };
      }
      if (result.mode === "swap") {
        for (const contents of pages()) {
          if (result.reloadPages.includes(pageName(contents.getURL()))) contents.reload();
        }
        if (!full || full.isDestroyed()) return { mode: "swap", swaps: 0 };
        const outcome = await (
          full.executeJavaScript(`globalThis.__stellaSwap.apply(${JSON.stringify(result.payload)})`) as Promise<{
            ok: boolean;
            error?: string;
            swaps?: number;
          }>
        ).catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          swaps: 0,
        }));
        if (outcome.ok) return { mode: "swap", swaps: outcome.swaps ?? 0 };
        options.log(`[source] swap failed: ${outcome.error ?? "unknown"}`);
        return { mode: "failed", error: outcome.error ?? "The change did not load.", reloaded: false };
      }
      if (result.mode === "hot") {
        const script = `globalThis.__stellaHot?.update(${JSON.stringify(result.payload)})`;
        await Promise.all(
          pages().map((contents) =>
            contents.executeJavaScript(script).catch((error: unknown) => {
              options.log(`[source] hot update failed: ${error instanceof Error ? error.message : String(error)}`);
              if (!contents.isDestroyed()) contents.reload();
            }),
          ),
        );
      }
      return { mode: result.mode === "hot" ? "hot" : "none" };
    },
    dispose: () => {
      if (buffered) sessionProtocol.unregisterProtocol(RENDERER_SCHEME);
      else sessionProtocol.unhandle(RENDERER_SCHEME);
      source.dispose();
    },
  };
};
