/**
 * Electron is a GUI program on Windows, so Electron's main process and every
 * `ELECTRON_RUN_AS_NODE` process (Stella's `node` shim and the `stella-*` CLI
 * shims run scripts that way) have no console. When a process without a
 * console starts a console program (git, cmd, powershell, npm, Stella's own
 * helpers) without `windowsHide`, Windows gives that program a new console,
 * and with Windows Terminal as the default terminal that is a visible, blank
 * Terminal window that stays open until the program exits.
 *
 * This makes `windowsHide: true` the default for every `child_process` call in
 * such a process: piped children start with CREATE_NO_WINDOW (a console with
 * no window, which their own children share), inheriting ones with SW_HIDE.
 * A caller that passes `windowsHide` itself keeps its choice.
 *
 * The function is self-contained on purpose: Stella's shell shims write its
 * source into a `--require` preload for Electron-as-Node (see
 * `windowsHiddenSpawnPreloadSource`), so it may use nothing from this module.
 */
export function installWindowsHiddenSpawns(
  childProcess: object,
  syncBuiltinESMExports?: () => void,
): boolean {
  if (process.platform !== "win32") return false;
  const target = childProcess as Record<PropertyKey, unknown>;
  const marker = Symbol.for("stella.windowsHiddenSpawns");
  if (target[marker]) return false;

  // Puts `windowsHide: true` into the options argument of a child_process
  // call: (file, args?, options?, callback?) when `argsListFirst`, otherwise
  // (command, options?, callback?).
  const withHiddenWindows = (
    callArgs: unknown[],
    argsListFirst: boolean,
  ): unknown[] => {
    const list = callArgs.slice();
    let at = 1;
    if (
      argsListFirst &&
      (Array.isArray(list[1]) || (list[1] == null && list.length > 2))
    ) {
      at = 2;
    }
    const value = list[at];
    if (value === undefined || value === null) {
      list[at] = { windowsHide: true };
    } else if (typeof value === "function") {
      list.splice(at, 0, { windowsHide: true });
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { windowsHide?: unknown }).windowsHide === undefined
    ) {
      list[at] = { ...(value as object), windowsHide: true };
    }
    return list;
  };

  const wrap = (
    original: (...args: unknown[]) => unknown,
    argsListFirst: boolean,
  ) => {
    const wrapped = function (this: unknown, ...args: unknown[]) {
      return original.apply(this, withHiddenWindows(args, argsListFirst));
    };
    // Keep what Node hangs on these functions, above all
    // `util.promisify.custom` on exec/execFile (the {stdout, stderr} form).
    // That custom function calls Node's own execFile directly, so it is
    // wrapped as well.
    for (const key of Reflect.ownKeys(original)) {
      if (
        key === "length" ||
        key === "name" ||
        key === "prototype" ||
        key === "arguments" ||
        key === "caller"
      ) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(original, key);
      if (!descriptor) continue;
      if (typeof descriptor.value === "function") {
        const custom = descriptor.value as (...args: unknown[]) => unknown;
        descriptor.value = function (this: unknown, ...args: unknown[]) {
          return custom.apply(this, withHiddenWindows(args, argsListFirst));
        };
      }
      Object.defineProperty(wrapped, key, descriptor);
    }
    return wrapped;
  };

  const entries: Array<[string, boolean]> = [
    ["spawn", true],
    ["spawnSync", true],
    ["execFile", true],
    ["execFileSync", true],
    ["fork", true],
    ["exec", false],
    ["execSync", false],
  ];
  for (const [name, argsListFirst] of entries) {
    const original = target[name];
    if (typeof original !== "function") continue;
    target[name] = wrap(
      original as (...args: unknown[]) => unknown,
      argsListFirst,
    );
  }
  Object.defineProperty(target, marker, { value: true });
  // ESM `import { spawn } from "node:child_process"` bindings follow the
  // CommonJS exports only after this.
  syncBuiltinESMExports?.();
  return true;
}

/**
 * Keeps the preload in `NODE_OPTIONS` so Node processes this one starts
 * (`fork`, `process.execPath`, npm scripts, `node` again) load it too. Inside
 * a quoted NODE_OPTIONS value a backslash escapes the next character, so the
 * path is written with forward slashes.
 */
export function keepPreloadForChildren(preloadPath: string): void {
  const normalized = preloadPath.replace(/\\/g, "/");
  const current = process.env.NODE_OPTIONS ?? "";
  if (current.includes(normalized)) return;
  process.env.NODE_OPTIONS =
    `--require "${normalized}"${current ? ` ${current}` : ""}`;
}

/**
 * Source for a CommonJS `--require` preload that installs the hidden-window
 * default in an Electron-as-Node process on Windows. It is a no-op anywhere
 * else (real Node has a console of its own, other platforms have none).
 */
export const windowsHiddenSpawnPreloadSource = (): string =>
  [
    'if (process.platform === "win32" && process.versions.electron) {',
    `  (${installWindowsHiddenSpawns.toString()})(require("node:child_process"), require("node:module").syncBuiltinESMExports);`,
    `  (${keepPreloadForChildren.toString()})(__filename);`,
    "}",
  ].join("\n");
