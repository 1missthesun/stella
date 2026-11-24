import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isEntryPoint } from "../../../scripts/lib/entry-point.mjs";

const isEffectImport = (specifier) =>
  specifier === "effect" || specifier.startsWith("effect/");
const isEffectBearingRuntimeImport = (specifier) =>
  specifier === "@stella/runtime/kernel/home/home-service" ||
  specifier === "@stella/runtime/kernel/home/home-service.js" ||
  /(?:^|\/)runtime\/kernel\/home\/home-service(?:\.[cm]?[jt]s)?$/.test(
    specifier,
  ) ||
  specifier.startsWith("@stella/runtime/host/lifecycle/") ||
  specifier === "@stella/runtime/host/staleness" ||
  specifier === "@stella/runtime/host/staleness.js" ||
  /(?:^|\/)runtime\/host\/(?:lifecycle\/|staleness(?:\.|$))/.test(specifier) ||
  /^@stella\/runtime\/(?:[^/]+\/)*(?:cloud-)?effect-runtime(?:\.js)?$/.test(
    specifier,
  ) ||
  /(?:^|\/)runtime\/(?:[^/]+\/)*(?:cloud-)?effect-runtime(?:\.|$)/.test(
    specifier,
  );
const isEffectBearingCloudImport = (specifier) =>
  specifier === "@stella/executor-cloud" ||
  specifier.startsWith("@stella/executor-cloud/") ||
  specifier === "@stella/cloud-builder" ||
  specifier.startsWith("@stella/cloud-builder/");
const isDesktopPackageImport = (specifier) =>
  specifier === "@stella/desktop" ||
  specifier.startsWith("@stella/desktop/") ||
  specifier === "@stella/desktop-ui" ||
  specifier.startsWith("@stella/desktop-ui/");
// pi-ai's browser sign-in helpers answer the OAuth redirect with Pi's own
// branded page; Stella's sign-ins use @stella/contracts/sign-in-page.
const isPiSignInPageImport = (specifier) =>
  /^@earendil-works\/pi-ai\/(?:dist\/)?(?:utils\/oauth-page|auth\/oauth\/callback-server)(?:\.js)?$/.test(
    specifier,
  );
const MAIN_RUNTIME_IMPORTS = new Set([
  "@stella/runtime/host/remote",
  "@stella/runtime/host/remote.js",
]);
const isAgentImport = (specifier) =>
  specifier === "@stella/agent" || specifier.startsWith("@stella/agent/");
const isRuntimeImport = (specifier) =>
  specifier === "@stella/runtime" || specifier.startsWith("@stella/runtime/");
const BUN_SQLITE_REASON =
  "static node:sqlite breaks the Bun worker; resolve the driver at runtime (see image-operation-store.ts loadSqliteDatabaseCtorSync)";
const runtimeEffectFencedPrefixes = [
  "packages/runtime/kernel/tools/defs/",
  "packages/runtime/kernel/prompts/",
];
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  "coverage",
  "release",
]);
const sourceSuffixes = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const walk = async (directory) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
    } else if (entry.isFile() && sourceSuffixes.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
};

const moduleSpecifiers = (text) => {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
};

