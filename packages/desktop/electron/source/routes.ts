import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RouteTools } from "./tools.js";

/**
 * Keeps `src/routeTree.gen.ts` in step with `src/routes`, as the TanStack
 * router plugin did inside Vite. The generator only rewrites the file when
 * the tree changes.
 */
export const createRouteTreeGenerator = (
  loadTools: () => Promise<RouteTools>,
  uiRoot: string,
  cacheDir?: string,
) => {
  const configFile = path.join(uiRoot, "tsr.config.json");
  const inline = JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
  const routesDirectory = path.resolve(
    uiRoot,
    typeof inline.routesDirectory === "string" ? inline.routesDirectory : "./src/routes",
  );
  const routeTreeFile = path.resolve(
    uiRoot,
    typeof inline.generatedRouteTree === "string" ? inline.generatedRouteTree : "./src/routeTree.gen.ts",
  );
  const signatureFile = cacheDir
    ? path.join(cacheDir, "routes", `${createHash("sha256").update(uiRoot).digest("hex").slice(0, 16)}.json`)
    : null;
  let generator: InstanceType<RouteTools["RouteGenerator"]> | null = null;

  const signature = async (): Promise<string> => {
    const parts: string[] = [];
    const stamp = async (file: string) => {
      const stats = await fs.promises.stat(file).catch(() => null);
      parts.push(`${file}\0${stats ? `${stats.mtimeMs}:${stats.size}` : "-"}`);
    };
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      await stamp(dir);
      await Promise.all(
        entries.map((entry) => {
          const file = path.join(dir, entry.name);
          return entry.isDirectory() ? walk(file) : stamp(file);
        }),
      );
    };
    await Promise.all([walk(routesDirectory), stamp(configFile), stamp(routeTreeFile)]);
    return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
  };

  const generate = async (event?: { path: string; type: "create" | "update" | "delete" }) => {
    if (!generator) {
      const tools = await loadTools();
      generator = new tools.RouteGenerator({ config: tools.getRouteConfig(inline, uiRoot), root: uiRoot });
    }
    await generator.run(event);
  };

  return {
    routesDirectory,
    routeTreeFile,
    run: async (event?: { path: string; type: "create" | "update" | "delete" }) => {
      if (!signatureFile) return generate(event);
      const before = await signature();
      const stored = await fs.promises.readFile(signatureFile, "utf8").catch(() => null);
      if (stored === before) return;
      await generate(event);
      const after = await signature();
      await fs.promises.mkdir(path.dirname(signatureFile), { recursive: true });
      await fs.promises.writeFile(signatureFile, after);
    },
  };
};
