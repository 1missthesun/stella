// desktop-ui's VITE_* configuration (backend URL, Turnstile key, apps hosts) in process.env, read
// the way master's renderer build reads it, so the UI bundle's `import.meta.env` and Electron
// main's build-time defines both see it.

import path from "node:path";
import { loadRendererEnv } from "../../../desktop/electron/source/env";

const DESKTOP_UI = path.resolve(import.meta.dir, "../../../desktop-ui");

export const uiBuildMode = () => (process.env.STELLA_LAUNCHER === "1" ? "production" : "development");

export function applyUiEnv() {
  const env = loadRendererEnv(DESKTOP_UI, uiBuildMode());
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("VITE_") && process.env[key] === undefined) process.env[key] = String(value);
  }
  process.env.VITE_TURNSTILE_SITE_KEY ??= "";
}
