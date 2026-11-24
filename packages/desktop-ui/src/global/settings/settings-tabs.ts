import {
  AudioLines,
  KeyRound,
  Keyboard,
  Lock,
  Settings,
  Sparkles,
  User,
  type IconComponent,
} from "@/ui/icons";

export const SETTINGS_TAB_KEYS = [
  "general",
  "audio",
  "shortcuts",
  "ai",
  "account",
  "privacy",
  "savedValues",
] as const;

export type SettingsTab = (typeof SETTINGS_TAB_KEYS)[number];

export type SettingsTabDef = {
  key: SettingsTab;
  labelKey: string;
  Icon: IconComponent;
};

export const SETTINGS_TABS: SettingsTabDef[] = [
  { key: "general", labelKey: "settings.tabs.general", Icon: Settings },
  { key: "audio", labelKey: "settings.tabs.audio", Icon: AudioLines },
  { key: "shortcuts", labelKey: "settings.tabs.shortcuts", Icon: Keyboard },
  { key: "ai", labelKey: "settings.tabs.ai", Icon: Sparkles },
  { key: "account", labelKey: "settings.tabs.account", Icon: User },
  { key: "privacy", labelKey: "settings.tabs.privacy", Icon: Lock },
  {
    key: "savedValues",
    labelKey: "settings.secureValues.title",
    Icon: KeyRound,
  },
];

export const SETTINGS_TAB_GROUPS: {
  labelKey: string;
  tabs: SettingsTab[];
}[] = [
  {
    labelKey: "settings.groups.app",
    tabs: ["general", "audio", "shortcuts"],
  },
  {
    labelKey: "settings.groups.personal",
    tabs: ["ai", "account", "privacy", "savedValues"],
  },
];

export const availableSettingsTabs = (website: boolean) =>
  website
    ? SETTINGS_TABS.filter(
        (tab) => tab.key !== "shortcuts" && tab.key !== "savedValues",
      )
    : SETTINGS_TABS;
