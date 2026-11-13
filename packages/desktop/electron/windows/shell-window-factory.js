import fs from 'fs';
import path from 'path';
import { loadWindow } from './window-load.js';
import { installContextMenu } from '../services/context-menu-service.js';
const shouldOpenDevTools = process.env.STELLA_OPEN_DEVTOOLS === '1';
const loadShellMainWindow = (window, options) => {
    loadWindow(window, { mode: options.mode });
};
export const createShellWindow = (options) => {
    const window = options.createWindow();
    options.setupExternalLinkHandlers(window);
    installContextMenu(window.webContents, { askRenderer: true });
    if (shouldOpenDevTools) {
        window.webContents.openDevTools();
    }
    window.webContents.on('did-start-loading', () => {
        options.onDidStartLoading?.();
    });
    window.webContents.on('did-finish-load', () => {
        options.onDidFinishLoad?.();
    });
    window.webContents.on('render-process-gone', (_event, details) => {
        options.onRenderProcessGone?.(details, window);
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        options.onDidFailLoad?.({
            errorCode,
            errorDescription,
            validatedURL,
            isMainFrame,
        }, window);
    });
    window.on('unresponsive', () => {
        options.onUnresponsive?.(window);
    });
    window.on('responsive', () => {
        options.onResponsive?.(window);
    });
    window.on('closed', () => {
        options.onClosed?.(window);
    });
    loadShellMainWindow(window, options);
    return window;
};
export const reloadShellMainWindow = (window, options) => {
    if (!window || window.isDestroyed()) {
        return;
    }
    loadShellMainWindow(window, options);
};
const resolveRecoveryHtmlPath = (electronDir) => {
    const candidates = [
        path.join(electronDir, 'recovery.html'),
        path.resolve(electronDir, '../../electron/recovery.html'),
    ];
    for (const candidate of candidates) {
        try {
            if (fs.statSync(candidate).isFile()) {
                return candidate;
            }
        }
        catch {
            /* try next */
        }
    }
    return null;
};
/**
 * Loads the recovery surface into a window. Reads `recovery.html` from disk
 * and serves it via a `data:` URL so we never have to do a `file://`
 * navigation from an `http://` (dev) origin — Chromium blocks that as
 * "Not allowed to load local resource", which used to leave the window blank.
 */
// The exact recovery page URL each window was given, so its Reload button can
// be trusted: it runs from a data: URL, not the app origin that privileged
// IPC normally requires.
const recoverySurfaceUrls = new WeakMap();
export const isShellRecoverySurface = (event) => {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    if (!sender || !frame || frame !== sender.mainFrame)
        return false;
    const url = recoverySurfaceUrls.get(sender);
    return Boolean(url) && frame.url === url;
};
export const loadShellRecoveryPage = (window, electronDir) => {
    if (!window || window.isDestroyed()) {
        return;
    }
    const recoveryPath = resolveRecoveryHtmlPath(electronDir);
    if (!recoveryPath) {
        console.error('[recovery] Could not locate recovery.html relative to', electronDir);
        return;
    }
    try {
        const html = fs.readFileSync(recoveryPath, 'utf-8');
        const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf-8').toString('base64')}`;
        recoverySurfaceUrls.set(window.webContents, dataUrl);
        void window.loadURL(dataUrl);
    }
    catch (error) {
        console.error('[recovery] Failed to load recovery surface:', error);
    }
};
