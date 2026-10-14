import path from "node:path";

const ENTRYPOINT = path.join(import.meta.dirname, "worker-api.ts");

const selfContainedError = (packageImports: readonly string[]): Error =>
  new Error(
    `The browser worker API must import only its own modules: ${packageImports.join("; ")}.`,
  );

const bundleWithBun = async (bun: typeof Bun): Promise<string> => {
  const packageImports: string[] = [];
  const result = await bun.build({
    entrypoints: [ENTRYPOINT],
    target: "browser",
    format: "cjs",
    throw: false,
    plugins: [
      {
        name: "browser-worker-api-self-contained",
        setup(build) {
          build.onResolve(
            { filter: /^[^./]/ },
            ({ path: specifier, importer }) => {
              packageImports.push(`${importer} imports ${specifier}`);
              return { path: specifier, external: true };
            },
          );
        },
      },
    ],
  });
  if (packageImports.length > 0) throw selfContainedError(packageImports);
  const [output] = result.outputs;
  if (!result.success || !output || result.outputs.length !== 1) {
    throw new AggregateError(
      result.logs,
      "Bundling the Node REPL browser API failed.",
    );
  }
  return output.text();
};

// A variable specifier keeps esbuild out of the cloud image, whose package
// list is traced from the executor's static imports
// (workers/cloud-builder/scripts/prepare-image.mjs); the image runs on Bun.
const ESBUILD = "esbuild";

const bundleWithEsbuild = async (): Promise<string> => {
  const esbuild: typeof import("esbuild") = await import(
    /* @vite-ignore */ ESBUILD
  );
  const packageImports: string[] = [];
  const result = await esbuild.build({
    entryPoints: [ENTRYPOINT],
    bundle: true,
    write: false,
    platform: "browser",
    format: "cjs",
    logLevel: "silent",
    plugins: [
      {
        name: "browser-worker-api-self-contained",
        setup(build) {
          build.onResolve(
            { filter: /^[^./]/ },
            ({ path: specifier, importer, kind }) => {
              if (kind === "entry-point") return undefined;
              packageImports.push(`${importer} imports ${specifier}`);
              return { path: specifier, external: true };
            },
          );
        },
      },
    ],
  });
  if (packageImports.length > 0) throw selfContainedError(packageImports);
  const [output] = result.outputFiles;
  if (!output || result.outputFiles.length !== 1) {
    throw new Error("Bundling the Node REPL browser API failed.");
  }
  return output.text;
};

const bundleBrowserWorkerApi = async (): Promise<string> => {
  const bun = (globalThis as typeof globalThis & { Bun?: typeof Bun }).Bun;
  const code = bun ? await bundleWithBun(bun) : await bundleWithEsbuild();
  return `(() => {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports.installBrowserWorkerApi;\n})()`;
};

const bundled: Readonly<{ source: string } | { error: unknown }> =
  await bundleBrowserWorkerApi().then(
    (source) => ({ source }),
    (error: unknown) => ({ error }),
  );

export const browserWorkerApiSource = (): string => {
  if ("error" in bundled) throw bundled.error;
  return bundled.source;
};
