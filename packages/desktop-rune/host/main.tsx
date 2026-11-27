// Entry of the TS host, spawned by the compiled Rune engine, which owns the bridge fds
// (host/ELEMENTS.md); all logging goes to stderr. Runs the host bundle while it matches the
// sources (services/host-bundle.ts), else host/app.tsx from source.

import "./services/stdio";
import { bootMark } from "./services/boot-trace";
import { currentHostBundle } from "./services/host-bundle";
import { pinReactBuild } from "./services/ui-mode";

bootMark("host-start");
pinReactBuild();
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
