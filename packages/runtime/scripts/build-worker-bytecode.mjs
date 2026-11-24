#!/usr/bin/env bun
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeRuntimeBytecodeSourceStamp as computeSourceStamp,
  readRuntimeBytecodeFingerprint,
} from "../kernel/shared/runtime-bytecode-stamp.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(runtimeDir, "..", "..");
const outBase = path.join(repoRoot, "packages", "desktop", "dist-electron", "runtime");
const workerOutDir = path.join(outBase, "worker");
const chunksOutDir = path.join(workerOutDir, "chunks");
const sharedOutDir = path.join(workerOutDir, "shared");
const fingerprintPath = path.join(workerOutDir, ".bytecode-fingerprint.json");

const toPosix = (p) => p.split(path.sep).join("/");

export const computeRuntimeBytecodeSourceStamp = () =>
  computeSourceStamp(repoRoot);

const readJsonSafe = () => readRuntimeBytecodeFingerprint(workerOutDir);

// Modules holding process-wide mutable singleton state shared across worker
// entry and lazy chunks. Externalizing each into its own tiny shared CJS
// module guarantees a single Node/Bun module cache instance across all chunks.
const SHARED_SINGLETONS = [
  { name: "file-logger", source: "packages/node-shared/observability/file-logger.ts" },
  { name: "local-preferences", source: "packages/node-shared/preferences/local-preferences.ts" },
  { name: "boot-timing", source: "packages/runtime/observability/boot-timing.ts" },
  { name: "runtime-telemetry", source: "packages/runtime/observability/runtime-telemetry.ts" },
  { name: "token-store-broker", source: "packages/runtime/kernel/connectors/token-store-broker.ts" },
  { name: "local-llm-credential-access", source: "packages/runtime/kernel/storage/local-llm-credential-access.ts" },
  { name: "secure-value-redaction", source: "packages/runtime/kernel/shared/secure-value-redaction.ts" },
  { name: "agent-process-registry", source: "packages/runtime/kernel/shared/agent-process-registry.ts" },
  { name: "claude-code-quitting", source: "packages/runtime/kernel/integrations/claude-code-quitting.ts" },
  { name: "claude-code-session-sync-sink", source: "packages/runtime/kernel/integrations/claude-code-session-sync-sink.ts" },
  { name: "model-runtime", source: "packages/runtime/kernel/model-runtime.ts" },
];

// Heavy dynamic-import boundaries split into their own precompiled bytecode
// chunks so the boot shell (entry.js + entry.jsc) loads only what boot needs.
const LAZY_CHUNKS = [
  { name: "runner", source: "packages/runtime/kernel/runner.ts" },
  { name: "host", source: "packages/runtime/host/index.ts" },
  { name: "client-server", source: "packages/runtime/host/client-server.ts" },
  { name: "desktop-chats", source: "packages/agent/src/host/desktop-chats.ts" },
  { name: "desktop-execution", source: "packages/agent/src/host/desktop-execution.ts" },
  { name: "account-byok", source: "packages/agent/src/provider/account-byok.ts" },
  { name: "chatgpt-provider", source: "packages/agent/src/provider/chatgpt.ts" },
  { name: "model-routing", source: "packages/runtime/kernel/model-routing.ts" },
  { name: "claude-code-engine", source: "packages/runtime/worker/server/claude-code-engine.ts" },
  { name: "claude-code-agent-runtime", source: "packages/runtime/kernel/integrations/claude-code-agent-runtime.ts" },
  { name: "claude-code-session-runtime", source: "packages/runtime/kernel/integrations/claude-code-session-runtime.ts" },
  { name: "antigravity-cli-engine", source: "packages/runtime/worker/server/antigravity-cli-engine.ts" },
  { name: "connector-brokers", source: "packages/runtime/worker/backend-connector-action-broker.ts" },
  { name: "connect-service", source: "packages/runtime/kernel/connectors/connect-service.ts" },
  { name: "one-shot-completion", source: "packages/runtime/kernel/agent-runtime/one-shot-completion.ts" },
  { name: "llm-completion", source: "packages/runtime/kernel/llm-completion.ts" },
  { name: "llm-oauth-providers", source: "packages/runtime/kernel/storage/llm-oauth-providers.ts" },
  { name: "google-workspace-auth", source: "packages/runtime/kernel/google-workspace/AuthManager.ts" },
  { name: "google-workspace-drive", source: "packages/runtime/kernel/google-workspace/DriveService.ts" },
  { name: "google-workspace-docs", source: "packages/runtime/kernel/google-workspace/DocsService.ts" },
  { name: "google-workspace-calendar", source: "packages/runtime/kernel/google-workspace/CalendarService.ts" },
  { name: "google-workspace-gmail", source: "packages/runtime/kernel/google-workspace/GmailService.ts" },
  { name: "google-workspace-people", source: "packages/runtime/kernel/google-workspace/PeopleService.ts" },
  { name: "effect-lazy", source: "packages/runtime/worker/effect-lazy.ts" },
];

