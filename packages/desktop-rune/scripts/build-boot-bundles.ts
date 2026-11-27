// Builds the host and UI boot bundles (.cache/host, .cache/ui; HOST.md "Boot bundles") without
// starting the app, as the first boot from source would. scripts/build-app-bundle.mjs runs it so
// a first install opens from them. Run with the Bun and environment the app will run with: the
// UI bundle's key holds the VITE_ environment (the launcher's backend) and the UI build mode.
//
//   bun packages/desktop-rune/scripts/build-boot-bundles.ts

import path from "node:path";
import type { UiBuildReply, UiBuildRequest } from "../host/services/ui-build-child";
import { appUiSpec } from "../host/services/app-ui-spec";
import { currentHostBundle } from "../host/services/host-bundle";
import { validUiCache } from "../host/services/ui-cache";
import { applyUiEnv } from "../host/services/ui-env";
import { uiBuildMode } from "../host/services/ui-mode";

const SERVICES = path.resolve(import.meta.dir, "../host/services");
const fail = (message: string): never => {
  console.error(`[boot-bundles] ${message}`);
  process.exit(1);
};

applyUiEnv();
const started = performance.now();
const host = Bun.spawn([process.execPath, path.join(SERVICES, "host-bundle-build.ts")], {
  cwd: SERVICES,
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
});

const spec = appUiSpec();
let nextId = 0;
const pending = new Map<number, (reply: UiBuildReply) => void>();
let ready!: () => void;
const childReady = new Promise<void>((resolve) => (ready = resolve));
const child = Bun.spawn([process.execPath, path.join(SERVICES, "ui-build-child.ts")], {
  cwd: spec.dir,
  env: { ...process.env, NODE_ENV: uiBuildMode() },
  stdio: ["ignore", "ignore", "inherit"],
  ipc(reply: UiBuildReply) {
    if (reply.id === 0) return ready();
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  },
});
const ask = (request: Omit<UiBuildRequest, "id" | "entry" | "tsconfig" | "external">) =>
  new Promise<UiBuildReply>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.send({ id, entry: spec.entry, tsconfig: spec.tsconfig, external: spec.external, ...request } satisfies UiBuildRequest);
  });
await childReady;
// The boot build first, as boot does: its inputs are what the boot bundle is checked against.
const built = await ask({ cache: true });
if (!built.ok || !built.inputs) fail(`the UI did not build: ${built.ok ? "no inputs" : built.error}`);
await ask({ writeCache: built.ok ? built.inputs! : [] });
child.kill();

if ((await host.exited) !== 0) fail("the host bundle did not build");
if (!(await currentHostBundle())) fail("the host bundle is not current after its build");
if (!(await validUiCache())) fail("the UI boot bundle is not current after its build");
console.error(`[boot-bundles] host and UI boot bundles built in ${((performance.now() - started) / 1000).toFixed(1)}s`);
process.exit(0);
