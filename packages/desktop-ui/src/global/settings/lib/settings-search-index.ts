import type { SettingsTab } from "@/global/settings/settings-tabs";

export type SettingsSearchTranslate = (key: string) => string;
export type SettingsSearchHost = "native" | "website";
export type SettingsSearchAvailability = "all" | "native";
export type SettingsSearchPlatform = "darwin" | "linux" | "win32";

/**
 * Definition of a searchable Settings entry. One entry per
 * `.settings-card` (or logical row) so users find a card by its heading,
 * description, or any row label / sublabel inside it.
 *
 * This catalog drives the global "Search settings" results view: every
 * tab can be searched at once because the catalog covers them all, even
 * the tabs that haven't been lazy-loaded yet.
 *
 * Two layers of synonym handling:
 *   - Per-entry `keywords` — the strongest signal. Use this for
 *     setting-specific aliases ("byok", "anthropic oauth", "rtl").
 *     Keywords stay English; localized search still matches via the
 *     translated title/description.
 *   - Global `SEARCH_SYNONYMS` map below — for words that should match
 *     across many settings ("mute" → sound/audio/volume/notification).
 *
 * `titleKey` MUST resolve to the same string rendered in the matching
 * `<h3 className="settings-card-title">…</h3>` (or `cardTitleKey` for
 * row-level entries) — that resolved title is what we use to scroll the
 * user to the section after jumping to its tab, so reusing the card's
 * own catalog key keeps it correct in every locale automatically.
 */
export interface SettingsSearchEntryDef {
  tab: SettingsTab;
  availability?: SettingsSearchAvailability;
  platforms?: readonly SettingsSearchPlatform[];
  titleKey: string;
  descriptionKey: string;
  cardTitleKey?: string;
  keywords: string[];
}

export interface ResolvedSettingsSearchEntry {
  tab: SettingsTab;
  availability: SettingsSearchAvailability;
  platforms?: readonly SettingsSearchPlatform[];
  title: string;
  description: string;
  cardTitle?: string;
  keywords: string[];
}

