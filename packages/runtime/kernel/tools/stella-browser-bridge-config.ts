import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export {
  STELLA_BROWSER_EXTENSION_ID,
  STELLA_BROWSER_EXTENSION_STORE_URL,
} from "@stella/contracts/browser-extension";

export const STELLA_BROWSER_BRIDGE_PROVIDER = "extension";
export const STELLA_BROWSER_BRIDGE_SESSION = "stella-app-bridge";
export const STELLA_BROWSER_BRIDGE_PORT = "39040";
export const STELLA_IN_APP_BROWSER_INIT_PORT = 39041;
export const STELLA_BROWSER_MANAGED_BRIDGE = "1";

export const STELLA_NATIVE_MESSAGING_HOST_NAME = "com.stella.browser_bridge";

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

const readBridgeToken = (tokenPath: string): string | null => {
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
};

export type StellaInAppBrowserInitEndpoint =
  | Readonly<{ path: string }>
  | Readonly<{ host: string; port: number }>;

const getBootstrapSession = (env: NodeJS.ProcessEnv) =>
  env.STELLA_IN_APP_BROWSER_BOOTSTRAP_SESSION?.trim() ||
  env.STELLA_BROWSER_SESSION?.trim() ||
  STELLA_BROWSER_BRIDGE_SESSION;

const getBootstrapPort = (env: NodeJS.ProcessEnv): number => {
  const raw = env.STELLA_IN_APP_BROWSER_INIT_PORT?.trim();
  if (!raw) return STELLA_IN_APP_BROWSER_INIT_PORT;
  if (!/^[1-9]\d*$/.test(raw)) return STELLA_IN_APP_BROWSER_INIT_PORT;
  const port = Number(raw);
  return Number.isSafeInteger(port) && port <= 65_535
    ? port
    : STELLA_IN_APP_BROWSER_INIT_PORT;
};

export const getStellaBrowserSocketDir = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const explicit = env.STELLA_BROWSER_SOCKET_DIR?.trim();
  if (explicit) return explicit;
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
  if (runtimeDir) return path.join(runtimeDir, "stella-browser");
  const homeDir = os.homedir().trim();
  if (homeDir) return path.join(homeDir, ".stella-browser");
  return path.join(os.tmpdir(), "stella-browser");
};

export const getStellaInAppBrowserInitEndpoint = (
  env: NodeJS.ProcessEnv = process.env,
): StellaInAppBrowserInitEndpoint =>
  process.platform === "win32"
    ? Object.freeze({
        host: "127.0.0.1",
        port: getBootstrapPort(env),
      })
    : Object.freeze({
        path: path.join(
          getStellaBrowserSocketDir(env),
          `${getBootstrapSession(env)}.in-app.sock`,
        ),
      });

export const getStellaInAppBrowserInitTokenPath = (
  env: NodeJS.ProcessEnv = process.env,
): string =>
  path.join(
    getStellaBrowserSocketDir(env),
    `${getBootstrapSession(env)}.in-app-token`,
  );

const getBridgeTokenPath = (): string => {
  const socketDir = getStellaBrowserSocketDir();
  mkdirSync(socketDir, { recursive: true });
  return path.join(socketDir, `${STELLA_BROWSER_BRIDGE_SESSION}.ext-token`);
};

const publishNewBridgeToken = (tokenPath: string): void => {
  const token = randomUUID();
  const temporary = `${tokenPath}.${token}.tmp`;
  writeFileSync(temporary, token, { flag: "wx", mode: 0o600 });
  try {
    linkSync(temporary, tokenPath);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
};

const getOrCreateBridgeToken = (): string => {
  const tokenPath = getBridgeTokenPath();
  let token = readBridgeToken(tokenPath);
  if (token === null) {
    publishNewBridgeToken(tokenPath);
    token = readBridgeToken(tokenPath);
  }
  if (token) return token;
  const aside = `${tokenPath}.${randomUUID()}.empty`;
  try {
    renameSync(tokenPath, aside);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const moved = readBridgeToken(aside);
  if (moved) {
    try {
      linkSync(aside, tokenPath);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
  } else {
    console.warn(
      `[stella-browser] Replacing an empty bridge token file at ${tokenPath}.`,
    );
    publishNewBridgeToken(tokenPath);
  }
  rmSync(aside, { force: true });
  token = readBridgeToken(tokenPath);
  if (!token) {
    throw new Error(
      `Failed to initialize persistent Stella browser bridge token at ${tokenPath}.`,
    );
  }
  return token;
};

export const STELLA_BROWSER_BRIDGE_TOKEN = getOrCreateBridgeToken();

export const getStellaBrowserBridgeEnv = (): Record<string, string> => ({
  STELLA_BROWSER_PROVIDER: STELLA_BROWSER_BRIDGE_PROVIDER,
  STELLA_BROWSER_SESSION: STELLA_BROWSER_BRIDGE_SESSION,
  STELLA_IN_APP_BROWSER_BOOTSTRAP_SESSION: STELLA_BROWSER_BRIDGE_SESSION,
  STELLA_BROWSER_MANAGED_BRIDGE,
  STELLA_BROWSER_EXT_PORT: STELLA_BROWSER_BRIDGE_PORT,
  STELLA_BROWSER_EXT_TOKEN: STELLA_BROWSER_BRIDGE_TOKEN,
});
