/**
 * Loaded before everything else in the full window. Dynamic imports in the
 * served modules go through `load`, so a module swapped in after a change is
 * the one a later `import()` gets, and the source server can tell which
 * modules already hold one they imported.
 */
export type SwapPayload = {
  version: number;
  root: string | null;
  css: string[];
  modules: string[];
};

export type SwapOutcome = { ok: true; swaps: number } | { ok: false; error: string };

type SwapRuntime = {
  load: (url: string, importer: string) => Promise<unknown>;
  ran: () => [string, string][];
  versions: Map<string, number>;
  apply: (payload: SwapPayload) => Promise<SwapOutcome>;
  /** Roots swapped in since this page loaded; each leaves its old modules in memory. */
  swaps: number;
  /** Milliseconds since the user last typed, clicked or scrolled; 0 while a key or button is held. */
  quietFor: () => number;
};

declare global {
  var __stellaSwap: SwapRuntime | undefined;
}

const versions = new Map<string, number>();
const ranImports = new Map<string, Set<string>>();

const current = (url: string) => {
  const [path = url, query = ""] = url.split("?");
  const version = versions.get(path);
  if (version === undefined) return url;
  const params = new URLSearchParams(query);
  params.set("t", String(version));
  return `${path}?${params.toString()}`;
};

globalThis.__stellaSwap = {
  versions,
  load: (url, importer) => {
    const imported = url.split("?")[0]!;
    let targets = ranImports.get(importer);
    if (!targets) ranImports.set(importer, (targets = new Set()));
    targets.add(imported);
    return import(/* @vite-ignore */ current(url));
  },
  ran: () =>
    [...ranImports].flatMap(([importer, targets]) =>
      [...targets].map((imported): [string, string] => [importer, imported]),
    ),
  apply: () => Promise.resolve({ ok: false, error: "The app has not started." }),
  swaps: 0,
  quietFor: () => 0,
};
