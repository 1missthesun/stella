// Runs the host's services without an engine or UI: Electron main under the shim, the runtime
// worker, and the app window's `electronAPI` on a local control port. For scripted checks
// (sign-in, chat) and memory measurements.

import "./stdio";
import { bootElectronMain } from "./electron-main";
import { firstAppWindow, rendererApiFor } from "./renderer-api";
import { startControlServer } from "./control";

await bootElectronMain({ exit: (code) => process.exit(code) });
const win = await firstAppWindow();
const api = rendererApiFor(win.webContents);
console.error(`[headless] app window ${win.hostId} (${win.webContents.getURL()})`);
startControlServer({ api, port: Number(process.env.STELLA_RUNE_CTL_PORT ?? 0) });
