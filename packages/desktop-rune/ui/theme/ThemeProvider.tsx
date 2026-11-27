import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { defaultTheme, getThemeById, resolveThemeColors } from "@stella/theme";
import { ThemeProvider as StellaThemeProvider, useTheme } from "@/context/theme-context";
import { engine } from "../kit/engine";
import { loadFonts } from "./fonts";
import { buildTokens, GLASS_MATERIAL, type MaterialPrefs, type Tokens } from "./tokens";
import { useMaterialPrefs } from "./accessibility";

const TokensContext = createContext<Tokens | null>(null);
const AppTokensContext = createContext<Tokens | null>(null);

/** Seconds a theme or colour-mode switch springs its colours over. */
export const THEME_SPRING = 0.3;

function useSpringOnChange(tokens: Tokens, windowRoot = false) {
  const last = useRef<Tokens | null>(null);
  if (last.current !== tokens) {
    if (last.current) engine.colorMotion(THEME_SPRING);
    if (windowRoot && last.current?.c.background !== tokens.c.background) engine.background(tokens.c.background);
    if (windowRoot && last.current?.dark !== tokens.dark) engine.webviewColorScheme(tokens.dark);
    last.current = tokens;
  }
}

function TokensFromTheme({ children }: { children: ReactNode }) {
  const { theme, colors, resolvedColorMode, flat } = useTheme();
  const dark = resolvedColorMode === "dark";
  const material = useMaterialPrefs();
  const tokens = useMemo(() => buildTokens({ themeId: theme.id, colors, dark, flat, material }), [theme.id, colors, dark, flat, material]);
  useSpringOnChange(tokens, true);
  return (
    <AppTokensContext.Provider value={tokens}>
      <TokensContext.Provider value={tokens}>{children}</TokensContext.Provider>
    </AppTokensContext.Provider>
  );
}

/**
 * The app's theme: desktop-ui's ThemeProvider (theme id, colour mode incl. system, custom base,
 * previews, persistence) resolved into the kit's tokens, and Stella's fonts registered.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  loadFonts();
  return (
    <StellaThemeProvider>
      <TokensFromTheme>{children}</TokensFromTheme>
    </StellaThemeProvider>
  );
}

/** Tokens for a fixed theme and mode, independent of the user's choice (previews, gallery). */
export function tokensFor(themeId: string, mode: "light" | "dark", customBase = "default", material: MaterialPrefs = GLASS_MATERIAL): Tokens {
  const requested = getThemeById(themeId) ?? defaultTheme;
  const theme = requested.id === "custom" && !requested.populated ? (getThemeById(customBase) ?? requested) : requested;
  const resolved = resolveThemeColors(theme, mode === "dark", theme.id === "custom" ? customBase : undefined);
  const dark = (resolved.forcedMode ?? mode) === "dark";
  return buildTokens({ themeId: theme.id, colors: resolved.colors, dark, flat: resolved.flat, material });
}

export function ThemeScope({ themeId, mode, customBase, children }: { themeId: string; mode: "light" | "dark"; customBase?: string; children: ReactNode }) {
  loadFonts();
  const material = useMaterialPrefs();
  const tokens = useMemo(() => tokensFor(themeId, mode, customBase, material), [themeId, mode, customBase, material]);
  useSpringOnChange(tokens);
  return <TokensContext.Provider value={tokens}>{children}</TokensContext.Provider>;
}

/** Its children in `mode` with the user's own theme: glass chrome that takes the other mode while what is behind it calls for that. */
export function ModeScope({ mode, children }: { mode: "light" | "dark"; children: ReactNode }) {
  const outer = useTokens();
  const { selectedThemeId } = useTheme();
  const tokens = useMemo(() => (outer.dark === (mode === "dark") ? outer : tokensFor(selectedThemeId, mode, undefined, outer.material)), [outer, mode, selectedThemeId]);
  useSpringOnChange(tokens);
  return <TokensContext.Provider value={tokens}>{children}</TokensContext.Provider>;
}

/** Back to the app's own theme and mode inside a `ModeScope` (a menu opened from glass chrome that took the other mode). */
export function AppModeScope({ children }: { children: ReactNode }) {
  const app = useContext(AppTokensContext);
  if (!app) return <>{children}</>;
  return <TokensContext.Provider value={app}>{children}</TokensContext.Provider>;
}

let fallback: Tokens | null = null;

export function useTokens(): Tokens {
  const t = useContext(TokensContext);
  if (t) return t;
  return (fallback ??= tokensFor("custom", "light"));
}
