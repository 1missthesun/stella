// A Stella View, open in the display panel where canvases open, or live in the chat as a card:
// the host runs one program per file (host/views/views-host.ts) and every surface showing it draws
// each tree it posts, so the card and the panel are the same running view. A program error keeps
// the last good tree on screen with the error under it, so an agent's broken edit never blanks it.
// While an older version is previewed (ViewHistory.tsx), every surface of the view shows that
// version's run instead, with a bar to go back or restore it.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { viewPreviewKey } from "@stella/views/history";
import type { ViewSnapshot } from "@stella/views/session";
import { useT } from "@/shared/i18n";
import { IconButton, Icons, showToast } from "../kit";
import { font, fontSize, look, mix, radius, useTokens } from "../theme";
import { PreviewProblem } from "../shell/display/preview-states";
import { ViewHistoryButton, ViewPreviewBar, ViewUndoButton, useViewHistory } from "./ViewHistory";
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
  const [live, setLive] = useState<ViewSnapshot | null>(() => views?.snapshot(filePath) ?? null);
  const { versions, preview } = useViewHistory(filePath);
  const [previewed, setPreviewed] = useState<{ id: string; snapshot: ViewSnapshot } | null>(null);
  // Input, size and theme go to the run on screen: the previewed version's while there is one.
  const target = preview ? viewPreviewKey(filePath, preview.id) : filePath;

  useEffect(() => {
    if (!views) return;
    return views.subscribe(filePath, themeRef.current, setLive);
  }, [views, filePath]);
  useEffect(() => {
    if (!views || !preview) return;
    const id = preview.id;
    return views.subscribePreview(filePath, id, themeRef.current, (snapshot) => setPreviewed({ id, snapshot }));
  }, [views, filePath, preview]);
  useEffect(() => {
    views?.theme(target, theme);
  }, [views, target, theme]);
  // What the view's capabilities did out of sight, said once however many surfaces show it.
  useEffect(
    () =>
      views?.onNotice?.((notice) => {
        if (notice.filePath === filePath && notice.kind === "copied") showToast({ title: t("app.chat.messageActions.copied"), variant: "success" });
      }),
    [views, filePath, t],
  );

  const dispatch = useCallback((handler: number, value?: unknown) => views?.dispatch(target, handler, value), [views, target]);
  const onSize = useCallback((w: number, h: number) => views?.viewport(target, Math.round(w), Math.round(h)), [views, target]);
  const scope = useMemo(() => `view-${card ? "card-" : ""}${filePath.replace(/[^\w-]/gu, "_").slice(-60)}`, [filePath, card]);

  if (!views) return card ? null : <PreviewProblem error={t("shell.display.preview.unavailable")} />;
  const snapshot = preview ? (previewed?.id === preview.id ? previewed.snapshot : null) : live;
  const problem = snapshot?.problem ?? null;
  const title = card?.title ?? preview?.title ?? versions.at(-1)?.title ?? "";
  const bar = preview ? <ViewPreviewBar filePath={filePath} title={title} version={preview} snapshot={snapshot} scope={scope} /> : null;
  const frame = (body: ReactNode) =>
    card ? (
      <col id={`${scope}-card`} w="full" maxW={640} pad={1} radius={radius["2xl"]} border={tk.c.border} fill={tk.c.background} clip={radius["2xl"]}>
        <row shrink={false} w="full" align="center" gap={4} pl={14} pr={6} py={6} borderSides={[0, 0, 1, 0]} border={tk.c.border}>
          <text {...CARD_TITLE} color={tk.c.foreground} grow={1} minW={0} maxLines={1} truncate>
            {card.title}
          </text>
          <ViewUndoButton filePath={filePath} scope={scope} compact />
          <ViewHistoryButton filePath={filePath} scope={scope} />
          <IconButton id={`${scope}-open`} icon={Icons.stella.Maximize2} label={t("app.chat.endResource.openInPanel")} size={26} onPress={card.onOpen} />
        </row>
        {bar}
        {body}
      </col>
    ) : (
      <col grow={1} minH={0} w="full" fill={tk.c.background}>
        {bar ??
          (versions.length > 1 ? (
            <row id={`${scope}-actions`} shrink={false} w="full" align="center" justify="end" gap={4} px={8} pt={6}>
              <ViewUndoButton filePath={filePath} scope={scope} />
              <ViewHistoryButton filePath={filePath} scope={scope} />
            </row>
          ) : null)}
        {body}
      </col>
    );
  if (!snapshot?.tree) {
    if (problem) {
      return frame(
        <col grow={1} center pad={24} gap={12} title={filePath}>
          <PreviewProblem error={problem.message} onRetry={() => views.restart(target)} />
        </col>,
      );
    }
    return card ? frame(<col h={120} />) : frame(<col grow={1} />);
  }
  const keys = snapshot.keys.length ? { focusable: true, autoFocus: !card, keys: [...snapshot.keys], onKey: (e: { chord: string }) => views.key(target, e.chord) } : {};
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
          <IconButton id={`${scope}-restart`} icon={Icons.stella.RotateCcw} label={t("common.tryAgain")} size={22} onPress={() => views.restart(target)} />
        </row>
      ) : null}
    </col>,
  );
}
