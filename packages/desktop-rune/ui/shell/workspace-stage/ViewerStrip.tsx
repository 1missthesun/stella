import { useEffect, useMemo } from "react";
import type { FileEntry } from "@/features/workspace-display/files-index";
import type { DisplayTab } from "@/features/workspace-display/types";
import { formatTimestampHeader } from "@/features/chat/lib/message-time-labels";
import { translateNow, useLocale, useT } from "@/shared/i18n";
import { fileMenu } from "@/platform/context-menu";
import { showSibling, useViewerSiblings, type StripEntry, type StripSet } from "@/shell/workspace-stage/viewer-siblings";
import { DisplayTabIcon } from "../../features/workspace-display/icons";
import { Icon, Icons } from "../../kit";
import { look, mixOklch, derive, useTokens, type Tokens } from "../../theme";
import { popupMenuBuilder } from "../menu-sections";
import { registerSiblingNav } from "./sibling-nav";

const stripLook = (t: Tokens) =>
  derive(t, "viewer-strip", (t) => ({
    item: mixOklch(t.c.foreground, 6, "transparent"),
    itemRing: mixOklch(t.c.foreground, 14, "transparent"),
    empty: mixOklch(t.c.foreground, 8, "transparent"),
    set: mixOklch(t.c.foreground, 3.5, "transparent"),
    setRing: mixOklch(t.c.foreground, 7, "transparent"),
    setCurrent: mixOklch(t.c.foreground, 8.5, "transparent"),
    setCurrentRing: mixOklch(t.c.foreground, 20, "transparent"),
  }));

type ThumbSource = { kind: "image" | "video" | "pdf"; filePath: string; drivePath: string | null };

const thumbSourceOf = (entry: FileEntry): ThumbSource | null => {
  const payload = entry.payload;
  const drivePath = payload.cloudDrivePath ?? null;
  if (payload.kind === "media" && payload.asset.kind === "image" && payload.asset.filePaths[0]) return { kind: "image", filePath: payload.asset.filePaths[0], drivePath };
  if (payload.kind === "media" && payload.asset.kind === "video") return { kind: "video", filePath: payload.asset.filePath, drivePath };
  if (payload.kind === "pdf") return { kind: "pdf", filePath: payload.filePath, drivePath };
  return null;
};

const extensionOf = (entry: FileEntry): string | null => {
  const payload = entry.payload as Record<string, unknown>;
  const path = typeof payload.filePath === "string" ? payload.filePath : entry.title;
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  return match ? match[1]!.toUpperCase() : null;
};

const shortWhen = (ms: number, locale: string): string => {
  const date = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days <= 0) return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (days === 1) {
    const label = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  }
  if (days < 7) return date.toLocaleDateString(locale, { weekday: "short" });
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
};

const itemId = (entry: FileEntry) => `viewer-strip-item-${entry.id}`;

function StripItem({ entry, current, fromId, tooltip, size }: { entry: FileEntry; current: boolean; fromId: string; tooltip: string; size: number }) {
  const t = useTokens();
  const l = stripLook(t);
  const source = thumbSourceOf(entry);
  const drivePath = entry.payload.cloudDrivePath ?? null;
  const image = source?.kind === "image" && !source.drivePath ? source.filePath : null;
  const ext = source && source.kind !== "pdf" ? null : extensionOf(entry);
  return (
    <box
      id={itemId(entry)}
      role="button"
      label={entry.title}
      title={tooltip}
      selected={current}
      focusable
      w={size}
      h={size}
      radius={8}
      center
      fill={l.item}
      clip={8}
      opacity={current ? 1 : 0.88}
      hoverFill={l.item}
      shadows={current ? [{ x: 0, y: 0, blur: 0, spread: 1.5, color: t.c.background }, { x: 0, y: 0, blur: 0, spread: 3, color: t.c.textStrong }] : [{ x: 0, y: 0, blur: 0, spread: 1, color: l.itemRing, inset: true }]}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 8 }}
      motion={{ dur: 0.12 }}
      onPress={current ? undefined : () => showSibling(fromId, entry)}
      onContextMenu={(at) => void popupMenuBuilder(async () => {
        const open = () => showSibling(fromId, entry);
        const path = drivePath ? null : (source?.filePath ?? entry.filePath);
        if (!path) return [[{ label: translateNow("contextMenu.open"), run: open }]];
        return await fileMenu(path, { open, image: source?.kind === "image" })();
      }, at)}
    >
      {image ? (
        <image src={image} fit="cover" w="full" h="full" />
      ) : source && source.kind !== "pdf" ? (
        <box w="full" h="full" fill={l.empty} />
      ) : (
        <col align="center" gap={2}>
          <DisplayTabIcon kind={entry.kind} size={16} color={t.c.textWeak} />
          {ext ? (
            <text size={8.5} weight={600} tracking={0.34} lineHeight={8.5} color={t.c.textWeak}>
              {ext}
            </text>
          ) : null}
        </col>
      )}
      {source?.kind === "video" ? (
        <box absolute={{ right: 3, bottom: 3 }} w={15} h={15} radius={8} center fill="#0000008c">
          <Icon icon={Icons.stella.Play} size={9} color="#ffffff" />
        </box>
      ) : null}
    </box>
  );
}

