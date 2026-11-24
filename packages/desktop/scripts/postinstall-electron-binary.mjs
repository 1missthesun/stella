import { ensureElectronBinary } from "./ensure-electron-binary.mjs";

try {
  await ensureElectronBinary();
} catch (error) {
  console.error(
    `[postinstall-electron-binary] Failed to repair Electron binary: ${error instanceof Error ? error.message : String(error)}`,
  );
}
