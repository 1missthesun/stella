import { createRequire } from 'node:module';
import { areGlobalShortcutsSuspended } from '../ipc/global-shortcuts.js';
const requireFromMain = createRequire(import.meta.url);
let uiohookInstance = null;
const getUiohook = () => {
    uiohookInstance ??= requireFromMain('uiohook-napi').uIOhook;
    return uiohookInstance;
};
const LEFT_ALT = 56;
const RIGHT_ALT = 3640;
const ALT_KEYCODES = new Set([LEFT_ALT, RIGHT_ALT]);
const ALT_TAP_MAX_MS = 400;
const CAPTURE_EVENT_TYPES = ['mousemove', 'mousedown', 'mouseup', 'wheel', 'keydown', 'keyup'];
export class MouseHookManager {
    started = false;
    disposed = false;
    uiohookListenersAttached = false;
    uiohookStarted = false;
    pressedKeycodes = new Set();
    altDownAt = null;
    handlers = null;
    captureListener = null;
    captureHookStarted = false;
    setDictationTapHandlers(handlers) {
        this.handlers = handlers;
    }
    /**
     * Every pointer and key event, for Show Stella's timeline. Starts the hook
     * when nothing else has; returns false when it can't run.
     */
    subscribeCapture(listener) {
        if (this.disposed)
            return false;
        const uiohook = getUiohook();
        this.captureListener = listener;
        for (const type of CAPTURE_EVENT_TYPES) {
            uiohook.on(type, this.captureHandlers[type]);
        }
        if (!this.uiohookStarted) {
            try {
                uiohook.start();
                this.uiohookStarted = true;
                this.captureHookStarted = true;
            }
            catch (error) {
                console.error('[mouse-hook] Failed to start input hook for capture:', error.message);
                this.unsubscribeCapture();
                return false;
            }
        }
        return true;
    }
    unsubscribeCapture() {
        if (!this.captureListener && !this.captureHookStarted)
            return;
        this.captureListener = null;
        const uiohook = getUiohook();
        for (const type of CAPTURE_EVENT_TYPES) {
            uiohook.off(type, this.captureHandlers[type]);
        }
        if (this.captureHookStarted && !this.started) {
            try {
                uiohook.stop();
            }
            catch (error) {
                console.warn('[mouse-hook] Failed to stop input hook:', error.message);
            }
            this.uiohookStarted = false;
        }
        this.captureHookStarted = false;
    }
    captureHandlers = Object.fromEntries(CAPTURE_EVENT_TYPES.map((type) => [
        type,
        (event) => this.captureListener?.(type, event),
    ]));
    start() {
        if (this.started || this.disposed)
            return;
        this.started = true;
        this.captureHookStarted = false;
        try {
            this.attachUiohookListeners();
            if (!this.uiohookStarted) {
                getUiohook().start();
                this.uiohookStarted = true;
            }
        }
        catch (error) {
            console.error('[mouse-hook] Failed to start input hook:', error.message);
        }
    }
    stop() {
        if (!this.started && !this.uiohookStarted && !this.uiohookListenersAttached)
            return;
        this.started = false;
        if (this.captureListener) {
            this.altDownAt = null;
            this.pressedKeycodes.clear();
            this.detachUiohookListeners();
            this.captureHookStarted = this.uiohookStarted;
            return;
        }
        this.altDownAt = null;
        this.pressedKeycodes.clear();
        this.detachUiohookListeners();
        if (this.uiohookStarted) {
            try {
                getUiohook().stop();
            }
            catch (error) {
                console.warn('[mouse-hook] Failed to stop input hook:', error.message);
            }
            this.uiohookStarted = false;
        }
    }
    dispose() {
        this.disposed = true;
        this.unsubscribeCapture();
        this.stop();
    }
    isHookRunning() {
        return this.uiohookStarted;
    }
    attachUiohookListeners() {
        if (this.uiohookListenersAttached)
            return;
        const uiohook = getUiohook();
        this.uiohookListenersAttached = true;
        uiohook.on('keydown', this.handleKeydown);
        uiohook.on('keyup', this.handleKeyup);
        uiohook.on('mousedown', this.handleMousedown);
    }
    detachUiohookListeners() {
        if (!this.uiohookListenersAttached)
            return;
        this.uiohookListenersAttached = false;
        const uiohook = getUiohook();
        uiohook.off('keydown', this.handleKeydown);
        uiohook.off('keyup', this.handleKeyup);
        uiohook.off('mousedown', this.handleMousedown);
    }
    handleKeydown = (event) => {
        if (!this.started)
            return;
        if (areGlobalShortcutsSuspended()) {
            this.altDownAt = null;
            this.pressedKeycodes.clear();
            return;
        }
        const wasAlreadyDown = this.pressedKeycodes.has(event.keycode);
        const otherKeyHeld = [...this.pressedKeycodes].some((keycode) => !ALT_KEYCODES.has(keycode));
        this.pressedKeycodes.add(event.keycode);
        if (!ALT_KEYCODES.has(event.keycode)) {
            this.altDownAt = null;
            return;
        }
        if (this.handlers?.isEnabled() !== true ||
            this.altDownAt !== null ||
            wasAlreadyDown ||
            otherKeyHeld) {
            return;
        }
        this.altDownAt = Date.now();
    };
    handleKeyup = (event) => {
        if (!this.started)
            return;
        if (areGlobalShortcutsSuspended()) {
            this.altDownAt = null;
            this.pressedKeycodes.clear();
            return;
        }
        this.pressedKeycodes.delete(event.keycode);
        if (!ALT_KEYCODES.has(event.keycode) || this.altDownAt === null) {
            return;
        }
        const durationMs = Date.now() - this.altDownAt;
        this.altDownAt = null;
        if (durationMs <= ALT_TAP_MAX_MS) {
            this.handlers?.toggle();
        }
    };
    handleMousedown = () => {
        if (!this.started)
            return;
        this.altDownAt = null;
    };
}