export const SETTINGS_SEARCH_ENTRY_DEFS: SettingsSearchEntryDef[] = [
  {
    tab: "privacy",
    availability: "native",
    titleKey: "settings.chatStorage.title",
    descriptionKey: "settings.chatStorage.description",
    keywords: ["privacy", "local", "cloud", "history", "storage", "sync", "messages"],
  },
  {
    tab: "privacy",
    availability: "native",
    titleKey: "settings.telemetry.title",
    descriptionKey: "settings.telemetry.description",
    keywords: ["privacy", "telemetry", "analytics", "tracking", "metrics", "anonymous"],
  },
  {
    tab: "privacy",
    titleKey: "settings.yourData.title",
    descriptionKey: "settings.yourData.description",
    keywords: ["privacy", "export", "download", "data", "support", "access", "encryption"],
  },
  {
    tab: "account",
    titleKey: "settings.sessions.title",
    descriptionKey: "settings.sessions.description",
    keywords: ["security", "devices", "sessions", "sign out", "revoke"],
  },
  {
    tab: "account",
    titleKey: "settings.passkeys.title",
    descriptionKey: "settings.passkeys.description",
    keywords: ["security", "passkey", "webauthn", "fido", "sign in"],
  },
  {
    tab: "general",
    titleKey: "settings.language.title",
    descriptionKey: "settings.language.description",
    keywords: [
      "locale",
      "translation",
      "english",
      "spanish",
      "french",
      "chinese",
      "japanese",
      "korean",
      "german",
      "italian",
      "arabic",
      "hebrew",
      "rtl",
    ],
  },
  {
    tab: "privacy",
    titleKey: "settings.memory.title",
    descriptionKey: "settings.memory.description",
    keywords: [
      "memory",
      "memories",
      "remember",
      "profile",
      "context",
      "personalization",
      "main.md",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.developerPreviews.title",
    descriptionKey: "settings.developerPreviews.description",
    keywords: ["developer", "code", "diff", "file previews", "preview"],
  },
  {
    tab: "general",
    availability: "native",
    platforms: ["darwin"],
    titleKey: "settings.nativeFontSmoothing.title",
    descriptionKey: "settings.nativeFontSmoothing.description",
    keywords: [
      "font",
      "fonts",
      "antialias",
      "anti-aliasing",
      "anti aliasing",
      "smoothing",
      "grayscale",
      "subpixel",
      "rendering",
      "text",
      "macos",
      "mac",
      "appearance",
    ],
  },
  {
    tab: "general",
    titleKey: "settings.motion.title",
    descriptionKey: "settings.motion.reduceMotion.description",
    keywords: [
      "reduce motion",
      "reduced motion",
      "animation",
      "animations",
      "motion",
      "accessibility",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.notifications.title",
    descriptionKey: "settings.notifications.description",
    keywords: [
      "alerts",
      "sound notifications",
      "agent done",
      "mute",
      "silence",
      "quiet",
      "ping",
      "chime",
      "bell",
      "do not disturb",
      "notifications",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.escalation.title",
    descriptionKey: "settings.escalation.description",
    keywords: [
      "ask",
      "asks",
      "escalation",
      "escalate",
      "urgency",
      "quiet hours",
      "do not disturb",
      "focus mode",
      "breakthrough",
      "push",
      "phone push",
      "rate limit",
      "asks per hour",
      "interrupt",
      "needs you",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.escalation.quietHours.label",
    descriptionKey: "settings.escalation.quietHours.sublabel",
    cardTitleKey: "settings.escalation.title",
    keywords: [
      "quiet hours",
      "night",
      "sleep",
      "do not disturb",
      "dnd",
      "silence",
      "schedule",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.power.title",
    descriptionKey: "settings.power.description",
    keywords: [
      "prevent sleep",
      "keep awake",
      "battery",
      "screensaver",
      "energy",
      "idle",
      "power",
      "caffeinate",
      "no sleep",
      "stay on",
    ],
  },
  {
    tab: "privacy",
    availability: "native",
    titleKey: "settings.lockedComputerUse.title",
    descriptionKey: "settings.lockedComputerUse.description",
    keywords: [
      "computer use",
      "lock screen",
      "locked use",
      "unlock",
      "authorization",
      "remote",
      "desktop automation",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.resetCustomizations.title",
    descriptionKey: "settings.resetCustomizations.description",
    keywords: [
      "restore defaults",
      "reset customizations",
      "remove customizations",
      "skills",
      "personality",
      "factory reset",
      "trash",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.systemPrompt.title",
    descriptionKey: "settings.systemPrompt.description",
    keywords: [
      "prompt preset",
      "prompt presets",
      "system instructions",
      "assistant prompt",
      "worker prompt",
      "custom prompt",
      "personality",
    ],
  },
  {
    tab: "general",
    availability: "native",
    titleKey: "settings.browserExtension.title",
    descriptionKey: "settings.browserExtension.description",
    keywords: [
      "chrome",
      "extension",
      "arc",
      "brave",
      "edge",
      "chromium",
      "plugin",
      "addon",
      "add-on",
      "browser extension",
    ],
  },
  {
    tab: "privacy",
    availability: "native",
    titleKey: "settings.permissions.title",
    descriptionKey: "settings.search.descriptions.permissions",
    keywords: [
      "accessibility",
      "screen capture",
      "screen recording",
      "microphone permission",
      "macos permissions",
      "system settings",
      "tcc",
      "privacy",
      "security",
      "allow",
      "camera",
    ],
  },

  {
    tab: "shortcuts",
    availability: "native",
    titleKey: "settings.shortcuts.title",
    descriptionKey: "settings.search.descriptions.shortcuts",
    keywords: [
      "keybindings",
      "hotkeys",
      "keyboard shortcuts",
      "dictation",
      "voice",
      "option key",
      "bindings",
    ],
  },

  {
    tab: "account",
    titleKey: "settings.engineAccounts.cardTitle",
    descriptionKey: "settings.engineAccounts.cardIntro",
    keywords: [
      "claude",
      "claude code",
      "anthropic",
      "chatgpt",
      "openai",
      "codex",
      "subscription",
      "pro",
      "max",
      "plus",
      "sign in",
      "switch account",
    ],
  },
  {
    tab: "account",
    titleKey: "settings.account.title",
    descriptionKey: "settings.search.descriptions.account",
    keywords: [
      "sign out",
      "log out",
      "logout",
      "signout",
      "delete data",
      "delete account",
      "erase data",
      "wipe",
      "profile",
      "user",
      "subscription",
    ],
  },
  {
    tab: "account",
    titleKey: "settings.account.legal.title",
    descriptionKey: "settings.search.descriptions.legal",
    keywords: ["terms of service", "tos", "privacy policy", "license"],
  },

  {
    tab: "audio",
    titleKey: "settings.audio.microphone.title",
    descriptionKey: "settings.search.descriptions.microphone",
    keywords: [
      "mic",
      "input device",
      "hey stella",
      "wake word",
      "super fast dictation",
      "dictation sounds",
      "gpt live",
      "cloud transcription",
      "voice",
      "dictate",
      "speech to text",
      "stt",
      "mute",
      "silence",
    ],
  },
  {
    tab: "audio",
    titleKey: "settings.audio.speaker.title",
    descriptionKey: "settings.search.descriptions.speaker",
    keywords: [
      "output device",
      "headphones",
      "audio output",
      "playback",
      "volume",
      "mute",
      "silence",
      "speakers",
      "sound output",
    ],
  },
  {
    tab: "audio",
    availability: "native",
    titleKey: "settings.voiceAgent.title",
    descriptionKey: "settings.voiceAgent.description",
    keywords: [
      "voice",
      "call",
      "talk",
      "realtime",
      "hide voice",
      "turn off voice",
      "voice mode",
    ],
  },

  {
    tab: "audio",
    availability: "native",
    titleKey: "settings.audio.wakeWord.label",
    cardTitleKey: "settings.audio.microphone.title",
    descriptionKey: "settings.search.descriptions.wakeWord",
    keywords: ["hey stella", "wake", "always listening", "voice trigger"],
  },
  {
    tab: "audio",
    availability: "native",
    titleKey: "settings.audio.dictationSounds.label",
    cardTitleKey: "settings.audio.microphone.title",
    descriptionKey: "settings.audio.dictationSounds.description",
    keywords: ["chime", "ping", "feedback", "mute dictation"],
  },
  {
    tab: "account",
    titleKey: "settings.account.signOut.label",
    cardTitleKey: "settings.account.title",
    descriptionKey: "settings.account.signOut.description",
    keywords: ["log out", "logout", "signout"],
  },
  {
    tab: "account",
    titleKey: "settings.account.deleteAccount.label",
    cardTitleKey: "settings.account.title",
    descriptionKey: "settings.account.deleteAccount.description",
    keywords: ["close account", "remove account", "cancel account"],
  },
  {
    tab: "account",
    titleKey: "settings.account.deleteData.label",
    cardTitleKey: "settings.account.title",
    descriptionKey: "settings.account.deleteData.description",
    keywords: ["wipe", "clear", "erase", "reset"],
  },
];

const SEARCH_SYNONYMS_RAW: Record<string, string[]> = {
  mute: ["sound", "audio", "volume", "silence", "quiet", "notification"],
  silence: ["mute", "quiet", "sound", "notification"],
  quiet: ["mute", "silence", "sound"],
  sound: ["audio", "notification", "volume"],
  audio: ["sound", "volume", "speaker", "microphone"],
  volume: ["sound", "audio", "loudness"],
  notification: ["alert", "sound", "ping"],
  alert: ["notification", "ping"],

  mic: ["microphone", "audio", "voice"],
  microphone: ["mic", "audio", "voice"],
  voice: ["microphone", "dictation", "speech"],
  dictation: ["voice", "transcription", "speech to text"],
  speech: ["voice", "dictation"],
  transcribe: ["dictation", "transcription"],

  speaker: ["audio", "output", "headphones", "sound"],
  speakers: ["speaker", "audio", "output", "headphones"],
  headphones: ["speaker", "audio", "output"],

  dark: ["theme", "appearance", "color"],
  light: ["theme", "appearance", "color"],
  theme: ["appearance", "color"],
  appearance: ["theme", "color", "display"],
  font: ["text", "typography"],

  login: ["sign in", "account"],
  logout: ["sign out", "account"],
  signin: ["sign in", "account"],
  signout: ["sign out", "account"],
  password: ["account", "security", "credentials"],
  user: ["account", "profile"],
  profile: ["account", "user"],

  privacy: ["permissions", "security", "private"],
  security: ["privacy", "permissions", "safety"],
  safety: ["privacy", "security"],
  allow: ["permissions", "grant", "enable"],

  history: ["memory", "log"],
  delete: ["erase", "remove", "wipe"],
  remove: ["delete", "erase", "wipe"],
  erase: ["delete", "wipe", "remove"],
  forget: ["erase", "delete", "memory"],

  ai: ["model", "llm"],
  llm: ["model", "ai"],
  gpt: ["openai", "model"],
  claude: ["anthropic", "model"],
  chatbot: ["model", "ai"],

  sleep: ["power", "idle"],
  battery: ["power"],
  awake: ["power", "sleep"],
  energy: ["power", "battery"],

  plugin: ["extension", "addon"],
  addon: ["extension", "plugin"],
  browser: ["chrome", "extension"],

  hotkey: ["shortcut", "keybinding"],
  hotkeys: ["shortcut", "keybinding"],
  keybind: ["shortcut", "keybinding"],
  keyboard: ["shortcut", "keybinding"],

  camera: ["screen", "capture", "permissions"],
  caption: ["transcription"],
  captions: ["transcription"],
};

const SEARCH_SYNONYMS: Map<string, ReadonlySet<string>> = (() => {
  const graph = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a)!.add(b);
  };
  for (const [key, values] of Object.entries(SEARCH_SYNONYMS_RAW)) {
    const a = normalizeSearchText(key);
    if (!a) continue;
    for (const value of values) {
      const b = normalizeSearchText(value);
      add(a, b);
      add(b, a);
    }
  }
  const frozen = new Map<string, ReadonlySet<string>>();
  for (const [key, set] of graph) {
    frozen.set(key, set);
  }
  return frozen;
})();

export function normalizeSearchText(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

export type TokenGroup = readonly string[];

export function expandTokens(tokens: string[]): TokenGroup[] {
  return tokens.map((token) => {
    if (token.length <= 1) return [token];
    const synonyms = SEARCH_SYNONYMS.get(token);
    if (!synonyms || synonyms.size === 0) return [token];
    const seen = new Set<string>([token]);
    const group: string[] = [token];
    for (const synonym of synonyms) {
      if (seen.has(synonym)) continue;
      seen.add(synonym);
      group.push(synonym);
    }
    return group;
  });
}

export function includesAsWordStart(text: string, term: string): boolean {
  if (!term) return false;
  const termLen = term.length;
  const textLen = text.length;
  if (termLen > textLen) return false;

  let from = 0;
  while (from <= textLen - termLen) {
    const idx = text.indexOf(term, from);
    if (idx === -1) return false;
    if (idx === 0) return true;
    const prev = text.charCodeAt(idx - 1);
    const isAlphanum =
      (prev >= 97 && prev <= 122) || (prev >= 48 && prev <= 57);
    if (!isAlphanum) return true;
    from = idx + 1;
  }
  return false;
}

export function matchesAllTokenGroups(
  text: string,
  groups: TokenGroup[],
): boolean {
  if (groups.length === 0) return true;
  for (const group of groups) {
    let groupHit = false;
    for (const term of group) {
      if (includesAsWordStart(text, term)) {
        groupHit = true;
        break;
      }
    }
    if (!groupHit) return false;
  }
  return true;
}

interface NormalizedEntry {
  entry: ResolvedSettingsSearchEntry;
  titleText: string;
  descriptionText: string;
  searchText: string;
}

function resolveEntries(
  t: SettingsSearchTranslate,
): ResolvedSettingsSearchEntry[] {
  return SETTINGS_SEARCH_ENTRY_DEFS.map((def) => {
    const cardTitle = def.cardTitleKey ? t(def.cardTitleKey) : undefined;
    return {
      tab: def.tab,
      availability: def.availability ?? "all",
      ...(def.platforms ? { platforms: def.platforms } : {}),
      title: t(def.titleKey),
      description: t(def.descriptionKey),
      ...(cardTitle ? { cardTitle } : {}),
      keywords: def.keywords,
    };
  });
}

let normalizedCacheKey: SettingsSearchTranslate | null = null;
let normalizedCache: NormalizedEntry[] = [];

function getNormalizedEntries(t: SettingsSearchTranslate): NormalizedEntry[] {
  if (normalizedCacheKey === t) return normalizedCache;
  normalizedCache = resolveEntries(t).map((entry) => ({
    entry,
    titleText: normalizeSearchText(entry.title),
    descriptionText: normalizeSearchText(entry.description),
    searchText: normalizeSearchText(
      [entry.title, entry.description, ...entry.keywords, entry.tab].join(" "),
    ),
  }));
  normalizedCacheKey = t;
  return normalizedCache;
}

function scoreEntry(normalized: NormalizedEntry, tokens: string[]): number {
  if (tokens.length === 0) return 0;

  const groups = expandTokens(tokens);
  const { titleText, descriptionText, searchText } = normalized;
  const fullQuery = tokens.join(" ");

  if (titleText === fullQuery) return 1000;
  if (titleText.startsWith(fullQuery)) return 500;

  const onlyLiteral = (text: string) => {
    for (const token of tokens) {
      if (!includesAsWordStart(text, token)) return false;
    }
    return true;
  };

  if (onlyLiteral(titleText)) {
    const firstTokenIndex = titleText.indexOf(tokens[0] ?? "");
    return 250 + Math.max(0, 50 - firstTokenIndex);
  }
  if (matchesAllTokenGroups(titleText, groups)) {
    return 200;
  }

  if (onlyLiteral(descriptionText)) return 100;
  if (matchesAllTokenGroups(descriptionText, groups)) return 80;

  if (onlyLiteral(searchText)) return 50;
  if (matchesAllTokenGroups(searchText, groups)) return 40;

  return -1;
}

export interface ScoredSettingsSearchEntry extends ResolvedSettingsSearchEntry {
  score: number;
}

export function searchSettings(
  query: string,
  t: SettingsSearchTranslate,
  options?: { host?: SettingsSearchHost; platform?: string },
): ScoredSettingsSearchEntry[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const indexed: Array<{ scored: ScoredSettingsSearchEntry; order: number }> =
    [];
  getNormalizedEntries(t).forEach((normalized, order) => {
    if (
      options?.host === "website" &&
      normalized.entry.availability === "native"
    ) {
      return;
    }
    if (
      normalized.entry.platforms &&
      !normalized.entry.platforms.some(
        (platform) => platform === options?.platform,
      )
    ) {
      return;
    }
    const score = scoreEntry(normalized, tokens);
    if (score < 0) return;
    indexed.push({
      scored: { ...normalized.entry, score },
      order,
    });
  });

  indexed.sort((a, b) => {
    if (b.scored.score !== a.scored.score) {
      return b.scored.score - a.scored.score;
    }
    return a.order - b.order;
  });

  return indexed.map((item) => item.scored);
}

export function expandedMatchTerms(query: string): string[] {
  const groups = expandTokens(tokenizeQuery(query));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const term of group) {
      if (!term || seen.has(term)) continue;
      seen.add(term);
      out.push(term);
    }
  }
  return out;
}
