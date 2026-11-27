// Stella's first message in a new chat. Stored as a mark (a journal card in
// the cloud, a marked assistant row on a computer-only chat), so every client
// draws the current wording with its own buttons, and the model reads the text
// below as Stella's opening turn.

export const WELCOME_CARD_TYPE = "welcome";
export const WELCOME_VERSION = 1;

export type WelcomeCard = { type: typeof WELCOME_CARD_TYPE; version: number };
export type WelcomeMark = { version: number };

export type WelcomeItemId = "errands" | "anywhere" | "memory" | "plans" | "customize";

export type WelcomeItem = { id: WelcomeItemId; title: string; body: string };

export const WELCOME_GREETING = "Hey — welcome to Stella.";

export const WELCOME_LEAD =
  "Unlike a normal chatbot that only replies with text, I can actually go do things on your computer and the web for you:";

export const WELCOME_ITEMS: readonly WelcomeItem[] = [
  {
    id: "errands",
    title: "I can handle real errands:",
    body: "click through websites you're already logged into, fill out forms, compare options, organize your downloads and photos, or make Word, Excel, and PDFs — even several things at once while we keep chatting.",
  },
  {
    id: "anywhere",
    title: "Text me from anywhere:",
    body: "message me on your phone to do something on your computer at home (or keep working even when your computer is turned off), and anything I make shows up on all your devices.",
  },
  {
    id: "memory",
    title: "One chat that remembers everything:",
    body: 'you never have to start a "new chat" — I remember how you like things done and can find anything we talked about months ago.',
  },
  {
    id: "plans",
    title: "Already pay for ChatGPT, Claude, or Gemini?",
    body: "Connect them in Settings at no extra cost, and tell me whenever you want me to use a specific one.",
  },
  {
    id: "customize",
    title: "Change anything about me or this app:",
    body: "tell me how to talk, give me rules to always follow, or ask me in plain English to change how this app looks, add a button, or build a custom tool right inside it.",
  },
];

export const WELCOME_CLOSING =
  "Want a few ideas of things I can take off your plate, or do you already have something in mind?";

export const welcomeItemMarkdown = (item: WelcomeItem): string => `- **${item.title}** ${item.body}`;

export const WELCOME_TEXT = [
  WELCOME_GREETING,
  WELCOME_LEAD,
  WELCOME_ITEMS.map(welcomeItemMarkdown).join("\n"),
  WELCOME_CLOSING,
].join("\n\n");

export const welcomeCard = (): WelcomeCard => ({ type: WELCOME_CARD_TYPE, version: WELCOME_VERSION });

export const parseWelcomeCard = (value: unknown): WelcomeCard | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== WELCOME_CARD_TYPE) return null;
  const version = typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : WELCOME_VERSION;
  return { type: WELCOME_CARD_TYPE, version };
};

export const parseWelcomeMark = (value: unknown): WelcomeMark | null => {
  if (value === true) return { version: WELCOME_VERSION };
  if (!value || typeof value !== "object") return null;
  const version = (value as { version?: unknown }).version;
  return { version: typeof version === "number" && Number.isFinite(version) ? version : WELCOME_VERSION };
};

export const welcomeMarkOf = (card: WelcomeCard): WelcomeMark => ({ version: card.version });

// The model's copy: a plain assistant message carrying the mark, like a fired
// reminder, so it knows what it opened with when the user answers.
export const welcomeAssistantMessage = (createdAtMs: number, mark: WelcomeMark = { version: WELCOME_VERSION }) => ({
  role: "assistant" as const,
  content: [{ type: "text" as const, text: WELCOME_TEXT }],
  api: "stella-welcome",
  provider: "stella",
  model: "welcome",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: createdAtMs,
  welcome: mark,
});

export const isWelcomeAssistantMessage = (message: unknown): boolean =>
  Boolean(message && typeof message === "object" && "welcome" in message && parseWelcomeMark((message as { welcome?: unknown }).welcome));