/** ⇧← / ⇧→: the first item of the current set (going back) or of the neighbouring set. */
const setJumpTarget = (items: readonly StripEntry[], sets: readonly StripSet[], set: StripSet | null, index: number, backwards: boolean): StripEntry | null => {
  if (!set) return null;
  if (backwards && index !== set.start) return items[set.start] ?? null;
  const at = sets.indexOf(set);
  const neighbour = sets[backwards ? at - 1 : at + 1];
  return neighbour ? (items[neighbour.start] ?? null) : null;
};

/** desktop-ui's `ViewerStrip`: everything of this kind in the chat, grouped by when it arrived; along the bottom, or up the left side when wide. */
export function ViewerStrip({ item, vertical }: { item: DisplayTab; vertical: boolean }) {
  const t = useT();
  const tk = useTokens();
  const l = stripLook(tk);
  const locale = useLocale();
  const { items, index, sets, set } = useViewerSiblings(item.id, item.kind);
  const show = index !== -1 && items.length > 1;
  const grouped = sets.length > 1;
  const size = vertical ? 52 : 44;

  const nav = useMemo(() => {
    if (!show) return null;
    const previous = items[index - 1];
    const next = items[index + 1];
    return {
      canPrevious: Boolean(previous),
      canNext: Boolean(next),
      previous: () => previous && showSibling(item.id, previous),
      next: () => next && showSibling(item.id, next),
      previousLabel: "Previous",
      nextLabel: "Next",
      sets: grouped,
    };
  }, [grouped, index, item.id, items, show]);

  useEffect(
    () =>
      registerSiblingNav(item.id, nav, {
        jump: (backwards) => {
          const target = setJumpTarget(items, sets, set, index, backwards);
          if (!target) return false;
          showSibling(item.id, target);
          return true;
        },
      }),
    [index, item.id, items, nav, set, sets],
  );

  const current = show ? items[index] : null;
  useEffect(() => {
    if (current) void stella.engine.scroll.intoView(itemId(current)).catch(() => {});
  }, [current, vertical]);

  if (!show) return null;

  const tooltipFor = (entry: StripEntry, run: StripSet, at: number) => {
    const count = run.end - run.start;
    const parts = [
      run.from === "user" ? t("shell.display.viewerStrip.fromYou") : run.from === "stella" ? t("shell.display.viewerStrip.fromStella") : null,
      formatTimestampHeader(run.at, locale),
      count > 1 ? t("shell.display.viewerStrip.position", { index: at - run.start + 1, count }) : null,
    ].filter(Boolean);
    return grouped || count > 1 ? `${entry.title}\n${parts.join(" · ")}` : entry.title;
  };

  const List = vertical ? "col" : "row";
  const Set = vertical ? "col" : "row";
  return (
    <row
      id="viewer-strip"
      role="navigation"
      label="Everything in this chat"
      justify="center"
      align="center"
      shrink={false}
      minW={0}
      minH={0}
      pt={vertical ? 10 : 2}
      pr={vertical ? 2 : 10}
      pb={vertical ? 10 : grouped ? 0 : 8}
      pl={10}
    >
      <List
        id="viewer-strip-list"
        role="list"
        align="center"
        gap={vertical ? 26 : 10}
        minW={0}
        minH={0}
        maxW={vertical ? undefined : "100%"}
        maxH={vertical ? "100%" : undefined}
        pad={5}
        pb={grouped ? (vertical ? 20 : 18) : 5}
        scrollX={!vertical}
        scrollY={vertical}
      >
        {sets.map((run) => {
          const isCurrent = run.key === set?.key;
          const caption = shortWhen(run.at, locale);
          return (
            <Set
              key={run.key}
              role="group"
              label={caption}
              align="center"
              gap={5}
              shrink={false}
              radius={13}
              pad={grouped ? 5 : 0}
              fill={grouped ? (isCurrent ? l.setCurrent : l.set) : undefined}
              shadows={grouped ? [{ x: 0, y: 0, blur: 0, spread: 1, color: isCurrent ? l.setCurrentRing : l.setRing, inset: true }] : undefined}
            >
              {items.slice(run.start, run.end).map((entry, offset) => (
                <StripItem key={entry.id} entry={entry} current={entry.id === item.id} fromId={item.id} tooltip={tooltipFor(entry, run, run.start + offset)} size={size} />
              ))}
              {isCurrent && grouped ? (
                <row absolute={{ left: 0, right: 0, bottom: -16 }} justify="center" inert>
                  <text size={10} lineHeight={12} color={tk.c.textWeak} nowrap>
                    {caption}
                  </text>
                </row>
              ) : null}
            </Set>
          );
        })}
      </List>
    </row>
  );
}
