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
        // The detached worker runs under Bun, which has no node:sqlite; a
        // static import crashes the runner chunk at load (desktop-v0.0.409,
        // regressed again via kernel/tools/image-operation-store.ts).
        return "static node:sqlite breaks the Bun worker; resolve the driver at runtime (see image-operation-store.ts loadSqliteDatabaseCtorSync)";
      }
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
        /\.\.\/.*runtime\//.test(specifier)
      ) {
        return "Electron must use @stella/runtime workspace exports";
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
