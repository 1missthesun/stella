export const CONNECT_PLAN_OFFER_ENABLED: boolean = true;

export const CONNECT_PLAN_OFFER_MOBILE_ENABLED: boolean = false;

export const CONNECT_PLAN_COPY = {
  outTitle: "You've used your free usage",
  outBody: "Keep going free with the ChatGPT or Claude plan you already have.",
  outBodyChatGpt: "Keep going free with the ChatGPT plan you already have.",
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

export const CONNECT_PLAN_NEAR_SHARE = 0.8;

export const CONNECT_PLAN_FREE_ALLOWANCE_MESSAGE =
  "You've used your free Stella allowance. Connect your ChatGPT or Claude plan to keep going free, or choose a plan.";
