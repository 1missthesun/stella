import { ChevronDown, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Press, T, tx } from "../kit/compat";
import { useSettings } from "./settings.styles";
import { AiryDotItem } from "./AiryControls";
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/shared/i18n";
import {
  SETTINGS_TAB_GROUPS,
  type SettingsTab,
  type SettingsTabDef,
} from "@/global/settings/settings-tabs";

interface SettingsNavProps {
  tabs: SettingsTabDef[];
  activeTab: SettingsTab | null;
  onSelect: (tab: SettingsTab) => void;
  label: string;
}

const tabButtonProps = (tab: SettingsTab, isActive: boolean) => ({
  id: `settings-tab-${tab}`,
  type: "button" as const,
  role: "tab",
  "aria-selected": isActive,
  "aria-controls": `settings-tabpanel-${tab}`,
  tabIndex: isActive ? 0 : -1,
});

export function SettingsRailNav({
  tabs,
  activeTab,
  onSelect,
  label,
}: SettingsNavProps) {
  const s = useSettings();
  const t = useT();
  return (
    <col {...s.settingsRailNav} role="tablist" label={label}>
      {SETTINGS_TAB_GROUPS.map((group) => {
        const groupTabs = group.tabs
          .map((key) => tabs.find((tab) => tab.key === key))
          .filter((tab): tab is SettingsTabDef => tab !== undefined);
        if (groupTabs.length === 0) return null;
        return (
          <col {...s.settingsRailGroup} key={group.labelKey}>
            <T w="full" {...s.settingsRailGroupLabel}>
              {t(group.labelKey)}
            </T>
            {groupTabs.map(({ key, labelKey, Icon }) => {
              const isActive = activeTab === key;
              return (
                <Press {...s.settingsRailItem} key={key} {...tabButtonProps(key, isActive)} hoverGroup onPress={() => onSelect(key)} {...(isActive ? s.settingsRailItemActive : null)}>
                  <box {...s.settingsRailItemIcon} {...(isActive ? { opacity: 1, hoverOpacity: undefined } : null)}>
                    <Icon size={16} strokeWidth={1.75} />
                  </box>
                  <T {...tx(s.settingsRailItem)} {...(isActive ? tx(s.settingsRailItemActive) : null)} {...s.settingsRailItemLabel}>{t(labelKey)}</T>
                  {isActive ? <box {...s.settingsRailDot} /> : null}
                </Press>
              );
            })}
          </col>
        );
      })}
    </col>
  );
}

const BAR_GAP = 18;
const MORE_KEY = "__more";

export function SettingsBarNav({
  tabs,
  activeTab,
  onSelect,
  label,
}: SettingsNavProps) {
  const s = useSettings();
  const t = useT();
  const [available, setAvailable] = useState(0);
  const widths = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const noteWidth = (key: string) => (r: { w: number }) => {
    if (widths.current.get(key) === r.w) return;
    widths.current.set(key, r.w);
    setMeasured((n) => n + 1);
  };

  useLayoutEffect(() => {
    if (available <= 0) return;
    const items = tabs.map((tab) => widths.current.get(tab.key) ?? 0);
    const moreWidth = widths.current.get(MORE_KEY) ?? 0;
    const total = items.reduce((sum, width, index) => sum + width + (index > 0 ? BAR_GAP : 0), 0);
    if (total <= available) {
      setVisibleCount(items.length);
      return;
    }
    let used = moreWidth;
    let count = 0;
    for (const width of items) {
      if (used + BAR_GAP + width > available) break;
      used += BAR_GAP + width;
      count += 1;
    }
    setVisibleCount(count);
  }, [tabs, t, available, measured]);

  const visible = tabs.slice(0, visibleCount);
  const overflow = tabs.slice(visibleCount);
  const overflowActive = overflow.some((tab) => tab.key === activeTab);

  return (
    <col w="full" {...s.settingsBarNavWrap}>
      <row {...s.settingsBarNav} role="tablist" label={label} onSize={(r) => setAvailable(r.w)}>
        {visible.map(({ key, labelKey }) => {
          const isActive = activeTab === key;
          return <AiryDotItem bar key={key} id={`settings-tab-${key}`} role="tab" label={t(labelKey)} active={isActive} onPress={() => onSelect(key)} tabProps={tabButtonProps(key, isActive)} />;
        })}
        {overflow.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Press {...s.settingsBarItem} {...s.settingsBarMore} {...(overflowActive ? s.settingsBarItemActive : null)}>
                {t("settings.nav.more")}
                <ChevronDown size={14} strokeWidth={1.75} color={s.settingsBarItem.color} />
              </Press>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              {overflow.map(({ key, labelKey, Icon }) => (
                <DropdownMenuItem key={key} data-active={activeTab === key ? "true" : undefined} onSelect={() => onSelect(key)}>
                  <Icon size={15} strokeWidth={1.75} />
                  {t(labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </row>
      <row {...s.settingsBarMeasure} inert>
        {tabs.map(({ key, labelKey }) => (
          <T {...s.settingsBarItem} key={key} onLayout={noteWidth(key)}>
            {t(labelKey)}
          </T>
        ))}
        <row {...s.settingsBarItem} {...s.settingsBarMore} onLayout={noteWidth(MORE_KEY)}>
          {t("settings.nav.more")}
          <ChevronDown size={14} strokeWidth={1.75} color={s.settingsBarItem.color} />
        </row>
      </row>
    </col>
  );
}
