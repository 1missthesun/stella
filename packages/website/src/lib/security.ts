import type { Answer } from "@/lib/answers";

/** Stella Security's price. Change it here and every line on the page follows. */
export const SECURITY_PRICE = "$3";
export const SECURITY_PRICE_LINE = `${SECURITY_PRICE} a month`;

export type SecurityPlatform = "mac" | "windows" | "linux";

/**
 * Installer links per computer. The installers aren't published yet, so every
 * link is "#" for now; put the real URLs here and each Download button on
 * /security picks them up.
 */
export const SECURITY_DOWNLOADS: Record<SecurityPlatform, string> = {
  mac: "#",
  windows: "#",
  linux: "#",
};

export const SECURITY_PLATFORM_LABELS: Record<SecurityPlatform, string> = {
  mac: "Mac",
  windows: "Windows",
  linux: "Linux",
};

export const SECURITY_PATH = "/security";
export const SECURITY_TITLE = "Stella Security: safe online, without the worry";
export const SECURITY_DESCRIPTION = `A small app for Mac, Windows and Linux that checks your computer, your accounts and today's security news for anything that touches you, and fixes it with one tap. ${SECURITY_PRICE_LINE}.`;

export const SECURITY_FAQ: Answer[] = [
  {
    q: "Is it an antivirus?",
    a: "No. Your computer's built-in protection already does that job. Stella Security covers what nobody does for normal people: how your computer is set up, your accounts, and fixing what's wrong. It works alongside the protection you already have.",
  },
  {
    q: "What leaves my computer?",
    a: "Very little, and we say exactly what. The checks run on your own computer, and your browsing history and files never leave it. To look you up in known data leaks it sends your email address. When something looks suspicious, it sends a short description of that one item to ask about it. That's all.",
  },
  {
    q: "Do I need to connect anything?",
    a: "No. Everything works with nothing connected. If you like, connect your email and it also catches phishing and tells real security alerts from fake ones. Each connection adds more; none is required.",
  },
  {
    q: "What does it cost?",
    a: `${SECURITY_PRICE_LINE}. Sign in with your Stella account.`,
  },
  {
    q: "Which computers does it work on?",
    a: "Mac, Windows and Linux.",
  },
];

export const SECURITY_MARKDOWN_BODY = `Stella Security is a small desktop app for Mac, Windows and Linux that keeps
ordinary people safe online. It is not an antivirus (your computer's built-in
protection does that). It covers your setup, your accounts, and fixing what's
wrong.

Several times a day it quietly checks. The screen shows one line: "You're
safe." or "1 thing needs you", with one button that fixes it, and a short list
of what was handled. No dashboard, no scores, no settings, no chat.

## What it checks
- Your computer: new downloads and installs, apps that start at login, browser
  extensions (sideloaded or risky ones, and ones named in today's news), missed
  updates for the system and browsers, disk encryption, firewall.
- Your accounts: whether your email shows up in known data leaks, and which
  sites you use had a breach, so you change that password.
- Today's news: every day it reads the security news (breaches, attacks,
  hacked websites, bad extensions) and checks whether any of it touches you,
  using what's on your computer, such as the sites in your browser history. It
  tells you only if it does.
- Optional: connect your email and it catches phishing and tells real security
  alerts from fake ones. Everything works with nothing connected.

## Fixes
One tap, always with your OK: update Chrome, remove a bad extension, move a
fake email to spam, open the right page to change a leaked password.

## Privacy
The scanning runs on your own computer. Your browsing history and files never
leave it. What does leave: your email address, for the leak check, and the
short description of a suspicious item it asks about.

## Price
${SECURITY_PRICE_LINE}. Sign in with your Stella account.
`;