export const checkBoundaries = async (repoRoot) => {
  const offenders = [];
  const inspect = async (root, isForbidden) => {
    for (const file of await walk(root)) {
      const text = await readFile(file, "utf8");
      const relativeFile = path.relative(repoRoot, file).replace(/\\/g, "/");
      for (const specifier of moduleSpecifiers(text)) {
        const reason = isForbidden(specifier, relativeFile);
        if (reason) {
          offenders.push({ file: relativeFile, specifier, reason });
        }
      }
    }
  };

  await inspect(
    path.join(repoRoot, "packages", "runtime"),
    (specifier, file) => {
      if (
        specifier === "@stella/desktop" ||
        specifier.startsWith("@stella/desktop/")
      ) {
        return "runtime must not depend on desktop";
      }
      if (
        specifier === "@stella/desktop-ui" ||
        specifier.startsWith("@stella/desktop-ui/")
      ) {
        return "runtime must not depend on desktop-ui";
      }
      if (/\.\.\/.*(?:desktop|desktop-ui)\//.test(specifier)) {
        return "runtime must not reach into desktop packages by relative path";
      }
      if (
        isEffectBearingCloudImport(specifier) ||
        /(?:^|\/)workers\/cloud-builder(?:\/|$)/.test(specifier) ||
        /(?:^|\/)packages\/executor-cloud(?:\/|$)/.test(specifier)
      ) {
        return "runtime must not depend on cloud execution packages";
      }
      if (
        isEffectImport(specifier) &&
        runtimeEffectFencedPrefixes.some((prefix) => file.startsWith(prefix))
      ) {
        return "tool/prompt definitions must stay Effect-free";
      }
      if (
        specifier === "node:sqlite" &&
        !file.startsWith("packages/runtime/scripts/")
      ) {
        return BUN_SQLITE_REASON;
      }
      return null;
    },
  );

  await inspect(
    path.join(repoRoot, "packages", "node-shared"),
    (specifier) => {
      if (isRuntimeImport(specifier) || isAgentImport(specifier)) {
        return "node-shared is what main and the runtime both run; it must not depend on the runtime or agent";
      }
      if (isDesktopPackageImport(specifier)) {
        return "node-shared must not depend on desktop packages";
      }
      if (/\.\.\/.*(?:runtime|agent|desktop|desktop-ui)\//.test(specifier)) {
        return "node-shared must not reach into other packages by relative path";
      }
      if (specifier === "node:sqlite") return BUN_SQLITE_REASON;
      return null;
    },
  );

  await inspect(
    path.join(repoRoot, "packages", "executor-cloud"),
    (specifier) => {
      if (isDesktopPackageImport(specifier)) {
        return "cloud executor must not depend on desktop packages";
      }
      if (
        specifier === "@stella/cloud-builder" ||
        specifier.startsWith("@stella/cloud-builder/") ||
        /(?:^|\/)workers\/cloud-builder(?:\/|$)/.test(specifier)
      ) {
        return "cloud executor must not depend on its Worker host";
      }
      return null;
    },
  );

  await inspect(
    path.join(repoRoot, "workers", "cloud-builder"),
    (specifier) => {
      if (isDesktopPackageImport(specifier)) {
        return "cloud Worker must not depend on desktop packages";
      }
      return null;
    },
  );

  await inspect(
    path.join(repoRoot, "packages", "desktop-ui"),
    (specifier, file) => {
      if (isEffectImport(specifier)) {
        return "Effect is fenced from desktop-ui";
      }
      if (isEffectBearingRuntimeImport(specifier)) {
        return "Effect-bearing runtime internals are fenced inside packages/runtime";
      }
      if (isEffectBearingCloudImport(specifier)) {
        return "Effect-bearing cloud packages are fenced from desktop-ui";
      }
      if (!file.startsWith("packages/desktop-ui/src/")) {
        return null;
      }
      if (
        specifier.startsWith("@stella/") &&
        specifier !== "@stella/contracts" &&
        !specifier.startsWith("@stella/contracts/") &&
        specifier !== "@stella/theme" &&
        !specifier.startsWith("@stella/theme/")
      ) {
        return "renderer may import only @stella/contracts and @stella/theme workspace modules";
      }
      if (/\.\.\/.*(?:runtime|desktop|contracts)\//.test(specifier)) {
        return "renderer must use the contracts workspace boundary";
      }
      return null;
    },
  );

  await inspect(
    path.join(repoRoot, "packages", "desktop"),
    (specifier, file) => {
      if (isEffectImport(specifier)) {
        return "Effect is fenced from desktop";
      }
      if (isEffectBearingRuntimeImport(specifier)) {
        return "Effect-bearing runtime internals are fenced inside packages/runtime";
      }
      if (isEffectBearingCloudImport(specifier)) {
        return "Effect-bearing cloud packages are fenced from desktop";
      }
      if (
        file.startsWith("packages/desktop/electron/") &&
        /\.\.\/.*(?:runtime|agent|node-shared)\//.test(specifier)
      ) {
        return "Electron must use workspace exports, not relative paths into other packages";
      }
      if (file.startsWith("packages/desktop/electron/") && isAgentImport(specifier)) {
        return "Electron main must not load the agent; it runs in the runtime process";
      }
      if (
        file.startsWith("packages/desktop/electron/") &&
        isRuntimeImport(specifier) &&
        !MAIN_RUNTIME_IMPORTS.has(specifier)
      ) {
        return "Electron main reaches the runtime only through its bridge client (@stella/runtime/host/remote): run the work in the runtime behind a host call (RUNTIME_APP_SERVICE_CALLS), or move code both processes need to @stella/node-shared";
      }
      return null;
    },
  );

  await inspect(path.join(repoRoot, "packages", "contracts"), (specifier) => {
    if (isEffectImport(specifier)) {
      return "Effect is fenced from contracts";
    }
    if (isEffectBearingRuntimeImport(specifier)) {
      return "Effect-bearing runtime internals are fenced inside packages/runtime";
    }
    if (isEffectBearingCloudImport(specifier)) {
      return "Effect-bearing cloud packages are fenced from contracts";
    }
    return null;
  });

  await inspect(path.join(repoRoot, "packages", "theme"), (specifier) => {
    if (isEffectImport(specifier)) return "Effect is fenced from theme";
    if (specifier.startsWith("@stella/")) {
      return "theme must not depend on other workspace packages";
    }
    return null;
  });

  await inspect(path.join(repoRoot, "packages", "mobile"), (specifier) => {
    if (isEffectImport(specifier)) {
      return "Effect is fenced from mobile";
    }
    if (isEffectBearingRuntimeImport(specifier)) {
      return "Effect-bearing runtime internals are fenced from mobile";
    }
    if (isEffectBearingCloudImport(specifier)) {
      return "Effect-bearing cloud packages are fenced from mobile";
    }
    return null;
  });

  for (const pkg of [
    "agent",
    "node-shared",
    "runtime",
    "desktop",
    "desktop-ui",
    "executor-cloud",
  ]) {
    await inspect(path.join(repoRoot, "packages", pkg), (specifier) =>
      isPiSignInPageImport(specifier)
        ? "sign-in callbacks must show Stella's page (@stella/contracts/sign-in-page), not pi-ai's"
        : null,
    );
  }

  return offenders;
};

if (isEntryPoint(import.meta.url)) {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const offenders = await checkBoundaries(repoRoot);
  if (offenders.length > 0) {
    console.error("Workspace dependency boundary violations:");
    for (const offender of offenders) {
      console.error(
        `- ${offender.file}: ${offender.specifier} (${offender.reason})`,
      );
    }
    process.exit(1);
  }
}