// Native / optional / runtime-resolved externals that must not be inlined.
const NATIVE_EXTERNALS = [
  "electron",
  "undici",
  "esbuild",
  "@silvia-odwyer/photon-node",
  "mac-screen-capture-permissions",
  "uiohook-napi",
];

// Per-provider pi-ai API modules and provider modules stay external (resolved
// lazily from packages/runtime/node_modules at runtime) so unused provider SDKs
// (@anthropic-ai/sdk, openai, @google/genai, google-auth-library) are neither
// compiled into runner/desktop-chats bytecode nor parsed unless invoked.
const PI_AI_DIST = path.join(
  runtimeDir,
  "node_modules",
  "@earendil-works",
  "pi-ai",
  "dist",
);

const LAZY_API_IMPORTS = new Set([
  "anthropic-messages.js",
  "openai-completions.js",
  "openai-responses.js",
  "google-generative-ai.js",
  "azure-openai-responses.js",
  "google-vertex.js",
  "amazon-bedrock.js",
  "openrouter-images.js",
]);

const absTargetMap = new Map();
for (const s of SHARED_SINGLETONS) {
  absTargetMap.set(
    path.join(repoRoot, s.source),
    path.join(sharedOutDir, `${s.name}.js`),
  );
}
for (const c of LAZY_CHUNKS) {
  absTargetMap.set(
    path.join(repoRoot, c.source),
    path.join(chunksOutDir, `${c.name}.js`),
  );
}

