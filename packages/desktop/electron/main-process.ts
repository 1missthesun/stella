import { app } from "electron";
import { configureLinuxGraphics } from "./linux-graphics.js";
import { configureLinuxProtectedStorage } from "./linux-protected-storage.js";
import { configureScrollCompositing } from "./scroll-compositing.js";
import { configureDevHarnessProtectedStorage } from "./bootstrap/dev-harness-protected-storage.js";
import { registerRendererScheme } from "./source/renderer-protocol.js";
import { guardCanvasFrames } from "./source/canvas-protocol.js";
import { guardWorkspaceAppFrames } from "./source/workspace-app-frames.js";
import { configureBrowserBridgeNamespace } from "./services/stella-browser-bridge-namespace.js";

configureBrowserBridgeNamespace({ isPackaged: app.isPackaged });

registerRendererScheme();
guardCanvasFrames();
guardWorkspaceAppFrames();
configureLinuxGraphics({
  commandLine: app.commandLine,
});
configureScrollCompositing({
  commandLine: app.commandLine,
});
const devHarnessProtectedStorage = configureDevHarnessProtectedStorage({
  isPackaged: app.isPackaged,
});
if (!devHarnessProtectedStorage) {
  configureLinuxProtectedStorage({ commandLine: app.commandLine });
}

const main = async () => {
  const { bootstrapMainProcess } = await import("./bootstrap.js");
  bootstrapMainProcess();
};

void main().catch((error) => {
  console.error(error);
  app.exit(1);
});
