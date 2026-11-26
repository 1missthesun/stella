import { ArrowRight, Press, Search, T, tx } from "../kit/compat";
import { useSettings } from "./settings.styles";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  expandedMatchTerms,
  searchSettings,
  type ScoredSettingsSearchEntry,
} from "@/global/settings/lib/settings-search-index";
import {
  SETTINGS_TABS,
  type SettingsTab,
} from "@/global/settings/settings-tabs";
import { useT } from "@/shared/i18n";
import { platformCapabilities } from "@/platform/capabilities";

interface SettingsSearchResultsProps {
  query: string;
  onSelect: (result: ScoredSettingsSearchEntry) => void;
  onClear: () => void;
}

export function SettingsSearchResults({
  query,
  onSelect,
  onClear,
}: SettingsSearchResultsProps) {
  const s = useSettings();
  const t = useT();
  const [linkHover, setLinkHover] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const highlightTerms = useMemo(() => expandedMatchTerms(query), [query]);
  const results = useMemo(
    () =>
      searchSettings(query, t, {
        host: platformCapabilities.website ? "website" : "native",
        platform: window.electronAPI?.platform,
      }),
    [query, t],
  );
  const trimmedQuery = query.trim();

  if (results.length === 0) {
    return (
      <col {...s.settingsSearchResults} {...s.settingsSearchResultsEmpty}>
        <row {...s.settingsSearchResultsEmptyIcon}>
          <Search size={20} strokeWidth={1.5} color={s.settingsSearchResultsEmptyIcon.color} />
        </row>
        <T {...tx(s.settingsSearchResultsEmpty)} w="full" {...s.settingsSearchResultsEmptyTitle}>
          {t("settings.search.noResultsTitle", { query: trimmedQuery })}
        </T>
        <col w="full" {...s.settingsSearchResultsEmptyBody}>
          {t("settings.search.noResultsBody")}{" "}
          <Press text={tx(s.settingsSearchResultsEmpty, s.settingsSearchResultsEmptyBody)} {...s.settingsSearchResultsLink} underline={linkHover} onHover={setLinkHover} onPress={onClear}>
            {t("settings.search.clear")}
          </Press>
          .
        </col>
      </col>
    );
  }

  const resultsCount = results.length;
  const countKey =
    resultsCount === 1
      ? "settings.search.resultsOne"
      : "settings.search.resultsOther";
  const ariaKey =
    resultsCount === 1
      ? "settings.search.resultsAriaOne"
      : "settings.search.resultsAriaOther";

  return (
    <col {...s.settingsSearchResults} role="listbox" label={t(ariaKey, { count: resultsCount })}>
      <row w="full" wrap {...s.settingsSearchResultsHeader}>
        <T {...tx(s.settingsSearchResultsHeader)}>{`${t(countKey, { count: resultsCount })}\u00a0`}</T>
        <T {...tx(s.settingsSearchResultsHeader)} {...s.settingsSearchResultsHeaderQuery}>
          {trimmedQuery}
        </T>
      </row>
      <col {...s.settingsSearchResultsList}>
        {results.map((entry, index) => (
          <col w="full" key={`${entry.tab}:${entry.title}`} {...(index > 0 ? s.settingsSearchResultDivider : null)}>
            <Press {...s.settingsSearchResultButton} role="option" selected={index === 0} onHover={(on: boolean) => setHovered((h) => (on ? index : h === index ? null : h))} onPress={() => onSelect(entry)}>
              <col {...s.settingsSearchResultBody}>
                <T {...tx(s.settingsSearchResultButton)} w="full" {...s.settingsSearchResultTitle}>
                  {highlightTokens(entry.title, highlightTerms)}
                </T>
                <T {...tx(s.settingsSearchResultButton)} w="full" {...s.settingsSearchResultDesc}>
                  {highlightTokens(entry.description, highlightTerms)}
                </T>
              </col>
              <row {...s.settingsSearchResultMeta}>
                <T {...tx(s.settingsSearchResultButton)} {...s.settingsSearchResultTab}>
                  {t(getTabLabelKey(entry.tab))}
                </T>
                <ArrowRight size={13} strokeWidth={1.85} {...s.settingsSearchResultArrow} {...(hovered === index ? { opacity: 1, x: 0, ...s.settingsSearchResultArrowHover } : { x: -3 })} color={hovered === index ? s.settingsSearchResultArrowHover.color : s.settingsSearchResultArrow.color} />
              </row>
            </Press>
          </col>
        ))}
      </col>
    </col>
  );
}

function getTabLabelKey(tab: SettingsTab): string {
  return SETTINGS_TABS.find((entry) => entry.key === tab)?.labelKey ?? "";
}

function highlightTokens(text: string, terms: string[]): ReactNode {
  const s = useSettings();
  if (!text || terms.length === 0) return text;

  const sorted = [...terms]
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return text;

  const pattern = sorted.map(escapeRegExp).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return (
        <T {...s.settingsSearchMatch} key={index}>
          {part}
        </T>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
