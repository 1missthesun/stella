import { useState } from "react";
import { useT } from "@/shared/i18n";
import { Icon, type IconData } from "../../../../../desktop-rune/ui/kit";
import { menuSurface } from "../../../../../desktop-rune/ui/kit/Menu";
import { alpha, layer, useTokens } from "../../../../../desktop-rune/ui/theme";
import { AdaptiveGlass, chromeGlass, GlassSheen, useGlassBackdrop } from "../../../../../desktop-rune/ui/shell/glass";
import { glyph } from "../../icons";
import { rt, useRn } from "../../rn";
import type { SortOrder, SourceFilter } from "./model";

// packages/mobile FilesPage's bottom stack: the glass search field and the round filter button
// beside it, riding up with the keyboard (KeyboardStickyView). The button opens the source filter
// and sort order as one menu, drawn here as iOS draws the RN app's native pull-down menu.

const SEARCH_HEIGHT = 48;
export const SEARCH_STACK_HEIGHT = SEARCH_HEIGHT;
const MENU_ID = "phone-files-filter-menu";
const BUTTON_ID = "phone-files-filter";

type Choice = { id: string; label: string; selected: boolean; icon?: IconData; onPress: () => void };

const SEARCH_LOOK = rt(16, 500, -0.2);
const MENU_LOOK = rt(17, 400, -0.4);

function FilterMenu({ groups, onClose }: { groups: Choice[][]; onClose: () => void }) {
  const t = useTokens();
  const c = useRn();
  const surface = menuSurface(t);
  return (
    <col id={MENU_ID} role="menu" anchor={{ to: BUTTON_ID, side: "top", align: "end", gap: 10 }} raise={layer.menu} modal={{ clickOutside: true, returnFocus: false }} onDismiss={onClose} w={250} {...surface} radius={16} pad={0} clip={16}>
      {groups.map((group, g) => (
        <col key={g} w="full">
          {g > 0 ? <box w="full" h={8} fill={alpha(c.text, c.dark ? 0.16 : 0.06)} /> : null}
          {group.map((choice, i) => (
            <row
              key={choice.id}
              id={`${MENU_ID}-${choice.id}`}
              role="menuitemradio"
              checked={choice.selected}
              label={choice.label}
              focusable
              w="full"
              minH={44}
              pl={12}
              pr={16}
              gap={8}
              align="center"
              borderSides={i > 0 ? [0.5, 0, 0, 0] : undefined}
              border={i > 0 ? alpha(c.text, c.dark ? 0.14 : 0.1) : undefined}
              press={alpha(c.text, c.dark ? 0.1 : 0.06)}
              onPress={() => {
                choice.onPress();
                onClose();
              }}
            >
              <box w={18} h={18} center shrink={false}>
                {choice.selected ? <Icon icon={glyph("check")} size={15} color={c.text} /> : null}
              </box>
              <text {...MENU_LOOK} color={c.text} grow={1} minW={0} maxLines={1}>
                {choice.label}
              </text>
              {choice.icon ? <Icon icon={choice.icon} size={18} color={c.text} /> : null}
            </row>
          ))}
        </col>
      ))}
    </col>
  );
}

function FilterButton({ open, narrowed, onPress }: { open: boolean; narrowed: boolean; onPress: () => void }) {
  const t = useTokens();
  const tr = useT();
  const m = chromeGlass(t).controls;
  return (
    <box id={BUTTON_ID} role="button" label={tr("mobile.activityHub.files.filterLabel")} expanded={open} focusable w={SEARCH_HEIGHT} h={SEARCH_HEIGHT} radius={SEARCH_HEIGHT / 2} center fx={m.fx} fill={m.fill} border={m.border} onBackdrop={useGlassBackdrop()} pressScale={0.92} onPress={onPress}>
      <GlassSheen radius={SEARCH_HEIGHT / 2} />
      <Icon icon={glyph("filter")} size={18} color={narrowed ? t.c.primary : t.c.textStrong} />
    </box>
  );
}

export function SearchStack({
  active,
  bottom,
  query,
  onQuery,
  sources,
  source,
  onSource,
  sort,
  onSort,
  sourceLabel,
}: {
  active: boolean;
  bottom: number;
  query: string;
  onQuery: (next: string) => void;
  sources: readonly Exclude<SourceFilter, "all">[];
  source: SourceFilter;
  onSource: (next: SourceFilter) => void;
  sort: SortOrder;
  onSort: (next: SortOrder) => void;
  sourceLabel: (source: SourceFilter) => string;
}) {
  const t = useTokens();
  const c = useRn();
  const tr = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const glass = chromeGlass(t);
  const narrowed = source !== "all" || sort !== "newest";
  const groups: Choice[][] = [
    [
      { id: "all", label: sourceLabel("all"), selected: source === "all", onPress: () => onSource("all") },
      ...sources.map((s) => ({ id: s, label: sourceLabel(s), selected: source === s, icon: glyph(s === "cloud" ? "cloud" : "desktop"), onPress: () => onSource(s) })),
    ],
    [
      { id: "newest", label: tr("mobile.activityHub.files.sortNewest"), selected: sort === "newest", onPress: () => onSort("newest") },
      { id: "oldest", label: tr("mobile.activityHub.files.sortOldest"), selected: sort === "oldest", onPress: () => onSort("oldest") },
      { id: "name", label: tr("mobile.activityHub.files.sortName"), selected: sort === "name", onPress: () => onSort("name") },
    ],
  ];
  return (
    <row id="phone-files-search-stack" absolute={{ left: 24, right: 24, bottom: bottom + 4 }} h={SEARCH_HEIGHT} gap={10} align="center" keyboard={{ lift: bottom }}>
      <row id="phone-files-search" grow={1} minW={0} h={SEARCH_HEIGHT} px={16} gap={10} align="center" radius={SEARCH_HEIGHT / 2} fx={glass.composer.fx} fill={glass.composer.fill} border={glass.composer.border}>
        <Icon icon={glyph("search")} size={16} color={c.textMuted} />
        {/* The phone's fields are native views laid over the page; one on a tab in the background would show through, so it is there only while Files is. */}
        {active ? (
          <input id="phone-files-search-input" grow={1} minW={0} h={SEARCH_HEIGHT} value={query} placeholder={tr("mobile.activityHub.files.searchPlaceholder")} placeholderColor={alpha(c.textMuted, 0.8)} label={tr("mobile.activityHub.files.searchPlaceholder")} {...SEARCH_LOOK} color={c.text} caretColor={c.accent} onInput={onQuery} />
        ) : (
          <text grow={1} minW={0} {...SEARCH_LOOK} color={query ? c.text : alpha(c.textMuted, 0.8)} maxLines={1}>
            {query || tr("mobile.activityHub.files.searchPlaceholder")}
          </text>
        )}
        {query.length > 0 ? (
          <box id="phone-files-search-clear" role="button" label={tr("mobile.activityHub.search.clear")} focusable w={28} h={28} mr={-7} center pressScale={0.9} onPress={() => onQuery("")}>
            <Icon icon={glyph("xmark")} size={14} color={c.textMuted} />
          </box>
        ) : null}
      </row>
      <AdaptiveGlass>
        <FilterButton open={menuOpen} narrowed={narrowed} onPress={() => setMenuOpen((open) => !open)} />
      </AdaptiveGlass>
      {menuOpen ? <FilterMenu groups={groups} onClose={() => setMenuOpen(false)} /> : null}
    </row>
  );
}
