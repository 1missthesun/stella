// A view's `useKey` chords in the form the native key capture matches ("mod+shift+alt+ctrl+key",
// lower case), parsed the way the desktop's engine reads them: "mod" is ⌘ on iOS and Ctrl on
// Android, aliases like "cmd", "option", "esc" and "up" are accepted.
import { Platform } from "react-native";

const MOD = ["mod", "cmdorctrl", "commandorcontrol", "cmd", "command", "meta", "super"];
const NORMAL: Record<string, string> = { return: "enter", esc: "escape", up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", space: " ", spacebar: " ", del: "delete" };

export function canonicalChord(chord: string): string | null {
  let mod = false;
  let shift = false;
  let alt = false;
  let ctrl = false;
  let key: string | null = null;
  const parts = chord.split("+");
  parts.forEach((part, index) => {
    const lower = part.trim().toLowerCase();
    const last = index === parts.length - 1;
    if (!last && MOD.includes(lower)) mod = true;
    else if (!last && lower === "shift") shift = true;
    else if (!last && (lower === "alt" || lower === "option")) alt = true;
    else if (!last && (lower === "ctrl" || lower === "control")) {
      if (Platform.OS === "ios") ctrl = true;
      else mod = true;
    } else if (last && lower === "") key = "+";
    else key = NORMAL[lower] ?? lower;
  });
  if (key === null) return null;
  return [mod && "mod", shift && "shift", alt && "alt", ctrl && "ctrl", key].filter(Boolean).join("+");
}

/** Canonical chord → the author's chord it came from, for every chord the view listens for. */
export function chordTable(chords: readonly string[]): Map<string, string> {
  const table = new Map<string, string>();
  for (const chord of chords) {
    const canonical = canonicalChord(chord);
    if (canonical && !table.has(canonical)) table.set(canonical, chord);
  }
  return table;
}
