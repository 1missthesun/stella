import type {
  AppCompilerRpc,
  CompiledWorkspaceApp,
} from "../../shared/workspace-app-compiler.js";
import { log, withInfrastructureDeadline } from "./build-session/shared/keys.js";
import { released } from "./rpc-release.js";
import type { WorldSqlStore } from "./world/store.js";

const SLUG = /^[a-z][a-z0-9-]{0,31}$/;
const REVISION = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const decoder = new TextDecoder();
import type { WorkspaceApp } from "@stella/contracts/workspace-apps";
export type { WorkspaceApp } from "@stella/contracts/workspace-apps";
type Release = { app: WorkspaceApp; chunks: number };
/** The compiler, not the app, failed this many times: `at` is the next try. */
type Attempt = WorkspaceApp & { retry?: { failures: number; at: number } };

// Longer than the compiler's own limit, so its answer arrives first.
const COMPILE_DEADLINE_MS = 75_000;
const COMPILER_QUICK_FAILURE_MS = 15_000;
const COMPILER_RETRY_MS = 60_000;
const COMPILER_TRIES = 5;

/** What the app's author has to fix; its message is shown to them. */
class AppBuildError extends Error {}
/** The compiler gave out; the same files may build later. */
class AppCompilerUnavailable extends Error {}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "App build failed.";

export function parseAppManifest(text: string, slug: string) {
  const value = JSON.parse(text);
  if (
    !SLUG.test(slug) ||
    value?.schemaVersion !== 1 ||
    value.slug !== slug ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 100 ||
    typeof value.revision !== "string" ||
    !REVISION.test(value.revision)
  )
    throw new Error("Invalid stella.app.json.");
  const icon =
    typeof value.icon === "string" &&
    value.icon.trim() &&
    value.icon.trim().length <= 16 &&
    !/[\p{L}\p{N}\p{Cc}]/u.test(value.icon)
      ? value.icon.trim()
      : undefined;
  return {
    slug,
    name: value.name.trim(),
    revision: value.revision,
    ...(icon ? { icon } : {}),
  };
}

const MAX_PREVIEW_BYTES = 1_500_000;
type StoredPreview = { revision: string; bytes: Uint8Array };

type Bundle = { revision: string; result: CompiledWorkspaceApp };

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

// An app is served below its signed URL's path, so a redirect to a canonical
// path would leave it: each form of a page's path answers with the page.
const findAsset = (assets: CompiledWorkspaceApp["assets"], pathname: string) => {
  const path = pathname.split("/").map(decodeSegment).join("/").replaceAll(/\/+/g, "/");
  const bare = path.replace(/\/$/, "");
  return (
    assets[path] ??
    (path === bare
      ? assets[`${path}.html`] ?? assets[`${path}/index.html`]
      : assets[`${path}index.html`] ?? assets[`${bare}.html`])
  );
};

const assetResponse = (
  request: Request,
  assets: CompiledWorkspaceApp["assets"],
): Response | null => {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const asset = findAsset(assets, new URL(request.url).pathname);
  if (!asset) return null;
  return new Response(request.method === "HEAD" ? null : asset.body, {
    headers: asset.contentType ? { "content-type": asset.contentType } : {},
  });
};

export class WorkspaceApps {
  private bundles = new Map<string, Bundle>();
  private loading = new Map<string, Promise<Bundle>>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private world: WorldSqlStore,
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  private async compileOnce(
    files: Record<string, string>,
  ): Promise<CompiledWorkspaceApp> {
    const compiler = this.env.APP_COMPILER as unknown as
      | AppCompilerRpc
      | undefined;
    if (!compiler) throw new Error("The APP_COMPILER binding is missing.");
    const result = released(
      await withInfrastructureDeadline(
        compiler.compileWorkspaceApp(files),
        COMPILE_DEADLINE_MS,
        "The app compiler did not answer in time.",
      ),
    );
    if (result.ok) return result.app;
    if (typeof result.error === "string" && result.error)
      throw new AppBuildError(result.error);
    throw new Error("The app compiler runs a version this one can't read.");
  }

