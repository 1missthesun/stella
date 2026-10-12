import { parentPort, Worker, workerData } from "node:worker_threads";
import type { RendererBuildMode } from "./renderer-protocol.js";
import { createTailwindBuild, type TailwindBuild } from "./css.js";
import { createRendererSource } from "./renderer-source.js";
import { loadTailwindTools } from "./tools.js";

export type SourceWorkerData = {
  uiRoot: string;
  repoRoot: string;
  envDir: string;
  cacheDir: string;
  mode: RendererBuildMode;
};

export type SourceWorkerRequest =
  | { type: "request"; id: number; url: string }
  | { type: "apply"; id: number; paths: string[] };

export type SourceWorkerMessage =
  | { type: "response"; id: number; status: number; contentType: string; body: Uint8Array }
  | { type: "applied"; id: number; result?: Awaited<ReturnType<Awaited<ReturnType<typeof createRendererSource>>["applyChanges"]>>; error?: string }
  | { type: "log"; message: string }
  | { type: "reload" };

const port = parentPort;
if (!port) throw new Error("The renderer source worker needs a parent port.");
const data = workerData as SourceWorkerData;
const post = (message: SourceWorkerMessage) => port.postMessage(message);
const log = (message: string) => post({ type: "log", message });

let tailwindWorker: Worker | null = null;
let tailwindFailed = false;
let nextTailwindId = 0;
const tailwindPending = new Map<number, { resolve: (css: string) => void; reject: (error: Error) => void }>();
const failTailwind = (error: Error) => {
  tailwindFailed = true;
  log(`[source] Tailwind worker stopped: ${error.message}`);
  for (const request of tailwindPending.values()) request.reject(error);
  tailwindPending.clear();
};
try {
  tailwindWorker = new Worker(new URL("./tailwind-worker.js", import.meta.url), {
    workerData: { root: data.uiRoot, cacheDir: data.cacheDir },
  });
  tailwindWorker.on("message", (message: { id: number; css?: string; error?: string }) => {
    const request = tailwindPending.get(message.id);
    if (!request) return;
    tailwindPending.delete(message.id);
    if (message.error !== undefined) request.reject(new Error(message.error));
    else request.resolve(message.css ?? "");
  });
  tailwindWorker.on("error", (error) => failTailwind(error instanceof Error ? error : new Error(String(error))));
  tailwindWorker.on("exit", (code) => failTailwind(new Error(`exited with code ${code}`)));
  tailwindWorker.unref();
} catch (error) {
  tailwindFailed = true;
  log(`[source] Tailwind worker unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

const localBuilds = new Map<string, TailwindBuild>();
const compileHere = (file: string, css: string) => {
  let build = localBuilds.get(file);
  if (!build) {
    build = createTailwindBuild({ loadTools: loadTailwindTools, file, root: data.uiRoot, cacheDir: data.cacheDir });
    localBuilds.set(file, build);
  }
  return build.build(css);
};
const compileInWorker = (file: string, css: string) =>
  new Promise<string>((resolve, reject) => {
    if (tailwindFailed || !tailwindWorker) {
      reject(new Error("The Tailwind worker is not running."));
      return;
    }
    const id = (nextTailwindId += 1);
    tailwindPending.set(id, { resolve, reject });
    tailwindWorker.postMessage({ id, file, source: css });
  });

const source = createRendererSource({
  ...data,
  log,
  onReloadNeeded: () => post({ type: "reload" }),
  tailwind: (file, css) =>
    tailwindFailed ? compileHere(file, css) : compileInWorker(file, css).catch(() => compileHere(file, css)),
});
void source.then((ready) => ready.prepare()).catch((error: unknown) => {
  log(`[source] prepare failed: ${error instanceof Error ? error.message : String(error)}`);
});

port.on("message", (message: SourceWorkerRequest) => {
  if (message.type === "request") {
    void source
      .then((ready) => ready.handle(message.url))
      .then(
        (response) =>
          post({ type: "response", id: message.id, status: response.status, contentType: response.type, body: response.body }),
        (error: unknown) =>
          post({
            type: "response",
            id: message.id,
            status: 500,
            contentType: "text/plain; charset=utf-8",
            body: new TextEncoder().encode(error instanceof Error ? error.message : String(error)),
          }),
      );
  } else if (message.type === "apply") {
    void source
      .then((ready) => ready.applyChanges(message.paths))
      .then(
        (result) => post({ type: "applied", id: message.id, result }),
        (error: unknown) =>
          post({ type: "applied", id: message.id, error: error instanceof Error ? error.message : String(error) }),
      );
  }
});
