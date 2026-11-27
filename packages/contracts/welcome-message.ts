// Stella's first message in a new chat. Stored as a mark (a journal card in
// the cloud, a marked assistant row on a computer-only chat), so every client
// draws the current wording with the Meet Stella guide under it, and the
// model reads the text below as Stella's opening turn.

export const WELCOME_CARD_TYPE = "welcome";
export const WELCOME_VERSION = 1;

export type WelcomeCard = { type: typeof WELCOME_CARD_TYPE; version: number };
export type WelcomeMark = { version: number };

// The guide under the welcome: an HTML canvas every client carries with it
// (./meet-stella-guide), opened in its viewer like any canvas Stella makes.
export const MEET_STELLA_GUIDE_SLUG = "meet-stella";
export const MEET_STELLA_GUIDE_TITLE = "Meet Stella";
// Where a client that opens files by path (the phone) finds the guide.
export const MEET_STELLA_GUIDE_PATH = "stella-guide:meet-stella";

export const WELCOME_TEXT = [
  "Hey, I'm Stella. Unlike a normal chatbot, I can actually do things on your computer and the web for you while we talk.",
  "Tell me whatever you want off your plate, or open the guide below to see what I can do.",
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
