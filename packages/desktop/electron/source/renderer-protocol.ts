import fs from "node:fs";
import path from "node:path";
import { app, protocol, session, webContents } from "electron";
import { RENDERER_ORIGIN, RENDERER_SCHEME } from "./origin.js";
import { MEDIA_SCHEME_PRIVILEGES, serveMediaProtocol } from "./media-protocol.js";
import { CANVAS_SCHEME_PRIVILEGES, serveCanvasProtocol } from "./canvas-protocol.js";
import type { RendererSource } from "./renderer-source.js";

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

/** A top-level script in desktop-ui's public/ that `url` asks for, as is. */
const earlyPublicFile = (uiRoot: string, url: URL) => {
  const name = url.pathname.slice(1);
  if (url.search || !/^[\w.-]+\.js$/.test(name)) return null;
  const file = path.join(uiRoot, "public", name);
  return fs.existsSync(file) ? file : null;
};

/**
 * How the renderer is built from source.
 *
 * `development` is the authoring mode: React's development transform, Fast
 * Refresh registrations, the hot client, unminified dependencies, and
 * `import.meta.env.DEV === true`. `production` is what the user's Stella
 * serves: React's production transform and `import.meta.env.DEV === false`,
 * with changes applied by reloading rather than hot-swapping.
 *
 * This is a build mode, not a claim about who is running the app — the app
 * always runs from source. Which mode an install serves is decided from
 * `app-identity`, in one place.
 */
export type RendererBuildMode = "development" | "production";

/** `development` | `production`; overrides the mode an install would pick. */
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

export type RendererSourceHandle = {
  ready: Promise<RendererSource>;
  /**
   * Swap in files that changed in this source root (repo-relative posix
   * paths). Hot-updates every renderer webContents on this partition
   * (windows and WebContentsViews), falling back to reloading them. "none"
   * when no path is a renderer input (desktop-ui files, or files of other
   * packages, such as packages/contracts, that the served graph includes).
   */
  applyChanges(paths: string[]): Promise<{ mode: "none" | "hot" | "reload" }>;
  /** Stop serving: unhandle the protocol on the partition, dispose the source. */
  dispose(): void;
};

/**
 * Serve the renderer from a source root on a session partition and start
 * warming it. Every partition shares one transform and dependency cache.
 */
export const serveRendererSource = (options: {
  partition: string;
  /** Repo root to serve (the checkout, or a draft worktree). */
  sourceRoot: string;
  /** Repo root whose packages/desktop-ui .env files supply the defines; defaults to sourceRoot. */
  envRoot?: string;
  mode: RendererBuildMode;
  log: (message: string) => void;
  /**
   * Rewrites the main window's first page, once. In production it is served
   * straight from disk rather than after the source server has loaded, so
   * it can paint sooner.
   */
  firstPage?: (html: string) => string;
}): RendererSourceHandle => {
  const partitionSession = session.fromPartition(options.partition);
  serveMediaProtocol(options.partition);
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
  const ready = Promise.all([import("./renderer-source.js"), import("./tools.js")]).then(
    async ([{ createRendererSource }, { loadSourceTools }]) =>
      createRendererSource({
        tools: await loadSourceTools(),
        uiRoot: path.join(options.sourceRoot, "packages", "desktop-ui"),
        repoRoot: options.sourceRoot,
        envDir: path.join(options.envRoot ?? options.sourceRoot, "packages", "desktop-ui"),
        cacheDir: path.join(app.getPath("userData"), "Renderer Source Cache"),
        mode: options.mode,
        log: options.log,
        onReloadNeeded: reloadPages,
      }),
  );
  let firstPage = options.firstPage ?? null;
  const uiRoot = path.join(options.sourceRoot, "packages", "desktop-ui");
  let sourceReady = false;
  void ready.then(
    () => {
      sourceReady = true;
    },
    () => undefined,
  );
  partitionSession.protocol.handle(RENDERER_SCHEME, async (request) => {
    const url = new URL(request.url);
    // The first page's own scripts are plain files in public/: served from
    // disk while the source server is still loading, so the page can paint.
    const early = !sourceReady && options.mode === "production" ? earlyPublicFile(uiRoot, url) : null;
    if (early) {
      const body = await fs.promises.readFile(early).catch(() => null);
      if (body) {
        return new Response(body, {
          headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
        });
      }
    }
    if (
      firstPage &&
      (url.pathname === "/" || url.pathname === "/index.html") &&
      url.searchParams.get("window") === "full"
    ) {
      const rewrite = firstPage;
      firstPage = null;
      const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" };
      if (options.mode === "production") {
        const source = await fs.promises.readFile(path.join(uiRoot, "index.html"), "utf8").catch(() => null);
        if (source !== null) return new Response(rewrite(source), { headers });
      }
      const response = await (await ready).handle(request);
      if (!response.ok) return response;
      return new Response(rewrite(await response.text()), { status: response.status, headers });
    }
    return (await ready).handle(request);
  });
  void ready
    .then((source) => source.prepare())
    .catch((error) => {
      options.log(`[source] prepare failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  return {
    ready,
    applyChanges: async (paths) => {
      const result = await (await ready).applyChanges(paths);
      if (result.mode === "reload") reloadPages();
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
      return { mode: result.mode };
    },
    dispose: () => {
      partitionSession.protocol.unhandle(RENDERER_SCHEME);
      void ready.then((source) => source.dispose(), () => undefined);
    },
  };
};
