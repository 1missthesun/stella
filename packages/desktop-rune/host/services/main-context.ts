// Electron main's bootstrap context (its services and state), kept for the control server's /eval.

import { createRequire } from "node:module";
import path from "node:path";

const CONTEXT_MODULE = path.resolve(import.meta.dir, "../../../desktop/electron/bootstrap/context.js");

let current: unknown = null;

export const createBootstrapContext = (config: unknown) => {
  const original = createRequire(import.meta.url)(CONTEXT_MODULE) as { __electron_createBootstrapContext(config: unknown): unknown };
  current = original.__electron_createBootstrapContext(config);
  return current;
};

export const mainContext = () => current as { state: Record<string, any>; services: Record<string, any>; config: Record<string, any> } | null;
