import { clipboard, ClipboardItem, nativeImage } from "electron";
import { callRuntimeAppService } from "../services/runtime-app-services.js";
import { IPC_CLIPBOARD_WRITE_TEXT, IPC_MEDIA_COPY_ATTACHMENT, IPC_MEDIA_COPY_IMAGE, IPC_MEDIA_SAVE_OUTPUT, } from "@stella/contracts/desktop/ipc-channels";
import {
  handleIpc,
} from "./typed-ipc.js";
const writeImageToClipboard = (image) => clipboard.write([
    new ClipboardItem({
        "image/png": new Blob([image.toPNG()], { type: "image/png" }),
    }),
]);
export const registerBrowserHandlers = (options) => {
    handleIpc(IPC_MEDIA_SAVE_OUTPUT, async (event, payload) => {
        if (!options.assertPrivilegedSender(event, IPC_MEDIA_SAVE_OUTPUT)) {
            return { ok: false, error: "Blocked untrusted request." };
        }
        const stellaDataDir = options.getStellaDataDir();
        if (!stellaDataDir) {
            return { ok: false, error: "Stella root not initialized" };
        }
        try {
            return await callRuntimeAppService("saveMediaOutput", {
                url: payload?.url,
                fileName: payload?.fileName,
                kind: payload?.kind,
            });
        }
        catch (error) {
            return { ok: false, error: error.message };
        }
    });
    // The page's own clipboard API refuses a write that doesn't follow a click
    // within a few seconds (a link fetched first, a native menu item), so the
    // app's text copies go through here.
    handleIpc(IPC_CLIPBOARD_WRITE_TEXT, (event, payload) => {
        if (!options.assertPrivilegedSender(event, IPC_CLIPBOARD_WRITE_TEXT)) {
            return { ok: false, error: "Blocked untrusted request." };
        }
        const text = typeof payload?.text === "string" ? payload.text : "";
        if (!text) {
            return { ok: false, error: "Nothing to copy." };
        }
        try {
            clipboard.writeText(text);
            return { ok: true };
        }
        catch (error) {
            return { ok: false, error: error.message };
        }
    });
    handleIpc(IPC_MEDIA_COPY_IMAGE, async (event, payload) => {
        if (!options.assertPrivilegedSender(event, IPC_MEDIA_COPY_IMAGE)) {
            return { ok: false, error: "Blocked untrusted request." };
        }
        try {
            const image = nativeImage.createFromBuffer(Buffer.from(payload.pngBase64, "base64"));
            if (image.isEmpty()) {
                return { ok: false, error: "Could not read image." };
            }
            await writeImageToClipboard(image);
            return { ok: true };
        }
        catch (error) {
            return { ok: false, error: error.message };
        }
    });
    // Copy a sent message's attachment to the clipboard. Images go on as a
    // real image (built from the on-disk path, falling back to a data URL);
    // everything else falls back to writing the file path as text — Electron
    // exposes no cross-platform "put a file object on the clipboard" API, so
    // a path-as-text drop is the least-surprising, most-portable behavior.
    handleIpc(IPC_MEDIA_COPY_ATTACHMENT, async (event, payload) => {
        if (!options.assertPrivilegedSender(event, IPC_MEDIA_COPY_ATTACHMENT)) {
            return { ok: false, error: "Blocked untrusted request." };
        }
        try {
            const url = typeof payload?.url === "string" ? payload.url : "";
            const explicitPath =
                typeof payload?.path === "string" ? payload.path : "";
            const mimeType =
                typeof payload?.mimeType === "string" ? payload.mimeType : "";
            const kind = typeof payload?.kind === "string" ? payload.kind : "";
            const dataUrl = url.startsWith("data:") ? url : "";
            const filePath =
                explicitPath ||
                (url && !dataUrl && !/^https?:\/\//i.test(url) ? url : "");
            const looksImage =
                mimeType.startsWith("image/") ||
                dataUrl.startsWith("data:image/") ||
                (kind !== "file" && !mimeType);
            if (looksImage) {
                let image = null;
                if (filePath) {
                    image = nativeImage.createFromPath(filePath);
                }
                if ((!image || image.isEmpty()) && dataUrl) {
                    image = nativeImage.createFromDataURL(dataUrl);
                }
                if (image && !image.isEmpty()) {
                    await writeImageToClipboard(image);
                    return { ok: true, mode: "image" };
                }
            }
            if (filePath) {
                await clipboard.writeText(filePath);
                return { ok: true, mode: "path" };
            }
            return { ok: false, error: "No copyable attachment content." };
        }
        catch (error) {
            return { ok: false, error: error.message };
        }
    });
};
