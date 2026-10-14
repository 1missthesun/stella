import { ensureElectronBundlesFresh } from "../scripts/dev-electron-build.mjs";

const start = async () => {
  await ensureElectronBundlesFresh({
    log: (message) => console.log(`[electron-build] ${message}`),
  });
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
