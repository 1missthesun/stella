export type RunnerModuleExports = typeof import("../../kernel/runner.js");

export interface Interface {
  readonly prefetch: () => void;
  readonly load: () => Promise<RunnerModuleExports>;
}

export const make = (): Interface => {
  let loaded: Promise<RunnerModuleExports> | undefined;

  const ensurePromise = (): Promise<RunnerModuleExports> => {
    if (!loaded) {
      loaded = import("../../kernel/runner.js");
      loaded.catch(() => undefined);
    }
    return loaded;
  };

  return {
    prefetch: () => {
      void ensurePromise();
    },
    load: () => ensurePromise(),
  };
};
