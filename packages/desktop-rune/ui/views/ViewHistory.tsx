// A view's version history, on its panel and its chat card: every version the conversation
// carries (Stella's edits, tasks' edits, the user's restores), a preview of an older one on every
// surface of the view, and a restore that makes it the newest version again on every device. A
// restore is a new version, so it can be undone like any other change.
import { useCallback, useEffect, useState } from "react";
import { undoTarget, type ViewVersion } from "@stella/views/history";
import type { ViewSnapshot } from "@stella/views/session";
import { useT } from "@/shared/i18n";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";
import { Button, DropdownMenu, Icon, IconButton, Icons, MenuItem, showToast } from "../kit";
import { fontSize, look, useTokens } from "../theme";

const NONE: readonly ViewVersion[] = [];
const WHO = look(fontSize.base, 500, { lh: 1.3 });
const META = look(fontSize.sm, 400, { lh: 1.3 });
const BAR = look(fontSize.sm, 500);
const BAR_META = look(fontSize.sm, 400);

type T = ReturnType<typeof useT>;

/** The view's versions (oldest first) and the one being previewed, kept current. */
export function useViewHistory(filePath: string): { versions: readonly ViewVersion[]; preview: ViewVersion | null } {
  const views = globalThis.stella.views;
  const read = useCallback(() => ({ versions: views?.history?.(filePath) ?? NONE, preview: views?.previewing?.(filePath) ?? null }), [views, filePath]);
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return views?.onHistory?.((changed) => {
      if (changed === filePath || changed === "*") setState(read());
    });
  }, [views, filePath, read]);
  return state;
}

/** When a version was made: the time today, else the date too. */
export function versionTime(ms: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

const who = (t: T, version: ViewVersion): string =>
  version.by.kind === "restore" ? t("shell.display.viewHistory.you") : version.by.kind === "task" ? (version.by.title ?? t("shell.display.viewHistory.task")) : t("shell.display.viewHistory.stella");

async function restore(t: T, filePath: string, version: ViewVersion) {
  const views = globalThis.stella.views;
  const result = await views?.restore?.(filePath, version.id);
  const time = versionTime(version.createdAt);
  if (!result?.restored) showToast({ title: t("shell.display.viewHistory.restoreFailed"), ...(result?.error ? { description: result.error } : {}), variant: "error" });
  else showToast({ title: t(result.shared ? "shell.display.viewHistory.restored" : "shell.display.viewHistory.restoredHere", { time }), variant: "success" });
}

/** The history button and its list of versions; choosing an older one previews it. */
export function ViewHistoryButton({ filePath, scope, size = 26 }: { filePath: string; scope: string; size?: number }) {
  const t = useT();
  const tk = useTokens();
  const { versions, preview } = useViewHistory(filePath);
  const [open, setOpen] = useState(false);
  if (versions.length < 2) return null;
  const latest = versions.at(-1)!;
  const shown = preview ?? latest;
  return (
    <DropdownMenu
      id={`${scope}-history`}
      open={open}
      onOpenChange={setOpen}
      align="end"
      minW={260}
      maxW={320}
      maxH={420}
      trigger={({ id, toggle }) => <IconButton id={id} icon={Icons.stella.History} label={t("shell.display.viewHistory.title")} size={size} active={open || preview !== null} onPress={toggle} />}
    >
      {[...versions].reverse().map((version) => (
        <MenuItem
          key={version.id}
          id={`${scope}-history-${version.id}`}
          onSelect={() => globalThis.stella.views?.setPreview?.(filePath, version.id === latest.id ? null : version.id)}
          trailing={
            version.id === shown.id ? <Icon icon={Icons.stella.Check} size={14} color={tk.c.textStrong} /> : null
          }
        >
          <col gap={2} minW={0}>
            <row gap={8} align="center" minW={0}>
              <text {...WHO} color={tk.c.textStrong} shrink truncate>
                {who(t, version)}
              </text>
              <text {...META} color={tk.c.textWeak} shrink={false} nowrap>
                {version.id === latest.id ? t("shell.display.viewHistory.current") : versionTime(version.createdAt)}
              </text>
            </row>
            {version.by.kind === "restore" ? (
              <text {...META} color={tk.c.textWeak} truncate>
                {t("shell.display.viewHistory.restoredFrom", { time: versionTime(version.by.from) })}
              </text>
            ) : null}
          </col>
        </MenuItem>
      ))}
    </DropdownMenu>
  );
}

/** "Undo last change": brings back the version before an agent's latest edit (as a new version). */
export function ViewUndoButton({ filePath, scope, compact = false }: { filePath: string; scope: string; compact?: boolean }) {
  const t = useT();
  const { versions, preview } = useViewHistory(filePath);
  const target = preview ? null : undoTarget(versions);
  if (!target) return null;
  const onPress = () => void restore(t, filePath, target);
  return compact ? (
    <IconButton id={`${scope}-undo`} icon={Icons.stella.RotateCcw} label={t("shell.display.viewHistory.undo")} size={26} onPress={onPress} />
  ) : (
    <Button id={`${scope}-undo`} variant="ghost" icon={Icons.stella.RotateCcw} onPress={onPress}>
      {t("shell.display.viewHistory.undo")}
    </Button>
  );
}

/**
 * Shown over a view while an older version is previewed: who made it and when, back to the
 * current one, and Restore. A version that can't run with the view's data as it is now (it fails
 * in the preview) isn't restored as it is: Stella is asked to bring it back adapted to that data.
 */
export function ViewPreviewBar({ filePath, title, version, snapshot, scope }: { filePath: string; title: string; version: ViewVersion; snapshot: ViewSnapshot | null; scope: string }) {
  const t = useT();
  const tk = useTokens();
  const views = globalThis.stella.views;
  const misfit = Boolean(snapshot?.problem);
  const time = versionTime(version.createdAt);
  const back = () => views?.setPreview?.(filePath, null);
  const ask = () => {
    window.dispatchEvent(new CustomEvent(STELLA_SEND_MESSAGE_EVENT, { detail: { text: t("shell.display.viewHistory.askMessage", { title, time }) } }));
    back();
  };
  return (
    <row id={`${scope}-preview-bar`} shrink={false} w="full" align="center" gap={8} pl={14} pr={8} py={6} fill={tk.c.surfaceBase} borderSides={[0, 0, 1, 0]} border={tk.c.borderWeak} role="status">
      <Icon icon={Icons.stella.History} size={14} color={tk.c.textWeak} />
      <row grow={1} minW={0} gap={6} align="center">
        <text {...BAR} color={tk.c.textStrong} shrink truncate>
          {who(t, version)}
        </text>
        <text {...BAR_META} color={tk.c.textWeak} shrink={false} nowrap>
          {time}
        </text>
      </row>
      <Button id={`${scope}-preview-back`} variant="ghost" onPress={back}>
        {t("shell.display.viewHistory.back")}
      </Button>
      {misfit ? (
        <Button id={`${scope}-preview-ask`} variant="primary" icon={Icons.stella.Sparkles} onPress={ask}>
          {t("shell.display.viewHistory.ask")}
        </Button>
      ) : (
        <Button id={`${scope}-preview-restore`} variant="primary" onPress={() => void restore(t, filePath, version)}>
          {t("shell.display.viewHistory.restore")}
        </Button>
      )}
    </row>
  );
}
