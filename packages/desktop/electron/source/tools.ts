const once = <T>(load: () => Promise<T>) => {
  let loaded: Promise<T> | null = null;
  return () => (loaded ??= load());
};

export const loadOxcTools = once(async () => {
  const [utils, experimental] = await Promise.all([import("rolldown/utils"), import("rolldown/experimental")]);
  return {
    transform: utils.transform,
    parse: utils.parse,
    parseSync: utils.parseSync,
    ResolverFactory: experimental.ResolverFactory,
  };
});

export const loadDepTools = once(async () => {
  const [rolldown, oxc, cjsLexer] = await Promise.all([import("rolldown"), loadOxcTools(), import("cjs-module-lexer")]);
  const lexerInit = (cjsLexer as { init?: () => Promise<void> }).init;
  if (lexerInit) await lexerInit();
  return { rolldown: rolldown.rolldown, parseSync: oxc.parseSync, parseCommonJs: cjsLexer.parse };
});

export const loadTailwindTools = once(async () => {
  const [tailwindNode, tailwindOxide] = await Promise.all([import("@tailwindcss/node"), import("@tailwindcss/oxide")]);
  return { compileTailwind: tailwindNode.compile, TailwindScanner: tailwindOxide.Scanner };
});

export const loadRouteTools = once(async () => {
  const routerGenerator = await import("@tanstack/router-generator");
  return { RouteGenerator: routerGenerator.Generator, getRouteConfig: routerGenerator.getConfig };
});

export type OxcTools = Awaited<ReturnType<typeof loadOxcTools>>;
export type DepTools = Awaited<ReturnType<typeof loadDepTools>>;
export type TailwindTools = Awaited<ReturnType<typeof loadTailwindTools>>;
export type RouteTools = Awaited<ReturnType<typeof loadRouteTools>>;

export const loadSourceTools = async () => {
  const [oxc, deps, tailwind, routes] = await Promise.all([
    loadOxcTools(),
    loadDepTools(),
    loadTailwindTools(),
    loadRouteTools(),
  ]);
  return { ...oxc, ...deps, ...tailwind, ...routes };
};

export type SourceTools = Awaited<ReturnType<typeof loadSourceTools>>;
