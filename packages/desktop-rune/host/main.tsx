// Entry of the TS host, spawned by the compiled Rune engine, which owns the bridge fds
// (host/ELEMENTS.md); all logging goes to stderr. Runs the host bundle while it matches the
// sources (services/host-bundle.ts), else host/app.tsx from source. Only the stdio redirect and
// the Bun version guard load statically: on a wrong Bun the rest may fail to link.

import "./services/stdio";
import "./services/bun-guard";
import path from "node:path";

const { defineAppRoot } = await import("../../../scripts/lib/module-paths.mjs");
const { bootMark } = await import("./services/boot-trace");
const { currentHostBundle } = await import("./services/host-bundle");
const { pinReactBuild } = await import("./services/ui-mode");

bootMark("host-start");
pinReactBuild();
// The host and UI bundles' paths are relative to the app folder they run from
// (scripts/lib/module-paths.mjs): they may have been built in another folder.
defineAppRoot(path.resolve(import.meta.dir, "../../.."));
type Host = typeof import("./app");
const fromBundle = (file: string): Host | null => {
  try {
    return require(file) as Host;
  } catch (error) {
    console.error("[host] host bundle failed to load, running the sources:", error);
    return null;
  }
};

const bundle = await currentHostBundle();
const bundled = bundle ? fromBundle(bundle) : null;
const host = bundled ?? (await import("./app"));
bootMark(bundled ? "host-bundle-loaded" : "host-source-loaded");
await host.runHost({ bundled: !!bundled });
