import { app, BrowserWindow } from 'electron';
import { FullWindowController } from './full-window.js';
import { getMainLogger } from '../observability/main-logger.js';
import { RendererHealthMonitor } from '../observability/renderer-health.js';
const TRANSIENT_NET_ERROR_CODES = new Set([
    -3, -7, -21, -100, -101, -102, -103, -104, -105, -106, -118,
]);
const isTransientNetError = (errorCode) => TRANSIENT_NET_ERROR_CODES.has(errorCode);
const shouldRecoverFromDidFailLoad = (details) => {
    if (!details.isMainFrame)
        return false;
    if (details.validatedURL.includes('recovery.html'))
        return false;
    if (isTransientNetError(details.errorCode))
        return false;
    return true;
};
const TRANSIENT_RELOAD_MAX_ATTEMPTS = 4;
const TRANSIENT_RELOAD_BASE_DELAY_MS = 350;
const RELOAD_RETRY_RESET_MS = 5_000;
const UNRESPONSIVE_RECOVERY_THRESHOLD_MS = 10_000;
// When the window's renderer dies (crash, OOM, or killed because it hung),
// load a fresh one instead of leaving a dead window. More exits than this
// within the window below means it keeps dying: show the recovery page.
const RENDERER_AUTO_RELOAD_MAX = 2;
const RENDERER_AUTO_RELOAD_WINDOW_MS = 5 * 60_000;
const RENDERER_AUTO_RELOAD_DELAY_MS = 500;
export class WindowManager {
    options;
    fullWindowController;
    observedWindows = new WeakSet();
    transientReloadState = null;
    unresponsiveTimer = null;
    rendererExits = [];
    rendererHealth;
    constructor(options) {
        this.options = options;
        this.rendererHealth = new RendererHealthMonitor(() => ({
            focused: this.isWindowFocused(),
            visible: this.isWindowVisible(),
        }));
        this.fullWindowController = new FullWindowController({
            electronDir: options.electronDir,
            preloadPath: options.preloadPath,
            sessionPartition: options.sessionPartition,
            setupExternalLinkHandlers: (window) => options.externalLinkService.setupExternalLinkHandlers(window),
            onDidFinishLoad: () => {
                this.resetTransientReloadStateOnSuccess();
            },
            onRenderProcessGone: (details) => {
                console.error('Renderer process gone:', details.reason);
                this.cancelUnresponsiveWatchdog();
                this.handleRendererGone(details);
            },
            onDidFailLoad: (details) => {
                if (this.handleTransientReload(details)) {
                    return;
                }
                if (!shouldRecoverFromDidFailLoad(details)) {
                    return;
                }
                console.error('Renderer failed to load:', details.errorCode, details.errorDescription, details.validatedURL);
                this.fullWindowController.loadRecoveryPage();
            },
            onUnresponsive: () => {
                this.armUnresponsiveWatchdog();
            },
            onResponsive: () => {
                this.cancelUnresponsiveWatchdog();
            },
            onClosed: () => {
                this.cancelTransientReload();
                this.cancelUnresponsiveWatchdog();
            },
        });
    }
    handleTransientReload(details) {
        if (!details.isMainFrame || !isTransientNetError(details.errorCode)) {
            return false;
        }
        if (details.validatedURL.includes('recovery.html'))
            return false;
        if (details.errorCode === -3)
            return true;
        const now = Date.now();
        const previous = this.transientReloadState;
        const attemptsSoFar = previous && now - previous.lastFailureAtMs < RELOAD_RETRY_RESET_MS
            ? previous.attempts
            : 0;
        const nextAttempt = attemptsSoFar + 1;
        if (nextAttempt > TRANSIENT_RELOAD_MAX_ATTEMPTS) {
            this.cancelTransientReload();
            return false;
        }
        if (previous?.scheduledTimer) {
            clearTimeout(previous.scheduledTimer);
        }
        const delayMs = TRANSIENT_RELOAD_BASE_DELAY_MS * nextAttempt;
        console.warn(`[reload] full transient ${details.errorCode} on ${details.validatedURL}; retry ${nextAttempt}/${TRANSIENT_RELOAD_MAX_ATTEMPTS} in ${delayMs}ms`);
        const scheduledTimer = setTimeout(() => {
            if (this.transientReloadState) {
                this.transientReloadState.scheduledTimer = null;
            }
            this.fullWindowController.reloadMainWindow();
        }, delayMs);
        this.transientReloadState = {
            attempts: nextAttempt,
            lastFailureAtMs: now,
            scheduledTimer,
        };
        return true;
    }
    resetTransientReloadStateOnSuccess() {
        if (this.transientReloadState?.scheduledTimer) {
            clearTimeout(this.transientReloadState.scheduledTimer);
        }
        this.transientReloadState = null;
    }
    cancelTransientReload() {
        if (this.transientReloadState?.scheduledTimer) {
            clearTimeout(this.transientReloadState.scheduledTimer);
        }
        this.transientReloadState = null;
    }
    armUnresponsiveWatchdog() {
        if (this.unresponsiveTimer)
            return;
        console.warn(`[unresponsive] renderer stopped responding; recovering in ${UNRESPONSIVE_RECOVERY_THRESHOLD_MS}ms if it doesn't recover`);
        getMainLogger()?.error('main.renderer-unresponsive', {
            mode: 'full',
            recoverInMs: UNRESPONSIVE_RECOVERY_THRESHOLD_MS,
        });
        this.unresponsiveTimer = setTimeout(() => {
            this.unresponsiveTimer = null;
            console.error(`[unresponsive] renderer still unresponsive after ${UNRESPONSIVE_RECOVERY_THRESHOLD_MS}ms; forcing recovery surface`);
            getMainLogger()?.error('main.renderer-recovery-forced', {
                mode: 'full',
                afterMs: UNRESPONSIVE_RECOVERY_THRESHOLD_MS,
            });
            this.fullWindowController.loadRecoveryPage();
        }, UNRESPONSIVE_RECOVERY_THRESHOLD_MS);
    }
    handleRendererGone(details) {
        const health = this.rendererHealth.snapshot();
        this.rendererHealth.resetProbe();
        if (this.options.isQuitting?.())
            return;
        const now = Date.now();
        this.rendererExits = this.rendererExits.filter((at) => now - at < RENDERER_AUTO_RELOAD_WINDOW_MS);
        this.rendererExits.push(now);
        const reload = details.reason !== 'launch-failed' &&
            details.reason !== 'integrity-failure' &&
            this.rendererExits.length <= RENDERER_AUTO_RELOAD_MAX;
        getMainLogger()?.error('main.renderer-gone', {
            mode: 'full',
            reason: details.reason,
            exitCode: details.exitCode,
            recovery: reload ? 'reload' : 'recovery-page',
            exitsLast5m: this.rendererExits.length,
            ...health,
        });
        if (!reload) {
            this.fullWindowController.loadRecoveryPage();
            return;
        }
        setTimeout(() => {
            const window = this.getFullWindow();
            if (!window || window.isDestroyed())
                return;
            console.warn(`[recovery] renderer ${details.reason}; loading a fresh one`);
            this.fullWindowController.reloadMainWindow();
        }, RENDERER_AUTO_RELOAD_DELAY_MS);
    }
    cancelUnresponsiveWatchdog() {
        if (!this.unresponsiveTimer)
            return;
        clearTimeout(this.unresponsiveTimer);
        this.unresponsiveTimer = null;
    }
    createFullWindow(createOptions) {
        const window = this.fullWindowController.create(createOptions);
        this.observeFullWindow(window);
        this.rendererHealth.attach(window.webContents);
        return window;
    }
    ensureFullWindow(options) {
        return this.createFullWindow(options);
    }
    createInitialWindows(createOptions) {
        this.createFullWindow(createOptions);
    }
    getFullWindow() {
        return this.fullWindowController.getWindow();
    }
    getAllWindows() {
        return BrowserWindow.getAllWindows();
    }
    isWindowFocused() {
        const window = this.getFullWindow();
        return Boolean(window && !window.isDestroyed() && window.isFocused());
    }
    isWindowVisible() {
        const window = this.getFullWindow();
        return Boolean(window && !window.isDestroyed() && window.isVisible());
    }
    minimizeWindow() {
        const window = this.getFullWindow();
        if (!window || window.isDestroyed())
            return;
        this.hideWindow(window);
    }
    restoreWindowVisibility() {
        const window = this.getFullWindow();
        if (!window || window.isDestroyed())
            return;
        if (window.isMinimized()) {
            window.restore();
        }
        if (!window.isVisible()) {
            window.showInactive();
        }
    }
    restoreFullSize() {
        this.showWindow();
    }
    hideWindow(window, options) {
        const preserveExternalFocus = options?.preserveExternalFocus ?? false;
        const wasFocused = preserveExternalFocus && window.isFocused();
        if (wasFocused) {
            window.blur();
            window.setFocusable(false);
        }
        window.hide();
        if (wasFocused && !window.isDestroyed()) {
            window.setFocusable(true);
        }
    }
    focusAndRaise(window) {
        if (process.platform === 'win32') {
            const alreadyForeground = window.isFocused();
            app.focus({ steal: true });
            window.show();
            window.moveTop();
            if (alreadyForeground) {
                window.focus();
            }
            else {
                window.setAlwaysOnTop(true, 'screen-saver');
                window.focus();
                setTimeout(() => {
                    if (!window.isDestroyed()) {
                        window.setAlwaysOnTop(false);
                    }
                }, 75);
            }
            return;
        }
        app.focus({ steal: true });
        window.show();
        window.moveTop();
        window.focus();
    }
    observeFullWindow(window) {
        if (this.observedWindows.has(window))
            return;
        this.observedWindows.add(window);
        window.on('close', (event) => {
            if (process.platform !== 'win32' || this.options.isQuitting?.())
                return;
            event.preventDefault();
            this.hideWindow(window);
            this.options.onMinimizeFullToTray?.();
        });
    }
    showWindow() {
        const window = this.createFullWindow();
        if (window.isMinimized()) {
            window.restore();
        }
        this.focusAndRaise(window);
    }
    reloadFullWindow() {
        this.fullWindowController.reloadMainWindow();
    }
    onActivate() {
        if (BrowserWindow.getAllWindows().length === 0) {
            this.createInitialWindows();
            return;
        }
        this.showWindow();
    }
}
