import type {
  AppCompilerRpc,
  CompiledWorkspaceApp,
  CompiledWorkspaceAssetMetadata,
} from "../../shared/workspace-app-compiler.js";
import type { WorldSqlStore } from "./world/store.js";

const SLUG = /^[a-z][a-z0-9-]{0,31}$/;
const REVISION = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const decoder = new TextDecoder();
import type { WorkspaceApp } from "@stella/contracts/workspace-apps";
export type { WorkspaceApp } from "@stella/contracts/workspace-apps";
type Release = { app: WorkspaceApp; chunks: number };

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

type CachedBundle = {
  revision: string;
  result: CompiledWorkspaceApp;
  manifest: Map<string, CompiledWorkspaceAssetMetadata>;
};

const decodePathname = (pathname: string): string =>
  pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");

const resolveAssetPath = (
  decodedPathname: string,
  manifest: Map<string, CompiledWorkspaceAssetMetadata>,
): { pathname: string; meta: CompiledWorkspaceAssetMetadata } | null => {
  const direct = manifest.get(decodedPathname);
  if (direct) return { pathname: decodedPathname, meta: direct };
  if (decodedPathname.endsWith("/")) {
    const indexPath = `${decodedPathname}index.html`;
    const meta = manifest.get(indexPath);
    if (meta) return { pathname: indexPath, meta };
  } else {
    const htmlPath = `${decodedPathname}.html`;
    const htmlMeta = manifest.get(htmlPath);
    if (htmlMeta) return { pathname: htmlPath, meta: htmlMeta };
    const indexPath = `${decodedPathname}/index.html`;
    const indexMeta = manifest.get(indexPath);
    if (indexMeta) return { pathname: indexPath, meta: indexMeta };
  }
  return null;
};

const serveCompiledAsset = (
  request: Request,
  cached: CachedBundle,
): Response | null => {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const url = new URL(request.url);
  const decoded = decodePathname(url.pathname);
  const matched = resolveAssetPath(decoded, cached.manifest);
  if (!matched) return null;

  const { pathname: assetPath, meta } = matched;
  const strongETag = `"${meta.etag}"`;
  const weakETag = `W/${strongETag}`;
  const ifNoneMatch = request.headers.get("If-None-Match") || "";
  const eTags = new Set(ifNoneMatch.split(",").map((tag) => tag.trim()));
  const headers = new Headers();
  headers.set("ETag", strongETag);
  if (meta.contentType) headers.set("Content-Type", meta.contentType);
  headers.set(
    "Cache-Control",
    assetPath.endsWith(".html")
      ? "no-cache"
      : "public, max-age=0, must-revalidate",
  );
  if (eTags.has(weakETag) || eTags.has(strongETag)) {
    return new Response(null, { status: 304, headers });
  }
  const body = method === "HEAD" ? null : (cached.result.assets[assetPath] ?? null);
  return new Response(body, { status: 200, headers });
};

type WorkspaceAppsEnv = Env;

export class WorkspaceApps {
  private bundles = new Map<string, CachedBundle>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private world: WorldSqlStore,
    private ctx: DurableObjectState,
    private env: WorkspaceAppsEnv,
  ) {}

  private async bundle(files: Record<string, string>): Promise<CompiledWorkspaceApp> {
    const compiler = this.env.APP_COMPILER as unknown as AppCompilerRpc | undefined;
    if (!compiler) {
      throw new Error("App compiler service binding is not configured.");
    }
    return await compiler.compileWorkspaceApp(files);
  }

  private toCachedBundle(
    revision: string,
    result: CompiledWorkspaceApp,
  ): CachedBundle {
    return {
      revision,
      result,
      manifest: new Map(result.assetManifest),
    };
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
      const attempted = await this.ctx.storage.get<WorkspaceApp>(attemptKey);
      if (attempted?.revision === manifest.revision) {
        apps.push(
          old
            ? {
                ...old.app,
                ...(attempted?.error ? { error: attempted.error } : {}),
              }
            : attempted!,
        );
        continue;
      }
      const now = Date.now();
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
        const result = await this.bundle(files);
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
        if (this.bundles.size >= 8)
          this.bundles.delete(this.bundles.keys().next().value!);
        this.bundles.set(slug, this.toCachedBundle(app.revision, result));
      } catch (error) {
        app.status = "error";
        app.error = (
          error instanceof Error ? error.message : "App build failed."
        ).slice(0, 2000);
      }
      await this.ctx.storage.put(attemptKey, app);
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
    let cached = this.bundles.get(slug);
    if (!cached || cached.revision !== release.app.revision) {
      cached = this.toCachedBundle(
        release.app.revision,
        await this.bundle(await this.readReleaseFiles(slug, release)),
      );
      if (this.bundles.size >= 8)
        this.bundles.delete(this.bundles.keys().next().value!);
      this.bundles.set(slug, cached);
    }
    const asset = serveCompiledAsset(request, cached);
    if (asset) return asset;
    const { result } = cached;
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
