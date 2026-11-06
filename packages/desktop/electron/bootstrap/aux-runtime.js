import { createStellaBrowserBridgeResource } from "../process-resources/browser-bridge-resource.js";
import { broadcastStellaBrowserBridgeStatus, broadcastToWindows, } from "./context.js";
import { IPC_BROWSER_EXTENSION_CLIENTS_CHANGED } from "@stella/contracts/desktop/ipc-channels";
export const startStellaBrowserBridge = (context) => {
    if (context.state.stellaBrowserBridgeService) {
        context.state.stellaBrowserBridgeService.start();
        return;
    }
    const service = createStellaBrowserBridgeResource({
        stellaAppDir: context.config.stellaAppDir,
        stellaDataDir: context.state.stellaDataDirPath ?? context.config.stellaDataDirPath,
        processRuntime: context.state.processRuntime,
        onStatus: (status) => {
            broadcastStellaBrowserBridgeStatus(context, status);
        },
        onExtensionLinkChanged: (link) => {
            context.state.inAppBrowserService?.noteExtensionLink(link.connected);
            broadcastToWindows(context, IPC_BROWSER_EXTENSION_CLIENTS_CHANGED, link.clients);
        },
    });
    context.state.stellaBrowserBridgeService = service;
    service.start();
};
