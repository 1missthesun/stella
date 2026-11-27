// A Stella View opened from a share link (stella.sh/c/<slug>), for anyone, with no Stella account:
// the page the share Worker serves runs the view's program in PsychoScript's WebAssembly
// (web/share/entry.ts) and this draws it, full page, in Stella's look, light or dark as the
// visitor's system is. Its storage stays in the visitor's browser.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewSnapshot } from "@stella/views/session";
import { useT } from "@/shared/i18n";
import { IconButton, Icons } from "../kit";
import { font, fontSize, look, mix, ThemeScope, useTokens } from "../theme";
import { ViewRoot } from "./ViewRenderer";

const FOOTER = look(fontSize.xs, 400);
const PROBLEM = look(fontSize.sm, 400, { lh: 1.5, em: 0, family: font.mono });
const STELLA_URL = "https://stella.sh";

const darkQuery = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

function useSystemMode(): "light" | "dark" {
  const [dark, setDark] = useState(() => darkQuery()?.matches ?? false);
  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const on = () => setDark(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return dark ? "dark" : "light";
}

export function SharedViewPage({ filePath }: { filePath: string }) {
  const mode = useSystemMode();
  return (
    <window id="main">
      <ThemeScope themeId="custom" mode={mode}>
        <SharedView filePath={filePath} />
      </ThemeScope>
    </window>
  );
}

function SharedView({ filePath }: { filePath: string }) {
  const t = useT();
  const tk = useTokens();
  const views = globalThis.stella.views;
  const theme = useMemo(() => ({ dark: tk.dark, accent: tk.c.interactive, platform: "web" as const }), [tk]);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [snapshot, setSnapshot] = useState<ViewSnapshot | null>(null);

  useEffect(() => views?.subscribe(filePath, themeRef.current, setSnapshot), [views, filePath]);
  useEffect(() => {
    views?.theme(filePath, theme);
  }, [views, filePath, theme]);
  useEffect(() => {
    document.documentElement.style.colorScheme = tk.dark ? "dark" : "light";
    document.body.style.background = tk.c.background;
  }, [tk]);
  useEffect(() => {
    if (!snapshot?.tree || document.documentElement.dataset.viewReady) return;
    document.documentElement.dataset.viewReady = "true";
    // How long the link took to show the view, for anyone measuring it.
    performance.mark("stella-view-first-render");
  }, [snapshot?.tree]);

  const dispatch = useCallback((handler: number, value?: unknown) => views?.dispatch(filePath, handler, value), [views, filePath]);
  const onSize = useCallback((w: number, h: number) => views?.viewport(filePath, Math.round(w), Math.round(h)), [views, filePath]);
  const problem = snapshot?.problem ?? null;
  const keys = snapshot?.keys.length ? { focusable: true, autoFocus: true, keys: [...snapshot.keys], onKey: (e: { chord: string }) => views?.key(filePath, e.chord) } : {};

  return (
    <col grow={1} w="full" minH={0} fill={tk.c.background} align="center">
      <col grow={1} minH={0} w="full" maxW={960} {...keys}>
        <col grow={1} minH={0} w="full" px={20} pt={24} pb={12}>
          {snapshot?.tree ? <ViewRoot tree={snapshot.tree} dispatch={dispatch} scope="shared-view" onSize={onSize} /> : null}
        </col>
        {problem ? (
          <row role="alert" shrink={false} mx={20} px={12} py={8} gap={8} align="start" radius={10} fill={mix(tk.c.destructive, 8, tk.c.background)} border={mix(tk.c.destructive, 30, tk.c.background)}>
            <text {...PROBLEM} color={tk.c.foreground} grow={1} selectable maxLines={6} truncate>
              {problem.message}
            </text>
            <IconButton id="shared-view-restart" icon={Icons.stella.RotateCcw} label={t("common.tryAgain")} size={22} onPress={() => views?.restart(filePath)} />
          </row>
        ) : null}
        <row shrink={false} w="full" justify="center" py={14}>
          <text
            {...FOOTER}
            color={tk.c.mutedForeground}
            spans={[{ t: t("shell.display.viewShare.madeWithStella"), href: STELLA_URL }]}
            onLink={(href: string) => window.open(href, "_blank", "noopener,noreferrer")}
          />
        </row>
      </col>
    </col>
  );
}