const resolveSourceCandidate = (importer, specifier) => {
  if (specifier.startsWith("@stella/runtime/")) {
    const sub = specifier.slice("@stella/runtime/".length);
    for (const ext of ["", ".ts", ".js"]) {
      const candidate = path.join(repoRoot, "packages", "runtime", sub.replace(/\.js$/, "") + ext);
      if (absTargetMap.has(candidate)) return candidate;
    }
    return null;
  }
  if (specifier.startsWith("@stella/agent/")) {
    const sub = specifier.slice("@stella/agent/".length);
    for (const ext of ["", ".ts", ".js"]) {
      const candidate = path.join(repoRoot, "packages", "agent", "src", sub.replace(/\.js$/, "") + ext);
      if (absTargetMap.has(candidate)) return candidate;
    }
    return null;
  }
  if (specifier.startsWith("@stella/node-shared/")) {
    const sub = specifier.slice("@stella/node-shared/".length);
    for (const ext of ["", ".ts", ".js"]) {
      const candidate = path.join(repoRoot, "packages", "node-shared", sub.replace(/\.js$/, "") + ext);
      if (absTargetMap.has(candidate)) return candidate;
    }
    return null;
  }
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.js`,
  ];
  for (const candidate of candidates) {
    if (absTargetMap.has(candidate)) return candidate;
  }
  return null;
};

const makeBoundaryPlugin = (selfSourceAbs, selfOutAbs) => {
  const selfOutDir = path.dirname(selfOutAbs);
  const relFromOut = (targetAbs) => {
    const rel = toPosix(path.relative(selfOutDir, targetAbs));
    return rel.startsWith(".") ? rel : `./${rel}`;
  };
  return {
    name: "stella-runtime-bytecode-boundaries",
    setup(build) {
      // Rewrite lazy @earendil-works/pi-ai/providers/<id> dynamic imports to
      // external runtime paths so only the active provider is loaded.
      build.onResolve(
        { filter: /^@earendil-works\/pi-ai\/providers\/[^/]+$/ },
        (args) => {
          const name = args.path.slice("@earendil-works/pi-ai/providers/".length);
          // Keep *.models bundled inside model-runtime/account-byok/chatgpt,
          // while full provider modules (which pull provider APIs/OAuth) stay lazy.
          if (name.endsWith(".models") || name === "all") return null;
          const target = path.join(PI_AI_DIST, "providers", `${name}.js`);
          if (!existsSync(target)) return null;
          return { path: relFromOut(target), external: true };
        },
      );

      // Keep pi-ai's lazy API SDK modules external so @anthropic-ai/sdk,
      // openai, @google/genai, and google-auth-library load on first stream.
      build.onResolve({ filter: /^\.\/.*\.js$/ }, (args) => {
        if (!args.importer || !args.importer.includes("@earendil-works")) return null;
        const base = path.basename(args.path);
        if (!LAZY_API_IMPORTS.has(base)) return null;
        const resolved = path.resolve(path.dirname(args.importer), args.path);
        if (!resolved.includes(`${path.sep}pi-ai${path.sep}dist${path.sep}api${path.sep}`)) {
          return null;
        }
        if (!existsSync(resolved)) return null;
        return { path: relFromOut(resolved), external: true };
      });

      // Keep dynamically imported `effect` external so `entry.js` stays small
      // and Effect only loads if/when a lazy timer/retry/maintenance fiber runs.
      build.onResolve({ filter: /^effect$/ }, (args) => {
        if (args.kind !== "dynamic-import") return null;
        for (const candidate of [
          path.join(runtimeDir, "node_modules", "effect", "dist", "index.js"),
          path.join(repoRoot, "node_modules", "effect", "dist", "index.js"),
        ]) {
          if (existsSync(candidate)) {
            return { path: relFromOut(candidate), external: true };
          }
        }
        return { path: "effect", external: true };
      });

      // Keep native addons resolved from packages/runtime/node_modules if needed.
      build.onResolve({ filter: /^@silvia-odwyer\/photon-node$/ }, () => {
        const pkg = path.join(runtimeDir, "node_modules", "@silvia-odwyer", "photon-node");
        if (existsSync(pkg)) {
          return { path: relFromOut(pkg), external: true };
        }
        return { path: "@silvia-odwyer/photon-node", external: true };
      });

      // Rewrite shared singleton & lazy chunk boundaries to their output paths.
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point-build" || !args.importer) return null;
        const matchedSource = resolveSourceCandidate(args.importer, args.path);
        if (!matchedSource || matchedSource === selfSourceAbs) return null;
        const targetOut = absTargetMap.get(matchedSource);
        if (!targetOut) return null;
        return { path: relFromOut(targetOut), external: true };
      });

      // effect@4's ConfigProvider reads `import.meta?.env`, which is invalid
      // inside Bun's CJS bytecode wrapper and makes Bun skip .jsc emission.
      // Runtime workers always read env from process.env, so strip it cleanly.
      build.onLoad({ filter: /effect[/\\]dist[/\\]ConfigProvider\.js$/ }, (args) => {
        const contents = readFileSync(args.path, "utf8").replaceAll(
          "import.meta?.env",
          "undefined",
        );
        return { contents, loader: "js" };
      });
    },
  };
};

const buildUnit = async ({ sourceRel, outAbs }) => {
  const sourceAbs = path.join(repoRoot, sourceRel);
  const outDir = path.dirname(outAbs);
  const fileName = path.basename(outAbs);
  mkdirSync(outDir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [sourceAbs],
    outdir: outDir,
    naming: { entry: fileName },
    target: "bun",
    format: "cjs",
    bytecode: true,
    sourcemap: "none",
    external: NATIVE_EXTERNALS,
    plugins: [makeBoundaryPlugin(sourceAbs, outAbs)],
  });
  if (!result.success) {
    const details = result.logs.map((l) => l.message || String(l)).join("\n");
    throw new Error(`Bun.build failed for ${sourceRel}:\n${details}`);
  }
  return result.outputs.map((o) => o.path);
};

export const isRuntimeBytecodeFresh = () => {
  const fp = readJsonSafe(fingerprintPath);
  if (!fp || fp.bunVersion !== Bun.version) return false;
  if (!existsSync(path.join(workerOutDir, "entry.js"))) return false;
  if (!existsSync(path.join(workerOutDir, "entry.js.jsc"))) return false;
  return fp.stamp === computeRuntimeBytecodeSourceStamp();
};

export const buildRuntimeWorkerBytecode = async ({ force = false, log } = {}) => {
  const startedAt = Date.now();
  const stamp = computeRuntimeBytecodeSourceStamp();
  if (!force) {
    const fp = readJsonSafe(fingerprintPath);
    if (
      fp &&
      fp.bunVersion === Bun.version &&
      fp.stamp === stamp &&
      existsSync(path.join(workerOutDir, "entry.js")) &&
      existsSync(path.join(workerOutDir, "entry.js.jsc"))
    ) {
      return { built: false, ms: Date.now() - startedAt };
    }
  }

  rmSync(outBase, { recursive: true, force: true });
  mkdirSync(workerOutDir, { recursive: true });
  mkdirSync(chunksOutDir, { recursive: true });
  mkdirSync(sharedOutDir, { recursive: true });

  // Mark dist-electron/runtime as CommonJS so .js files with .jsc bytecode
  // load cleanly under Bun even though packages/desktop/package.json is ESM.
  writeFileSync(
    path.join(outBase, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );

  const units = [
    {
      sourceRel: "packages/runtime/worker/entry.ts",
      outAbs: path.join(workerOutDir, "entry.js"),
    },
    ...SHARED_SINGLETONS.map((s) => ({
      sourceRel: s.source,
      outAbs: path.join(sharedOutDir, `${s.name}.js`),
    })),
    ...LAZY_CHUNKS.map((c) => ({
      sourceRel: c.source,
      outAbs: path.join(chunksOutDir, `${c.name}.js`),
    })),
  ];

  await Promise.all(units.map(buildUnit));

  const bunBinPath = process.execPath;
  let bunBinStat = null;
  try {
    bunBinStat = statSync(bunBinPath);
  } catch {
    // Best-effort stat of Bun binary.
  }

  writeFileSync(
    fingerprintPath,
    `${JSON.stringify(
      {
        version: 1,
        bunVersion: Bun.version,
        bunBinPath,
        ...(bunBinStat
          ? {
              bunBinSize: bunBinStat.size,
              bunBinMtimeMs: Math.round(bunBinStat.mtimeMs),
            }
          : {}),
        platform: process.platform,
        arch: process.arch,
        stamp,
        builtAt: new Date().toISOString(),
        units: units.length,
      },
      null,
      2,
    )}\n`,
  );

  const ms = Date.now() - startedAt;
  log?.(`built runtime worker bytecode (${units.length} units) in ${ms}ms`);
  return { built: true, ms, units: units.length };
};

if (import.meta.main) {
  const force = process.argv.includes("--force");
  const check = process.argv.includes("--check");
  if (check) {
    const fresh = isRuntimeBytecodeFresh();
    console.log(fresh ? "[runtime-bytecode] fresh" : "[runtime-bytecode] stale");
    process.exit(fresh ? 0 : 1);
  }
  try {
    const res = await buildRuntimeWorkerBytecode({
      force,
      log: (msg) => console.log(`[runtime-bytecode] ${msg}`),
    });
    if (!res.built) {
      console.log(`[runtime-bytecode] already fresh (${res.ms}ms)`);
    }
  } catch (error) {
    console.error("[runtime-bytecode] build failed:", error);
    process.exit(1);
  }
}
