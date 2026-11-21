import {
  ensureElectronBundlesFresh,
  pruneStaleMainChunks,
} from "../scripts/dev-electron-build.mjs";

const start = async () => {
  await ensureElectronBundlesFresh({
    log: (message) => console.log(`[electron-build] ${message}`),
  });
  try {
    pruneStaleMainChunks();
  } catch {
    // Leftover chunks only take disk space; never hold the launch for them.
  }
  await import("../dist-electron/electron/launch.js");
};

if (process.env.STELLA_LAUNCHER === "1") {
  try {
    await start();
  } catch (error) {
    console.error("[start] Stella failed to start:", error);
    process.exit(1);
  }
} else {
  await start();
}
