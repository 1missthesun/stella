// The id and description Electron gives a global shortcut in the XDG GlobalShortcuts portal, so a
// binding or consent the desktop remembers for Electron's Stella holds for Rune's too. Electron
// names the command with Chromium's Command::AcceleratorToString and prefixes it with
// HEX(SHA-256(group + profile))[0..32], where group is `<command>+<profile>` and profile is the
// UUID Electron keeps in the profile's Preferences at electron.global_shortcuts.uuid.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "./app";

const MODIFIERS: Record<string, "ctrl" | "alt" | "shift" | "command"> = {
  commandorcontrol: "ctrl", cmdorctrl: "ctrl", control: "ctrl", ctrl: "ctrl",
  alt: "alt", option: "alt", shift: "shift",
  super: "command", meta: "command", command: "command", cmd: "command",
};

const KEYS: Record<string, string> = {
  ",": "Comma", comma: "Comma", ".": "Period", period: "Period",
  up: "Up", down: "Down", left: "Left", right: "Right",
  insert: "Insert", delete: "Delete", home: "Home", end: "End",
  pageup: "PageUp", pagedown: "PageDown", space: "Space", tab: "Tab",
  medianexttrack: "MediaNextTrack", mediaplaypause: "MediaPlayPause",
  mediaprevioustrack: "MediaPrevTrack", mediastop: "MediaStop",
};

/** Chromium's Command::AcceleratorToString for an Electron accelerator ("" where Chromium has no name). */
export function chromiumCommandString(accelerator: string): string {
  const mods = new Set<string>();
  let key = "";
  for (const token of accelerator.split("+").map((t) => t.trim())) {
    const mod = MODIFIERS[token.toLowerCase()];
    if (mod) mods.add(mod);
    else key = token;
  }
  const media = key.toLowerCase().startsWith("media");
  if (!media && mods.size === 0) return "";
  if (mods.has("shift") && !mods.has("ctrl") && !mods.has("alt") && !mods.has("command")) return "";
  const name = /^[0-9a-z]$/i.test(key) ? key.toUpperCase() : KEYS[key.toLowerCase()];
  if (!name) return "";
  return [mods.has("ctrl") && "Ctrl", mods.has("alt") && "Alt", mods.has("command") && "Command", mods.has("shift") && "Shift", name].filter(Boolean).join("+");
}

let profileId: string | null = null;

function portalProfileId(): string {
  if (profileId) return profileId;
  const file = path.join(app.getPath("userData"), "Preferences");
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {}
  const electron = (prefs.electron ??= {}) as Record<string, unknown>;
  const shortcuts = (electron.global_shortcuts ??= {}) as Record<string, unknown>;
  if (typeof shortcuts.uuid === "string" && shortcuts.uuid) return (profileId = shortcuts.uuid);
  shortcuts.uuid = randomUUID();
  try {
    writeFileSync(`${file}.rune`, JSON.stringify(prefs));
    renameSync(`${file}.rune`, file);
  } catch (error) {
    console.error(`[globalShortcut] could not save the portal profile id: ${error instanceof Error ? error.message : String(error)}`);
  }
  return (profileId = shortcuts.uuid as string);
}

/** Electron's portal shortcut id and description for `accelerator`. */
export function portalShortcut(accelerator: string): { id: string; description: string } {
  const command = chromiumCommandString(accelerator);
  const profile = portalProfileId();
  const prefix = createHash("sha256").update(`${command}+${profile}${profile}`).digest("hex").slice(0, 32).toUpperCase();
  return { id: `${prefix}-${command}`, description: `${app.getName()} shortcut: ${command}` };
}
