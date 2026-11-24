import path from "node:path";

/** What a bundled script is called in stack traces. */
export const BUNDLE_SCRIPT_PREFIX = "/@bundle/";

export const bundlesDirIn = (cacheDir: string) => path.join(cacheDir, "bundles");
