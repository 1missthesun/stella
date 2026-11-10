/**
 * When a Free account's one-time usage of Stella's own models runs out, the
 * first thing Stella offers is the ChatGPT or Claude plan the person already
 * has (free to use with Stella), and plans/credit second.
 *
 * Switched OFF until the owner gives an explicit go-ahead. It gates the desktop app, the web chat and
 * the phone app (the offer card, its copy, the near-the-limit heads-up) and
 * the wording of the limit message itself, so a desktop publish, a phone OTA
 * or a backend deploy that sweeps this code in changes nothing for users.
 */
export const CONNECT_PLAN_OFFER_ENABLED = false;

/** Copy for the offer. Hosts pick the line that matches what can connect there. */
export const CONNECT_PLAN_COPY = {
  /** The usage ran out (the turn was refused). */
  outTitle: "You've used your free usage",
  /** Desktop: ChatGPT sign-in, Claude Code or an API key all work. */
  outBody: "Keep going free with the ChatGPT or Claude plan you already have.",
  /** Web chat and phone: only Sign in with ChatGPT runs a Free account in the cloud. */
  outBodyChatGpt: "Keep going free with the ChatGPT plan you already have.",
  /** Once, at about 80% used. */
  nearTitle: "Your free usage is almost used up",
  nearBody: "After that, keep going free with the ChatGPT or Claude plan you already have.",
  nearBodyChatGpt: "After that, keep going free with the ChatGPT plan you already have.",
  connect: "Connect ChatGPT or Claude",
  connectChatGpt: "Connect ChatGPT",
  plans: "See plans",
  chooseTitle: "Connect your plan",
  chooseBody: "Stella runs free on it. Your message sends once you're connected.",
  chooseBodyNoResend: "Stella runs free on it.",
  chatgptTitle: "ChatGPT",
  chatgptBody: "Sign in with ChatGPT to use your plan.",
  claudeTitle: "Claude",
  claudeBody: "Use your Claude Pro or Max plan through Claude Code.",
  apiKeyTitle: "API key",
  apiKeyBody: "Use your own key from Anthropic, OpenAI, Google and others.",
  claudeCliMissing: "Install Claude Code first, then try again.",
  waiting: "Finish signing in in your browser.",
  failed: "That didn't connect. Try again?",
  sending: "Connected. Sending your message…",
  connected: "Connected. You're all set.",
} as const;

/** Share of the free usage at which the one-time heads-up shows. */
export const CONNECT_PLAN_NEAR_SHARE = 0.8;

/** The limit message the gateway and backend send once the free usage is spent. */
export const CONNECT_PLAN_FREE_ALLOWANCE_MESSAGE =
  "You've used your free Stella allowance. Connect your ChatGPT or Claude plan to keep going free, or choose a plan.";
