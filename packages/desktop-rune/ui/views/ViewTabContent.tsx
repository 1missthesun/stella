// A Stella View, open in the display panel where canvases open, or live in the chat as a card:
// the host runs one program per file (host/views/views-host.ts) and every surface showing it draws
// each tree it posts, so the card and the panel are the same running view. A program error keeps
// the last good tree on screen with the error under it, so an agent's broken edit never blanks it.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ViewSnapshot } from "@stella/views/session";
import { useT } from "@/shared/i18n";
import { IconButton, Icons } from "../kit";
import { font, fontSize, look, mix, radius, useTokens } from "../theme";
import { PreviewProblem } from "../shell/display/preview-states";
import { ViewRoot } from "./ViewRenderer";

const PROBLEM = look(fontSize.sm, 400, { lh: 1.5, em: 0, family: font.mono });
const CARD_TITLE = look(fontSize.sm, 500);

export const isViewFile = (filePath: string): boolean => /\.view\.(tsx|ts|jsx|js)$/iu.test(filePath);

/** How tall a view's chat card grows before it scrolls. */
const CARD_MAX_H = 460;

export function ViewTabContent({ filePath }: { filePath: string }) {
  return <ViewSurface filePath={filePath} />;
}

/** A view live in a chat reply, with a way to open it in the panel. */
export function ViewChatCard({ filePath, title, onOpen }: { filePath: string; title: string; onOpen: () => void }) {
  return <ViewSurface filePath={filePath} card={{ title, onOpen }} />;
}

function ViewSurface({ filePath, card }: { filePath: string; card?: { title: string; onOpen: () => void } }) {
  const t = useT();
  const tk = useTokens();
  const views = globalThis.stella.views;
  const theme = useMemo(() => ({ dark: tk.dark, accent: tk.c.interactive, platform: "desktop" as const }), [tk]);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [snapshot, setSnapshot] = useState<ViewSnapshot | null>(() => views?.snapshot(filePath) ?? null);

  useEffect(() => {
    if (!views) return;
    return views.subscribe(filePath, themeRef.current, setSnapshot);
  }, [views, filePath]);
  useEffect(() => {
    views?.theme(filePath, theme);
  }, [views, filePath, theme]);

  const dispatch = useCallback((handler: number, value?: unknown) => views?.dispatch(filePath, handler, value), [views, filePath]);
  const onSize = useCallback((w: number, h: number) => views?.viewport(filePath, Math.round(w), Math.round(h)), [views, filePath]);
  const scope = useMemo(() => `view-${card ? "card-" : ""}${filePath.replace(/[^\w-]/gu, "_").slice(-60)}`, [filePath, card]);

  if (!views) return card ? null : <PreviewProblem error={t("shell.display.preview.unavailable")} />;
  const problem = snapshot?.problem ?? null;
  const frame = (body: ReactNode) =>
    card ? (
      <col id={`${scope}-card`} w="full" maxW={640} pad={1} radius={radius["2xl"]} border={tk.c.border} fill={tk.c.background} clip={radius["2xl"]}>
        <row shrink={false} w="full" align="center" gap={8} pl={14} pr={6} py={6} borderSides={[0, 0, 1, 0]} border={tk.c.border}>
          <text {...CARD_TITLE} color={tk.c.foreground} grow={1} minW={0} maxLines={1} truncate>
            {card.title}
          </text>
          <IconButton id={`${scope}-open`} icon={Icons.stella.Maximize2} label={t("app.chat.endResource.openInPanel")} size={26} onPress={card.onOpen} />
        </row>
        {body}
      </col>
    ) : (
      body
    );
  if (!snapshot?.tree) {
    if (problem) {
      return frame(
        <col grow={1} center pad={24} gap={12} title={filePath}>
          <PreviewProblem error={problem.message} onRetry={() => views.restart(filePath)} />
        </col>,
      );
    }
    return card ? frame(<col h={120} />) : <col grow={1} />;
  }
  const keys = snapshot.keys.length ? { focusable: true, autoFocus: !card, keys: [...snapshot.keys], onKey: (e: { chord: string }) => views.key(filePath, e.chord) } : {};
  return frame(
    <col id={`${scope}-tab`} {...(card ? {} : { grow: 1, minH: 0, fill: tk.c.background })} w="full" {...keys}>
      <col {...(card ? {} : { grow: 1, minH: 0 })} w="full" pad={card ? 16 : 20}>
        <ViewRoot tree={snapshot.tree} dispatch={dispatch} scope={scope} onSize={onSize} {...(card ? { maxHeight: CARD_MAX_H } : {})} />
      </col>
      {problem ? (
        <row role="alert" shrink={false} px={12} py={8} gap={8} align="start" fill={mix(tk.c.destructive, 8, tk.c.background)} borderSides={[1, 0, 0, 0]} border={mix(tk.c.destructive, 30, tk.c.background)} enter="rise">
          <text {...PROBLEM} color={tk.c.foreground} grow={1} selectable maxLines={6} truncate>
            {problem.message}
          </text>
          <IconButton id={`${scope}-restart`} icon={Icons.stella.RotateCcw} label={t("common.tryAgain")} size={22} onPress={() => views.restart(filePath)} />
        </row>
      ) : null}
    </col>,
  );
}
