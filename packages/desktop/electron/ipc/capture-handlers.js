import { openMacPermissionSettings } from "../utils/macos-permission-settings.js";
import { hasMacPermission, requestMacPermission, } from "../utils/macos-permissions.js";
import {
  IPC_CHAT_CONTEXT_GET,
  IPC_CHAT_CONTEXT_SET,
  IPC_CHAT_CONTEXT_REMOVE_SCREENSHOT,
  IPC_REGION_SELECT,
  IPC_REGION_COMMIT_PREPARED,
  IPC_REGION_CANCEL,
  IPC_REGION_PREPARE_SELECTION,
  IPC_REGION_GET_WINDOW_CAPTURE,
  IPC_REGION_CLICK,
  IPC_SCREENSHOT_CAPTURE,
  IPC_CAPTURE_BEGIN_REGION_CAPTURE,
} from "@stella/contracts/desktop/ipc-channels";
import {
  registerPrivilegedHandle,
  onPrivilegedIpc,
} from "./privileged-ipc.js";
export const registerCaptureHandlers = (options) => {
    const ensureScreenCapturePermission = async () => {
        if (process.platform !== "darwin") {
            return true;
        }
        if (hasMacPermission("screen", false)) {
            return true;
        }
        const result = await requestMacPermission("screen");
        if (result.granted) {
            return true;
        }
        await openMacPermissionSettings("screen");
        return false;
    };
    registerPrivilegedHandle(options, IPC_CHAT_CONTEXT_GET, () => options.captureService.getChatContextSnapshot());
    onPrivilegedIpc(options, IPC_CHAT_CONTEXT_SET, (_event, context) => {
        options.captureService.setPendingChatContext(context ?? null);
        options.captureService.broadcastChatContext();
    });
    onPrivilegedIpc(options, IPC_CHAT_CONTEXT_REMOVE_SCREENSHOT, (_event, index) => {
        options.captureService.removeScreenshot(index);
        options.captureService.broadcastChatContext();
    });
    onPrivilegedIpc(options, IPC_REGION_SELECT, (_event, selection) => {
        void options.captureService.finalizeRegionCapture(selection);
    });
    onPrivilegedIpc(options, IPC_REGION_COMMIT_PREPARED, (_event, result) => {
        options.captureService.commitPreparedRegionCapture(result);
    });
    onPrivilegedIpc(options, IPC_REGION_CANCEL, () => {
        options.captureService.cancelRegionCapture();
    });
    registerPrivilegedHandle(options, IPC_REGION_PREPARE_SELECTION, async (_event, selection) => {
        if (!(await ensureScreenCapturePermission())) {
            return null;
        }
        return options.captureService.prepareRegionSelection(selection);
    });
    registerPrivilegedHandle(options, IPC_REGION_GET_WINDOW_CAPTURE, async (_event, point) => {
        if (!(await ensureScreenCapturePermission())) {
            return null;
        }
        return options.captureService.getRegionWindowCapture(point);
    });
    onPrivilegedIpc(options, IPC_REGION_CLICK, async (_event, point) => {
        await options.captureService.handleRegionClick(point);
    });
    registerPrivilegedHandle(options, IPC_SCREENSHOT_CAPTURE, async (event, point) => {
        if (!(await ensureScreenCapturePermission())) {
            return null;
        }
        return options.captureService.captureScreenshot(point);
    });
    registerPrivilegedHandle(options, IPC_CAPTURE_BEGIN_REGION_CAPTURE, async (event) => {
        if (!(await ensureScreenCapturePermission())) {
            return { cancelled: true };
        }
        const wm = options.windowManager;
        const targetWindowWasVisible = wm.isWindowVisible();
        const targetWindowWasFocused = wm.isWindowFocused();
        wm.minimizeWindow();
        const result = await options.captureService.startRegionCapture();
        options.captureService.commitRegionCaptureResult(result);
        if (result !== null || targetWindowWasFocused) {
            wm.showWindow();
        }
        else if (targetWindowWasVisible) {
            wm.restoreWindowVisibility();
        }
        return result === null
            ? { cancelled: true }
            : { ok: true };
    });
};
