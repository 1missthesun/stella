import path from "node:path";

export const BUNDLE_SCRIPT_PREFIX = "/@bundle/";

export const bundlesDirIn = (cacheDir: string) => path.join(cacheDir, "bundles");
