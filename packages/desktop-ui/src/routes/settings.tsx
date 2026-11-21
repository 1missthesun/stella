import { createFileRoute } from "@tanstack/react-router";
import { SETTINGS_TAB_KEYS, type SettingsTab } from "@/global/settings/settings-tabs";

type SettingsSearch = { tab?: SettingsTab };

const isSettingsTab = (value: unknown): value is SettingsTab =>
  (SETTINGS_TAB_KEYS as readonly unknown[]).includes(value);

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch =>
    isSettingsTab(search.tab) ? { tab: search.tab } : {},
});