  private async compile(
    files: Record<string, string>,
  ): Promise<CompiledWorkspaceApp> {
    const startedAt = Date.now();
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.compileOnce(files);
      } catch (error) {
        if (error instanceof AppBuildError) throw error;
        const message = errorMessage(error).slice(0, 300);
        log("error", "workspace_app_compiler_failed", { attempt, message });
        // A compiler isolate that dies takes its builds with it, so a quick
        // failure gets one more try on a new one.
        if (attempt > 1 || Date.now() - startedAt > COMPILER_QUICK_FAILURE_MS)
          throw new AppCompilerUnavailable(message);
      }
    }
  }

  private keep(slug: string, bundle: Bundle): Bundle {
    if (this.bundles.size >= 8)
      this.bundles.delete(this.bundles.keys().next().value!);
    this.bundles.set(slug, bundle);
    return bundle;
  }

  reconcile(): Promise<WorkspaceApp[]> {
    const next = this.queue.then(() => this.reconcileNow());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async reconcileNow(): Promise<WorkspaceApp[]> {
    const listing = await this.world.list("apps", { limit: 5000 });
    if (listing.cursor)
      throw new Error("Apps folder exceeds the 5000-file limit.");
    const manifests = listing.entries.filter(
      (e) =>
        /^apps\/[a-z][a-z0-9-]{0,31}\/stella\.app\.json$/.test(e.path) &&
        e.kind === "file",
    );
    if (manifests.length > 50)
      throw new Error("At most 50 apps are supported.");
    const apps: WorkspaceApp[] = [];
    for (const entry of manifests) {
      const slug = entry.path.split("/")[1]!;
      let manifest;
      try {
        if (entry.size > 4096) throw new Error("Manifest too large.");
        manifest = parseAppManifest(
          decoder.decode((await this.world.readFile(entry.path))!),
          slug,
        );
      } catch {
        continue;
      }
      const key = `workspace-app:${slug}`;
      const old = await this.ctx.storage.get<Release>(key);
      const attemptKey = `workspace-app-attempt:${slug}`;
      const attempted = await this.ctx.storage.get<Attempt>(attemptKey);
      const now = Date.now();
      const same =
        attempted?.revision === manifest.revision ? attempted : undefined;
      if (same && !(same.retry && same.retry.at <= now)) {
        const { retry: _retry, ...app } = same;
        apps.push(
          old
            ? {
                ...old.app,
                ...(app.error ? { error: app.error } : {}),
              }
            : app,
        );
        continue;
      }
      const app: WorkspaceApp = {
        appId: slug,
        slug,
        title: manifest.name,
        ...(manifest.icon ? { icon: manifest.icon } : {}),
        revision: manifest.revision,
        status: "ready",
        createdAt: old?.app.createdAt ?? now,
        updatedAt: now,
      };
      let retry: Attempt["retry"];
      try {
        const prefix = `apps/${slug}/revisions/${manifest.revision}/`;
        const entries = listing.entries.filter((e) =>
          e.path.startsWith(prefix),
        );
        if (
          entries.length > 200 ||
          entries.reduce((sum, e) => sum + e.size, 0) > MAX_BYTES
        )
          throw new Error("App exceeds 200 files or 2 MiB.");
        const files: Record<string, string> = {};
        for (const file of entries) {
          if (file.kind === "dir") continue;
          if (file.kind !== "file")
            throw new Error("Symlinks are not supported in apps.");
          files[file.path.slice(prefix.length)] = decoder.decode(
            (await this.world.readFile(file.path))!,
          );
        }
        const result = await this.compile(files);
        const current = decoder.decode(
          (await this.world.readFile(entry.path))!,
        );
        if (parseAppManifest(current, slug).revision !== manifest.revision)
          continue;
        const encoded = new TextEncoder().encode(JSON.stringify(files));
        const chunks = Math.ceil(encoded.length / 65536);
        for (let i = 0; i < chunks; i++)
          await this.ctx.storage.put(
            `${key}:source:${app.revision}:${i}`,
            encoded.slice(i * 65536, (i + 1) * 65536),
          );
        await this.ctx.storage.put(key, { app, chunks } satisfies Release);
        if (old && old.app.revision !== app.revision) {
          for (let i = 0; i < old.chunks; i++)
            await this.ctx.storage.delete(
              `${key}:source:${old.app.revision}:${i}`,
            );
        }
        this.ctx.facets.abort(`app:${slug}`, new Error("App updated"));
        this.keep(slug, { revision: app.revision, result });
      } catch (error) {
        app.status = "error";
        app.error = errorMessage(error).slice(0, 2000);
        if (error instanceof AppCompilerUnavailable) {
          const failures = (same?.retry?.failures ?? 0) + 1;
          if (failures < COMPILER_TRIES) {
            app.error = "Stella couldn't build this app just now and will try again shortly.";
            retry = {
              failures,
              at: Date.now() + COMPILER_RETRY_MS * 2 ** (failures - 1),
            };
          } else {
            app.error = "Stella couldn't build this app. Publish a smaller or simpler revision.";
          }
        }
      }
      await this.ctx.storage.put(attemptKey, {
        ...app,
        ...(retry ? { retry } : {}),
      } satisfies Attempt);
      await this.world.writeFile(
        `apps/${slug}/build-status.json`,
        new TextEncoder().encode(JSON.stringify(app, null, 2)),
      );
      apps.push(
        app.status === "error" && old ? { ...old.app, error: app.error } : app,
      );
    }
    return apps;
  }

  private async readReleaseFiles(
    slug: string,
    release: Release,
  ): Promise<Record<string, string>> {
    if ("files" in release)
      return (release as Release & { files: Record<string, string> }).files;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < release.chunks; i++) {
      const chunk = await this.ctx.storage.get<Uint8Array>(
        `workspace-app:${slug}:source:${release.app.revision}:${i}`,
      );
      if (!chunk) throw new Error("App source is unavailable.");
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(decoder.decode(bytes));
  }

  private async bundle(slug: string, release: Release): Promise<Bundle> {
    const { revision } = release.app;
    const cached = this.bundles.get(slug);
    if (cached?.revision === revision) return cached;
    const key = `${slug}:${revision}`;
    let loading = this.loading.get(key);
    if (!loading) {
      loading = this.readReleaseFiles(slug, release)
        .then((files) => this.compile(files))
        .then((result) => this.keep(slug, { revision, result }))
        .finally(() => this.loading.delete(key));
      this.loading.set(key, loading);
    }
    return await loading;
  }

  async preview(slug: string, revision: string): Promise<Uint8Array | null> {
    const stored = await this.ctx.storage.get<StoredPreview>(
      `workspace-app-preview:${slug}`,
    );
    return stored?.revision === revision ? stored.bytes : null;
  }

  async putPreview(slug: string, revision: string, bytes: Uint8Array) {
    if (!SLUG.test(slug) || bytes.byteLength > MAX_PREVIEW_BYTES) return;
    await this.ctx.storage.put(`workspace-app-preview:${slug}`, {
      revision,
      bytes,
    } satisfies StoredPreview);
  }

  async fetch(slug: string, request: Request): Promise<Response> {
    if (
      !SLUG.test(slug) ||
      !(await this.world.stat(`apps/${slug}/stella.app.json`))
    )
      return new Response("App not found", { status: 404 });
    const release = await this.ctx.storage.get<Release>(
      `workspace-app:${slug}`,
    );
    if (!release)
      return new Response("App has not built successfully.", { status: 409 });
    let cached: Bundle;
    try {
      cached = await this.bundle(slug, release);
    } catch (error) {
      log("error", "workspace_app_open_failed", {
        message: errorMessage(error).slice(0, 300),
      });
      return new Response("This app couldn't be opened just now. Try again in a moment.", {
        status: 503,
      });
    }
    const { result } = cached;
    const asset = assetResponse(request, result.assets);
    if (asset) return asset;
    const worker = this.env.LOADER.get(
      `app:${this.ctx.id}:${slug}:${cached.revision}`,
      () => ({
        mainModule: result.mainModule,
        modules: result.modules,
        compatibilityDate: "2026-07-22",
        globalOutbound: null,
      }),
    );
    return this.ctx.facets
      .get(`app:${slug}`, () => ({
        class: worker.getDurableObjectClass("App"),
      }))
      .fetch(request);
  }
}
