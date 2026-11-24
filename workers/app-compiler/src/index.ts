import { WorkerEntrypoint } from "cloudflare:workers";
import { createApp } from "@cloudflare/worker-bundler";
import esbuildWasm from "../node_modules/@cloudflare/worker-bundler/dist/esbuild.wasm";
import * as esbuild from "esbuild-wasm/lib/browser.js";
import type {
  AppCompilerRpc,
  CompiledWorkspaceApp,
  CompileWorkspaceAppResult,
} from "../../shared/workspace-app-compiler.js";

const DEFAULT_SERVER = `import { DurableObject } from 'cloudflare:workers'; export class App extends DurableObject { fetch() { return new Response('Not found', {status:404}); } }`;
const COMPILE_TIMEOUT_MS = 60_000;

/** The compiler gave out, not the app: the caller may try the same files again. */
class CompilerUnavailable extends Error {
  override name = "CompilerUnavailable";
}

// esbuild is one Go program per isolate, and this isolate is shared by every
// owner. Source that overflows its stack leaves that program wedged (the next
// owner's build never answers), and its memory never shrinks. So each build
// starts a fresh one and the last build out drops it; overlapping builds share.
// esbuild-wasm is pinned to worker-bundler's own copy, so `createApp` uses the
// program started here.
let service: Promise<void> | null = null;
let builds = 0;

const startService = (): Promise<void> => {
  service ??= esbuild.initialize({ wasmModule: esbuildWasm, worker: false });
  return service;
};

const dropService = (): void => {
  service = null;
  void esbuild.stop();
};

const SERVICE_GONE = /The service (was stopped|is no longer running)|"initialize"/;

const createAppFiles = async (
  files: Record<string, string>,
): Promise<CompiledWorkspaceApp> => {
  const assets: Record<string, string> = {};
  const source: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith("public/")) assets["/" + path.slice(7)] = text;
    else if (path.startsWith("src/") || path === "package.json")
      source[path] = text;
  }
  if (!assets["/index.html"]) throw new Error("Missing public/index.html.");
  source["src/server.ts"] ??= DEFAULT_SERVER;
  const built = await createApp({
    files: source,
    server: "src/server.ts",
    ...(source["src/client.tsx"] ? { client: "src/client.tsx" } : {}),
    assets,
    jsx: "automatic",
    assetConfig: { not_found_handling: "none" },
  });
  return {
    mainModule: built.mainModule,
    modules: built.modules,
    assets: Object.fromEntries(
      Object.entries(built.assets).map(([path, body]) => {
        const contentType = built.assetManifest.get(path)?.contentType;
        return [path, { body, ...(contentType ? { contentType } : {}) }];
      }),
    ),
  };
};

const compile = async (
  files: Record<string, string>,
): Promise<CompileWorkspaceAppResult> => {
  builds += 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await startService();
    const app = await Promise.race([
      createAppFiles(files),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CompilerUnavailable("The app took too long to build.")),
          COMPILE_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true, app };
  } catch (error) {
    const message = error instanceof Error ? error.message : "App build failed.";
    const buildError = error instanceof Error && "errors" in error;
    if (!buildError) dropService();
    if (error instanceof CompilerUnavailable || SERVICE_GONE.test(message)) {
      console.error(JSON.stringify({ event: "app_compile_unavailable", message: message.slice(0, 300) }));
      throw new CompilerUnavailable(message.slice(0, 300));
    }
    return { ok: false, error: message.slice(0, 2000) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    builds -= 1;
    if (builds === 0) dropService();
  }
};

/** Reached only over cloud-builder's APP_COMPILER Service Binding. */
export class AppCompiler
  extends WorkerEntrypoint<Cloudflare.Env>
  implements AppCompilerRpc
{
  async compileWorkspaceApp(
    files: Record<string, string>,
  ): Promise<CompileWorkspaceAppResult> {
    return await compile(files);
  }
}

export default {
  fetch(): Response {
    return new Response("Not found.", { status: 404 });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
