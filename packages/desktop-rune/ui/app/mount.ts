import type { ComponentType } from "react";

type Modules = Record<string, Record<string, unknown>>;

/**
 * A surface another track ports, taken from its module once that file exists (an eager
 * `import.meta.glob` of the path), else `fallback`, so the root builds before every track lands.
 */
export function mounted<P>(modules: Modules, name: string, fallback: ComponentType<P>): ComponentType<P> {
  for (const mod of Object.values(modules)) {
    const found = mod[name] ?? (name === "default" ? undefined : mod.default);
    if (typeof found === "function" || (typeof found === "object" && found !== null)) return found as ComponentType<P>;
  }
  return fallback;
}

export const Nothing = () => null;
