import { app, BrowserWindow, shell } from "electron";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDictationSoundEffectsEnabled, loadLocalPreferences, updateLocalPreferences, } from "@stella/runtime/kernel/preferences/local-preferences";
import { runNativeHelper } from "../native-helper.js";
import { hasOpenRouterDictationKey, transcribeWithOpenRouter, } from "../services/dictation-openrouter.js";
import { applyShortcutRegistration, } from "./shortcut-registration.js";
import { OnDeviceDictation, SYSTEM_DICTATION_SETTINGS_URL, } from "../services/on-device-dictation.js";
import {
  IPC_DICTATION_TOGGLE,
  IPC_DICTATION_SET_SHORTCUT,
  IPC_DICTATION_GET_SHORTCUT,
  IPC_DICTATION_HAS_OPENROUTER_KEY,
  IPC_DICTATION_TRANSCRIBE_WITH_OPENROUTER,
  IPC_DICTATION_CANCEL_OPENROUTER,
  IPC_DICTATION_GET_SOUND_EFFECTS_ENABLED,
  IPC_DICTATION_SET_SOUND_EFFECTS_ENABLED,
  IPC_DICTATION_ACTIVE_CHANGED,
  IPC_DICTATION_PLAY_SOUND,
  IPC_DICTATION_ON_DEVICE_STATUS,
  IPC_DICTATION_ON_DEVICE_START,
  IPC_DICTATION_ON_DEVICE_AUDIO,
  IPC_DICTATION_ON_DEVICE_FINISH,
  IPC_DICTATION_ON_DEVICE_CANCEL,
  IPC_DICTATION_ON_DEVICE_TRANSCRIBE_FILE,
  IPC_DICTATION_OPEN_SYSTEM_DICTATION_SETTINGS,
} from "@stella/contracts/desktop/ipc-channels";
import {
  registerPrivilegedHandle,
  onPrivilegedIpc,
} from "./privileged-ipc.js";
const DEFAULT_DICTATION_SHORTCUT = "Alt";
const DEFAULT_NON_MAC_DICTATION_SHORTCUT = "Control+M";
const LEGACY_DEFAULT_DICTATION_SHORTCUT = "Control+M";
const TAP_DICTATION_SHORTCUT = "Alt";
const DICTATION_SOUND_VOLUME_BY_SOUND = {
    startRecording: "0.2",
    stopRecording: "0.45",
    cancel: "0.35",
};
const DICTATION_START_SOUND_MUTE_DELAY_MS = 220;
const DICTATION_BRIDGE_TIMEOUT_MS = 2_000;
const OUTPUT_MUTE_FILE = "dictation-output-mute.json";
const dictationBridgeIsSupported = () => process.platform === "darwin" || process.platform === "win32";
const isUsableWindow = (window) => Boolean(window && !window.isDestroyed());
const soundPath = (stellaAppDir, sound) => path.join(stellaAppDir, "packages", "desktop", "resources", "audio", `${sound}.mp3`);
const playDictationSound = (stellaAppDir, sound) => {
    if (process.platform !== "darwin")
        return;
    execFile("/usr/bin/afplay", ["-v", DICTATION_SOUND_VOLUME_BY_SOUND[sound], soundPath(stellaAppDir, sound)], (error) => {
        if (error) {
            console.debug("[dictation] sound failed:", error.message);
        }
    });
};
export const registerDictationHandlers = (options) => {
    const { windowManager } = options;
    let currentShortcut = "";
    let mutedOutputVolume = null;
    let mutedOutputPreviousMuted = null;
    let outputMutePromise = null;
    let outputMuteActive = false;
    let outputMuteDelayTimer = null;
    const activeDictationSources = new Set();
    let dictationActive = false;
    const outputMuteFile = () => {
        const stellaDataDir = options.getStellaDataDir();
        return stellaDataDir ? path.join(stellaDataDir, OUTPUT_MUTE_FILE) : null;
    };
    const saveOutputMute = (previousVolume, previousMuted) => {
        const file = outputMuteFile();
        if (!file)
            return;
        try {
            writeFileSync(`${file}.tmp`, JSON.stringify({ previousVolume, previousMuted }), "utf8");
            renameSync(`${file}.tmp`, file);
        }
        catch (error) {
            console.debug("[dictation] saving the output mute failed:", error.message);
        }
    };
    const clearOutputMute = () => {
        const file = outputMuteFile();
        if (file)
            rmSync(file, { force: true });
    };
    const runOutputRestore = (previousVolume, previousMuted) => {
        const args = ["restore-output", String(previousVolume)];
        if (typeof previousMuted === "boolean") {
            args.push(previousMuted ? "true" : "false");
        }
        return runNativeHelper("dictation_bridge", args, {
            timeout: DICTATION_BRIDGE_TIMEOUT_MS,
            maxBuffer: 64 * 1024,
            onError: (error) => {
                console.debug("[dictation] output restore failed:", error.message);
            },
        });
    };
    const restoreOutputLeftMuted = () => {
        const file = outputMuteFile();
        if (!file || !dictationBridgeIsSupported())
            return;
        let saved;
        try {
            saved = JSON.parse(readFileSync(file, "utf8"));
        }
        catch {
            return;
        }
        if (typeof saved?.previousVolume !== "number") {
            clearOutputMute();
            return;
        }
        console.warn("[dictation] restoring the output volume a previous session left muted");
        void runOutputRestore(saved.previousVolume, saved.previousMuted)
            .then((raw) => {
            if (raw !== null && raw !== undefined)
                clearOutputMute();
        })
            .catch((error) => {
            console.debug("[dictation] output restore failed:", error);
        });
    };
    const areDictationSoundsEnabled = () => {
        const stellaDataDir = options.getStellaDataDir();
        return stellaDataDir ? getDictationSoundEffectsEnabled(stellaDataDir) : true;
    };
    const playEnabledDictationSound = (sound) => {
        if (!areDictationSoundsEnabled())
            return;
        playDictationSound(options.stellaAppDir, sound);
    };
    const muteOutputForDictation = () => {
        if (!dictationBridgeIsSupported())
            return;
        if (outputMuteDelayTimer) {
            clearTimeout(outputMuteDelayTimer);
            outputMuteDelayTimer = null;
        }
        if (mutedOutputVolume !== null) {
            outputMuteActive = true;
            return;
        }
        outputMuteActive = true;
        if (outputMutePromise)
            return;
        outputMutePromise = runNativeHelper("dictation_bridge", ["mute-output"], {
            timeout: DICTATION_BRIDGE_TIMEOUT_MS,
            maxBuffer: 64 * 1024,
            onError: (error) => {
                console.debug("[dictation] output mute failed:", error.message);
            },
        })
            .then((raw) => {
            if (!raw)
                return;
            const result = JSON.parse(raw);
            if (result.ok === true && typeof result.previousVolume === "number") {
                mutedOutputVolume = result.previousVolume;
                mutedOutputPreviousMuted =
                    typeof result.previousMuted === "boolean"
                        ? result.previousMuted
                        : null;
                saveOutputMute(mutedOutputVolume, mutedOutputPreviousMuted);
                if (!outputMuteActive) {
                    restoreOutputAfterDictation();
                }
            }
        })
            .catch((error) => {
            console.debug("[dictation] output mute failed:", error);
        })
            .finally(() => {
            outputMutePromise = null;
        });
    };
    const muteOutputForDictationAfterStartCue = () => {
        if (!dictationBridgeIsSupported())
            return;
        outputMuteActive = true;
        if (mutedOutputVolume !== null || outputMutePromise)
            return;
        if (outputMuteDelayTimer) {
            clearTimeout(outputMuteDelayTimer);
        }
        outputMuteDelayTimer = setTimeout(() => {
            outputMuteDelayTimer = null;
            if (!outputMuteActive)
                return;
            muteOutputForDictation();
        }, DICTATION_START_SOUND_MUTE_DELAY_MS);
    };
    const restoreOutputAfterDictation = () => {
        if (!dictationBridgeIsSupported())
            return;
        if (outputMuteDelayTimer) {
            clearTimeout(outputMuteDelayTimer);
            outputMuteDelayTimer = null;
        }
        outputMuteActive = false;
        const previousVolume = mutedOutputVolume;
        const previousMuted = mutedOutputPreviousMuted;
        mutedOutputVolume = null;
        mutedOutputPreviousMuted = null;
        if (typeof previousVolume !== "number")
            return;
        runOutputRestore(previousVolume, previousMuted)
            .then((raw) => {
            if (raw !== null && raw !== undefined)
                clearOutputMute();
        })
            .catch((error) => {
            console.debug("[dictation] output restore failed:", error);
        });
    };
    const setDictationSourceActive = (source, active) => {
        const previous = dictationActive;
        if (active) {
            activeDictationSources.add(source);
        }
        else {
            activeDictationSources.delete(source);
        }
        dictationActive = activeDictationSources.size > 0;
        if (dictationActive !== previous) {
            if (dictationActive) {
                muteOutputForDictationAfterStartCue();
            }
            else {
                restoreOutputAfterDictation();
            }
            options.onDictationActiveChanged?.(dictationActive);
        }
    };
    const isRendererRecording = (window) => isUsableWindow(window) &&
        activeDictationSources.has(`renderer:${window.webContents.id}`);
    const pickFocusedStellaWindow = () => {
        if (process.platform === "darwin" && !app.isActive())
            return null;
        const focused = BrowserWindow.getFocusedWindow();
        if (!isUsableWindow(focused))
            return null;
        if (focused === windowManager.getFullWindow())
            return focused;
        return null;
    };
    const toggleDictation = () => {
        const target = pickFocusedStellaWindow();
        if (target) {
            playEnabledDictationSound(isRendererRecording(target) ? "stopRecording" : "startRecording");
            target.webContents.send(IPC_DICTATION_TOGGLE, { startId: randomUUID() });
            return;
        }
        const companion = options.getCompanionController();
        if (!companion)
            return;
        playEnabledDictationSound(isRendererRecording(companion.getPanelWindow()) ? "stopRecording" : "startRecording");
        void companion
            .show({ focus: true })
            .then((shown) => {
            if (!shown)
                return;
            companion.sendToPanel(IPC_DICTATION_TOGGLE, {
                startId: randomUUID(),
                source: "companion",
            });
        })
            .catch((error) => {
            console.warn("[dictation] companion summon failed:", error);
        });
    };
    const applyDictationShortcutRegistration = (requestedShortcut) => {
        if (currentShortcut && currentShortcut !== TAP_DICTATION_SHORTCUT) {
            applyShortcutRegistration({
                label: "Dictation",
                requestedShortcut: "",
                currentShortcut,
                callback: toggleDictation,
                onActiveShortcutChange: (shortcut) => {
                    currentShortcut = shortcut;
                },
            });
        }
        if (requestedShortcut === TAP_DICTATION_SHORTCUT) {
            currentShortcut = requestedShortcut;
            return {
                ok: true,
                requestedShortcut,
                activeShortcut: requestedShortcut,
            };
        }
        return applyShortcutRegistration({
            label: "Dictation",
            requestedShortcut,
            currentShortcut: currentShortcut === TAP_DICTATION_SHORTCUT ? "" : currentShortcut,
            callback: toggleDictation,
            onActiveShortcutChange: (shortcut) => {
                currentShortcut = shortcut;
            },
        });
    };
    const loadConfiguredShortcut = () => {
        const platformDefault = process.platform === "darwin"
            ? DEFAULT_DICTATION_SHORTCUT
            : DEFAULT_NON_MAC_DICTATION_SHORTCUT;
        const stellaDataDir = options.getStellaDataDir();
        if (!stellaDataDir)
            return platformDefault;
        const shortcut = loadLocalPreferences(stellaDataDir).dictationShortcut;
        if (process.platform !== "darwin" && shortcut === TAP_DICTATION_SHORTCUT) {
            return DEFAULT_NON_MAC_DICTATION_SHORTCUT;
        }
        return shortcut === LEGACY_DEFAULT_DICTATION_SHORTCUT
            ? platformDefault
            : shortcut;
    };
    const saveConfiguredShortcut = (shortcut) => {
        const stellaDataDir = options.getStellaDataDir();
        if (!stellaDataDir)
            return;
        updateLocalPreferences(stellaDataDir, { dictationShortcut: shortcut });
    };
    restoreOutputLeftMuted();
    const initial = applyDictationShortcutRegistration(loadConfiguredShortcut());
    if (!initial.ok) {
        console.warn("[dictation]", initial.error);
    }
    registerPrivilegedHandle(options, IPC_DICTATION_SET_SHORTCUT, (_event, shortcut) => {
        const result = applyDictationShortcutRegistration(shortcut);
        if (!result.ok) {
            console.warn("[dictation]", result.error);
        }
        else {
            saveConfiguredShortcut(result.activeShortcut);
        }
        return result;
    });
    registerPrivilegedHandle(options, IPC_DICTATION_GET_SHORTCUT, () => currentShortcut);
    let openRouterTranscription = null;
    registerPrivilegedHandle(options, IPC_DICTATION_HAS_OPENROUTER_KEY, (event) => {
        return hasOpenRouterDictationKey(options.getStellaDataDir());
    });
    registerPrivilegedHandle(options, IPC_DICTATION_TRANSCRIBE_WITH_OPENROUTER, async (event, payload) => {
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        const wav = payload?.wav;
        if (!requestId || (!(wav instanceof ArrayBuffer) && !(wav instanceof Uint8Array))) {
            throw new Error("Dictation audio was empty.");
        }
        if (openRouterTranscription) {
            throw new Error("Dictation is already transcribing a recording.");
        }
        const controller = new AbortController();
        openRouterTranscription = { requestId, controller };
        try {
            return await transcribeWithOpenRouter(options.getStellaDataDir(), wav, controller.signal);
        }
        finally {
            if (openRouterTranscription?.requestId === requestId)
                openRouterTranscription = null;
        }
    });
    onPrivilegedIpc(options, IPC_DICTATION_CANCEL_OPENROUTER, (event, payload) => {
        if (openRouterTranscription && openRouterTranscription.requestId === payload?.requestId) {
            openRouterTranscription.controller.abort();
            openRouterTranscription = null;
        }
    });
    const onDevice = new OnDeviceDictation();
    const watchedSenders = new Set();
    const watchSender = (sender) => {
        if (watchedSenders.has(sender.id))
            return;
        watchedSenders.add(sender.id);
        const id = sender.id;
        sender.once("destroyed", () => {
            watchedSenders.delete(id);
            onDevice.cancelOwnedBy(id);
        });
    };
    const stringList = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 8) : [];
    registerPrivilegedHandle(options, IPC_DICTATION_ON_DEVICE_STATUS, (_event, payload) => onDevice.status(stringList(payload?.locales)));
    registerPrivilegedHandle(options, IPC_DICTATION_ON_DEVICE_START, (event, payload) => {
        const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
        if (!sessionId)
            throw new Error("Dictation session is missing.");
        watchSender(event.sender);
        onDevice.start(event.sender.id, sessionId, stringList(payload?.locales));
        return { ok: true };
    });
    onPrivilegedIpc(options, IPC_DICTATION_ON_DEVICE_AUDIO, (event, payload) => {
        const pcm = payload?.pcm;
        if (typeof payload?.sessionId !== "string" || !(pcm instanceof ArrayBuffer || pcm instanceof Uint8Array))
            return;
        onDevice.push(event.sender.id, payload.sessionId, pcm);
    });
    registerPrivilegedHandle(options, IPC_DICTATION_ON_DEVICE_FINISH, (event, payload) => onDevice.finish(event.sender.id, String(payload?.sessionId ?? "")));
    onPrivilegedIpc(options, IPC_DICTATION_ON_DEVICE_CANCEL, (_event, payload) => {
        if (typeof payload?.sessionId === "string")
            onDevice.cancel(payload.sessionId);
    });
    registerPrivilegedHandle(options, IPC_DICTATION_ON_DEVICE_TRANSCRIBE_FILE, (_event, payload) => {
        const wav = payload?.wav;
        if (!(wav instanceof ArrayBuffer) && !(wav instanceof Uint8Array))
            throw new Error("Dictation audio was empty.");
        return onDevice.transcribeWav(wav, stringList(payload?.locales));
    });
    onPrivilegedIpc(options, IPC_DICTATION_OPEN_SYSTEM_DICTATION_SETTINGS, () => {
        if (process.platform !== "darwin")
            return;
        onDevice.invalidate();
        void shell.openExternal(SYSTEM_DICTATION_SETTINGS_URL);
    });
    app.on("browser-window-focus", () => onDevice.invalidate());
    app.once("will-quit", () => onDevice.dispose());
    registerPrivilegedHandle(options, IPC_DICTATION_GET_SOUND_EFFECTS_ENABLED, () => areDictationSoundsEnabled());
    registerPrivilegedHandle(options, IPC_DICTATION_SET_SOUND_EFFECTS_ENABLED, (_event, enabled) => {
        const nextEnabled = enabled === true;
        const stellaDataDir = options.getStellaDataDir();
        if (stellaDataDir) {
            updateLocalPreferences(stellaDataDir, { dictationSoundEffectsEnabled: nextEnabled });
        }
        return { enabled: nextEnabled };
    });
    onPrivilegedIpc(options, IPC_DICTATION_ACTIVE_CHANGED, (event, payload) => {
        const source = `renderer:${event.sender.id}`;
        setDictationSourceActive(source, payload?.active === true);
        if (payload?.active === true) {
            event.sender.once("destroyed", () => setDictationSourceActive(source, false));
        }
    });
    onPrivilegedIpc(options, IPC_DICTATION_PLAY_SOUND, (_event, payload) => {
        if (payload?.sound !== "startRecording" &&
            payload?.sound !== "stopRecording" &&
            payload?.sound !== "cancel") {
            return;
        }
        playEnabledDictationSound(payload.sound);
    });
    return {
        isEnabled: () => dictationBridgeIsSupported() &&
            process.platform === "darwin" &&
            currentShortcut === TAP_DICTATION_SHORTCUT,
        toggle: toggleDictation,
    };
};
