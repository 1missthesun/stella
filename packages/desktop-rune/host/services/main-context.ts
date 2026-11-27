// Electron main's bootstrap context (its services and state), kept for the control server's /eval.


let current: unknown = null;

export const createBootstrapContext = (config: unknown) => {
  const original = require("../../../desktop/electron/bootstrap/context.js") as { __electron_createBootstrapContext(config: unknown): unknown };
  current = original.__electron_createBootstrapContext(config);
  return current;
};

export const mainContext = () => current as { state: Record<string, any>; services: Record<string, any>; config: Record<string, any> } | null;
