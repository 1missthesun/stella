import type { BrowsingSignals } from "@stella/contracts";

export type BrowserVisit = { url: string; title: string | null; time: number };

export type BrowserAccount = { name?: string; email?: string };

export type BrowserVisitSource = {
  browser: string;
  visits: BrowserVisit[];
  accounts: BrowserAccount[];
  languages: string | null;
};

export type BrowsingDigest = BrowsingSignals;

export const BROWSING_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_ACTIVE_DAYS = 3;
const MAX_SITES = 40;
const MAX_TITLED_UNKNOWN_SITES = 8;
const MAX_TITLES_PER_SITE = 4;
const MAX_TITLE_LENGTH = 70;
const MAX_ACCOUNTS = 6;

type Kind =
  | "email"
  | "calendar"
  | "docs"
  | "work"
  | "dev"
  | "cloud"
  | "ai"
  | "design"
  | "payments"
  | "bank"
  | "shopping"
  | "travel"
  | "food"
  | "music"
  | "news"
  | "drop";

type KnownSite = { label: string; kind: Kind };

const site = (label: string, kind: Kind): KnownSite => ({ label, kind });

const KNOWN_SITES: Record<string, KnownSite> = {
  "mail.google.com": site("Gmail", "email"),
  "gmail.com": site("Gmail", "email"),
  "outlook.live.com": site("Outlook", "email"),
  "outlook.office.com": site("Outlook (work)", "email"),
  "outlook.office365.com": site("Outlook (work)", "email"),
  "outlook.com": site("Outlook", "email"),
  "mail.yahoo.com": site("Yahoo Mail", "email"),
  "icloud.com": site("iCloud", "email"),
  "proton.me": site("Proton", "email"),
  "fastmail.com": site("Fastmail", "email"),
  "superhuman.com": site("Superhuman", "email"),
  "hey.com": site("HEY", "email"),
  "calendar.google.com": site("Google Calendar", "calendar"),
  "cal.com": site("Cal.com", "calendar"),
  "calendly.com": site("Calendly", "calendar"),
  "docs.google.com": site("Google Docs/Sheets", "docs"),
  "drive.google.com": site("Google Drive", "docs"),
  "notion.so": site("Notion", "docs"),
  "notion.com": site("Notion", "docs"),
  "dropbox.com": site("Dropbox", "docs"),
  "onedrive.live.com": site("OneDrive", "docs"),
  "sharepoint.com": site("SharePoint", "docs"),
  "coda.io": site("Coda", "docs"),
  "airtable.com": site("Airtable", "docs"),
  "evernote.com": site("Evernote", "docs"),
  "slack.com": site("Slack", "work"),
  "teams.microsoft.com": site("Microsoft Teams", "work"),
  "discord.com": site("Discord", "work"),
  "zoom.us": site("Zoom", "work"),
  "meet.google.com": site("Google Meet", "work"),
  "linear.app": site("Linear", "work"),
  "atlassian.net": site("Jira/Confluence", "work"),
  "asana.com": site("Asana", "work"),
  "trello.com": site("Trello", "work"),
  "monday.com": site("monday.com", "work"),
  "clickup.com": site("ClickUp", "work"),
  "hubspot.com": site("HubSpot", "work"),
  "salesforce.com": site("Salesforce", "work"),
  "lightning.force.com": site("Salesforce", "work"),
  "intercom.com": site("Intercom", "work"),
  "zendesk.com": site("Zendesk", "work"),
  "ads.google.com": site("Google Ads", "work"),
  "analytics.google.com": site("Google Analytics", "work"),
  "search.google.com": site("Google Search Console", "work"),
  "business.facebook.com": site("Meta Business Suite", "work"),
  "shopify.com": site("Shopify", "work"),
  "myshopify.com": site("Shopify", "work"),
  "appstoreconnect.apple.com": site("App Store Connect", "dev"),
  "developer.apple.com": site("Apple Developer", "dev"),
  "play.google.com": site("Google Play", "dev"),
  "github.com": site("GitHub", "dev"),
  "gitlab.com": site("GitLab", "dev"),
  "bitbucket.org": site("Bitbucket", "dev"),
  "stackoverflow.com": site("Stack Overflow", "dev"),
  "npmjs.com": site("npm", "dev"),
  "expo.dev": site("Expo", "dev"),
  "sentry.io": site("Sentry", "dev"),
  "posthog.com": site("PostHog", "dev"),
  "localhost": site("localhost", "drop"),
  "vercel.com": site("Vercel", "cloud"),
  "netlify.com": site("Netlify", "cloud"),
  "cloudflare.com": site("Cloudflare", "cloud"),
  "console.cloud.google.com": site("Google Cloud", "cloud"),
  "console.firebase.google.com": site("Firebase", "cloud"),
  "aws.amazon.com": site("AWS", "cloud"),
  "portal.azure.com": site("Azure", "cloud"),
  "supabase.com": site("Supabase", "cloud"),
  "convex.dev": site("Convex", "cloud"),
  "railway.app": site("Railway", "cloud"),
  "render.com": site("Render", "cloud"),
  "fly.io": site("Fly.io", "cloud"),
  "heroku.com": site("Heroku", "cloud"),
  "digitalocean.com": site("DigitalOcean", "cloud"),
  "godaddy.com": site("GoDaddy", "cloud"),
  "namecheap.com": site("Namecheap", "cloud"),
  "porkbun.com": site("Porkbun", "cloud"),
  "chatgpt.com": site("ChatGPT", "ai"),
  "chat.openai.com": site("ChatGPT", "ai"),
  "platform.openai.com": site("OpenAI Platform", "ai"),
  "claude.ai": site("Claude", "ai"),
  "claude.com": site("Claude", "ai"),
  "console.anthropic.com": site("Anthropic Console", "ai"),
  "gemini.google.com": site("Gemini", "ai"),
  "aistudio.google.com": site("Google AI Studio", "ai"),
  "perplexity.ai": site("Perplexity", "ai"),
  "openrouter.ai": site("OpenRouter", "ai"),
  "huggingface.co": site("Hugging Face", "ai"),
  "fal.ai": site("fal", "ai"),
  "replicate.com": site("Replicate", "ai"),
  "midjourney.com": site("Midjourney", "ai"),
  "elevenlabs.io": site("ElevenLabs", "ai"),
  "cursor.com": site("Cursor", "ai"),
  "figma.com": site("Figma", "design"),
  "canva.com": site("Canva", "design"),
  "framer.com": site("Framer", "design"),
  "webflow.com": site("Webflow", "design"),
  "dashboard.stripe.com": site("Stripe", "payments"),
  "stripe.com": site("Stripe", "payments"),
  "paypal.com": site("PayPal", "payments"),
  "wise.com": site("Wise", "payments"),
  "mercury.com": site("Mercury", "bank"),
  "brex.com": site("Brex", "bank"),
  "ramp.com": site("Ramp", "bank"),
  "chase.com": site("Chase", "bank"),
  "bankofamerica.com": site("Bank of America", "bank"),
  "wellsfargo.com": site("Wells Fargo", "bank"),
  "capitalone.com": site("Capital One", "bank"),
  "citi.com": site("Citi", "bank"),
  "americanexpress.com": site("American Express", "bank"),
  "discover.com": site("Discover", "bank"),
  "usbank.com": site("U.S. Bank", "bank"),
  "schwab.com": site("Charles Schwab", "bank"),
  "fidelity.com": site("Fidelity", "bank"),
  "vanguard.com": site("Vanguard", "bank"),
  "robinhood.com": site("Robinhood", "bank"),
  "coinbase.com": site("Coinbase", "bank"),
  "venmo.com": site("Venmo", "bank"),
  "monzo.com": site("Monzo", "bank"),
  "revolut.com": site("Revolut", "bank"),
  "hsbc.com": site("HSBC", "bank"),
  "barclays.co.uk": site("Barclays", "bank"),
  "amazon.com": site("Amazon", "shopping"),
  "amazon.co.uk": site("Amazon", "shopping"),
  "amazon.ca": site("Amazon", "shopping"),
  "amazon.de": site("Amazon", "shopping"),
  "amazon.in": site("Amazon", "shopping"),
  "ebay.com": site("eBay", "shopping"),
  "etsy.com": site("Etsy", "shopping"),
  "target.com": site("Target", "shopping"),
  "walmart.com": site("Walmart", "shopping"),
  "costco.com": site("Costco", "shopping"),
  "bestbuy.com": site("Best Buy", "shopping"),
  "apple.com": site("Apple", "drop"),
  "instacart.com": site("Instacart", "food"),
  "doordash.com": site("DoorDash", "food"),
  "ubereats.com": site("Uber Eats", "food"),
  "grubhub.com": site("Grubhub", "food"),
  "uber.com": site("Uber", "travel"),
  "lyft.com": site("Lyft", "travel"),
  "airbnb.com": site("Airbnb", "travel"),
  "booking.com": site("Booking.com", "travel"),
  "expedia.com": site("Expedia", "travel"),
  "kayak.com": site("Kayak", "travel"),
  "google.com/travel": site("Google Flights", "travel"),
  "united.com": site("United", "travel"),
  "delta.com": site("Delta", "travel"),
  "aa.com": site("American Airlines", "travel"),
  "southwest.com": site("Southwest", "travel"),
  "alaskaair.com": site("Alaska Airlines", "travel"),
  "jetblue.com": site("JetBlue", "travel"),
  "britishairways.com": site("British Airways", "travel"),
  "lufthansa.com": site("Lufthansa", "travel"),
  "emirates.com": site("Emirates", "travel"),
  "aircanada.com": site("Air Canada", "travel"),
  "marriott.com": site("Marriott", "travel"),
  "hilton.com": site("Hilton", "travel"),
  "spotify.com": site("Spotify", "music"),
  "music.apple.com": site("Apple Music", "music"),
  "soundcloud.com": site("SoundCloud", "music"),
  "google.com": site("Google Search", "drop"),
  "bing.com": site("Bing", "drop"),
  "duckduckgo.com": site("DuckDuckGo", "drop"),
  "search.brave.com": site("Brave Search", "drop"),
  "ecosia.org": site("Ecosia", "drop"),
  "startpage.com": site("Startpage", "drop"),
  "yahoo.com": site("Yahoo", "drop"),
  "baidu.com": site("Baidu", "drop"),
  "yandex.ru": site("Yandex", "drop"),
  "accounts.google.com": site("Google sign-in", "drop"),
  "myaccount.google.com": site("Google account", "drop"),
  "chromewebstore.google.com": site("Chrome Web Store", "drop"),
  "chrome.google.com": site("Chrome Web Store", "drop"),
  "translate.google.com": site("Google Translate", "drop"),
  "maps.google.com": site("Google Maps", "drop"),
  "news.google.com": site("Google News", "news"),
  "youtube.com": site("YouTube", "drop"),
  "youtu.be": site("YouTube", "drop"),
  "twitch.tv": site("Twitch", "drop"),
  "netflix.com": site("Netflix", "drop"),
  "hulu.com": site("Hulu", "drop"),
  "disneyplus.com": site("Disney+", "drop"),
  "primevideo.com": site("Prime Video", "drop"),
  "max.com": site("Max", "drop"),
  "vimeo.com": site("Vimeo", "drop"),
  "x.com": site("X", "drop"),
  "twitter.com": site("X", "drop"),
  "t.co": site("X", "drop"),
  "facebook.com": site("Facebook", "drop"),
  "instagram.com": site("Instagram", "drop"),
  "threads.net": site("Threads", "drop"),
  "tiktok.com": site("TikTok", "drop"),
  "reddit.com": site("Reddit", "drop"),
  "linkedin.com": site("LinkedIn", "drop"),
  "pinterest.com": site("Pinterest", "drop"),
  "snapchat.com": site("Snapchat", "drop"),
  "tumblr.com": site("Tumblr", "drop"),
  "quora.com": site("Quora", "drop"),
  "wikipedia.org": site("Wikipedia", "drop"),
  "web.whatsapp.com": site("WhatsApp", "drop"),
  "web.telegram.org": site("Telegram", "drop"),
  "messenger.com": site("Messenger", "drop"),
  "bit.ly": site("bit.ly", "drop"),
  "cfapi.net": site("Cloudflare", "drop"),
  "googleusercontent.com": site("Google", "drop"),
  "nytimes.com": site("The New York Times", "news"),
  "wsj.com": site("The Wall Street Journal", "news"),
  "bloomberg.com": site("Bloomberg", "news"),
  "ft.com": site("Financial Times", "news"),
  "theverge.com": site("The Verge", "news"),
  "techcrunch.com": site("TechCrunch", "news"),
  "news.ycombinator.com": site("Hacker News", "news"),
  "cnn.com": site("CNN", "news"),
  "bbc.com": site("BBC", "news"),
  "bbc.co.uk": site("BBC", "news"),
  "theguardian.com": site("The Guardian", "news"),
};

const KIND_ORDER: Kind[] = [
  "email",
  "calendar",
  "docs",
  "work",
  "dev",
  "cloud",
  "ai",
  "design",
  "payments",
  "bank",
  "shopping",
  "food",
  "travel",
  "music",
  "news",
];

const TITLED_KINDS = new Set<Kind>(["docs", "work", "dev", "cloud", "ai", "design", "payments"]);

const NO_SITE_HOSTS = [/^(login|auth|oauth|signin|sso|id|accounts?)\./, /^(api|cdn|static|assets|img|images)\./];

const SENSITIVE =
  /\b(health|clinic|medical|medic|pharma\w*|hospital|therap\w*|doctor|patient|dental|dentist|mental|mychart|webmd|diagnos\w*|symptom\w*|pregnan\w*|fertility|rehab|std|hiv|cancer|diet|weight[- ]?loss|democrat\w*|republican\w*|gop|maga|election\w*|ballot|politic\w*|church|bible|quran|koran|mosque|synagogue|temple|prayer|religio\w*|porn\w*|xxx|nsfw|sex\w*|onlyfans|escort\w*|dating|tinder|grindr|hinge|bumble|lgbt\w*|gay|lesbian|queer|trans|casino|gambl\w*|betting|loan|debt|bankrupt\w*|lawyer|divorce)\b/i;

const MULTI_PART_TLDS = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or"]);

const baseDomain = (host: string): string => {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  if (tld.length === 2 && MULTI_PART_TLDS.has(second)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
};

const knownSiteFor = (host: string, pathname: string): { key: string; known: KnownSite } | null => {
  if (host === "google.com" && pathname.startsWith("/travel")) {
    return { key: "google.com/travel", known: KNOWN_SITES["google.com/travel"] };
  }
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i += 1) {
    const candidate = parts.slice(i).join(".");
    const known = KNOWN_SITES[candidate];
    if (known) return { key: candidate, known };
  }
  return null;
};

const parseVisitUrl = (raw: string): { host: string; pathname: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.endsWith(".local") || host.endsWith(".localhost")) {
    return null;
  }
  return { host, pathname: parsed.pathname };
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cleanTitle = (title: string, label: string): string | null => {
  const labelSuffix = new RegExp(`\\s*[-|·–—:]\\s*${escapeRegExp(label)}\\s*$`, "i");
  const cleaned = title
    .replace(labelSuffix, "")
    .replace(/\(\s*[\d,]+\s*\)/g, "")
    .replace(/\b\d+ new items?\b/gi, "")
    .replace(/\s+-\s+(?:\d+ )?new items?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3) return null;
  if (/^(sign in|log in|login|loading|redirecting|just a moment|new tab|untitled|home)\b/i.test(cleaned)) return null;
  if (/^https?:\/\//i.test(cleaned) || /^\S+\/\S+$/.test(cleaned)) return null;
  if (cleaned.toLowerCase() === label.toLowerCase()) return null;
  if (/[$€£¥]\s?\d/.test(cleaned)) return null;
  if (SENSITIVE.test(cleaned)) return null;
  return cleaned.length > MAX_TITLE_LENGTH ? `${cleaned.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : cleaned;
};

type SiteStats = {
  key: string;
  label: string;
  kind: Kind | "unknown";
  visits: number;
  days: Set<string>;
  lastVisit: number;
  titles: Map<string, number>;
  emails: Set<string>;
};

const dayKey = (time: number): string => {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const recencyLabel = (time: number, now: number): string => {
  const days = Math.floor((now - time) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
};

const formatHour = (hour: number): string => `${String(hour % 24).padStart(2, "0")}:00`;

const describeActiveHours = (visits: BrowserVisit[]): string | null => {
  if (visits.length < 200) return null;
  const byHour = new Array<number>(24).fill(0);
  for (const visit of visits) byHour[new Date(visit.time).getHours()] += 1;
  const target = visits.length * 0.8;
  let best: { start: number; length: number } | null = null;
  for (let start = 0; start < 24; start += 1) {
    let sum = 0;
    for (let length = 1; length <= 24; length += 1) {
      sum += byHour[(start + length - 1) % 24];
      if (sum >= target) {
        if (!best || length < best.length) best = { start, length };
        break;
      }
    }
  }
  if (!best) return null;
  return `80% of browsing falls between ${formatHour(best.start)} and ${formatHour(best.start + best.length)} local time`;
};

const describeWeekends = (visits: BrowserVisit[], now: number): string | null => {
  const activeDays = new Set(visits.map((visit) => dayKey(visit.time)));
  let weekendDays = 0;
  let activeWeekendDays = 0;
  for (let offset = 0; offset < BROWSING_WINDOW_DAYS; offset += 1) {
    const date = new Date(now - offset * DAY_MS);
    if (date.getDay() !== 0 && date.getDay() !== 6) continue;
    weekendDays += 1;
    if (activeDays.has(dayKey(date.getTime()))) activeWeekendDays += 1;
  }
  return weekendDays > 0 ? `active on ${activeWeekendDays} of ${weekendDays} weekend days` : null;
};

const describeAccounts = (accounts: BrowserAccount[]): string | null => {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const account of accounts) {
    const email = account.email?.toLowerCase();
    const key = email ?? account.name?.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(account.name && email ? `${account.name} <${email}>` : (account.name ?? email!));
    if (lines.length >= MAX_ACCOUNTS) break;
  }
  return lines.length > 0 ? lines.join("; ") : null;
};

export const buildBrowsingDigest = (
  sources: BrowserVisitSource[],
  now = Date.now(),
): BrowsingDigest | null => {
  const since = now - BROWSING_WINDOW_DAYS * DAY_MS;
  const visits = sources.flatMap((source) =>
    source.visits.filter((visit) => typeof visit.time === "number" && visit.time >= since && visit.time <= now),
  );
  if (visits.length === 0) return null;

  const sites = new Map<string, SiteStats>();
  for (const visit of visits) {
    const parsed = parseVisitUrl(visit.url);
    if (!parsed) continue;
    const match = knownSiteFor(parsed.host, parsed.pathname);
    if (!match && NO_SITE_HOSTS.some((pattern) => pattern.test(parsed.host))) continue;
    const key = match?.known.label ?? baseDomain(parsed.host);
    const kind = match?.known.kind ?? "unknown";
    if (kind === "drop") continue;
    if (kind === "unknown" && SENSITIVE.test(key.replace(/[.-]/g, " "))) continue;
    let stats = sites.get(key);
    if (!stats) {
      stats = {
        key,
        label: key,
        kind,
        visits: 0,
        days: new Set(),
        lastVisit: 0,
        titles: new Map(),
        emails: new Set(),
      };
      sites.set(key, stats);
    }
    stats.visits += 1;
    stats.days.add(dayKey(visit.time));
    stats.lastVisit = Math.max(stats.lastVisit, visit.time);
    const title = visit.title?.trim();
    if (!title) continue;
    if (kind === "email" || kind === "calendar") {
      for (const email of title.match(EMAIL_PATTERN) ?? []) stats.emails.add(email.toLowerCase());
      continue;
    }
    const cleaned = cleanTitle(title, stats.label);
    if (cleaned) stats.titles.set(cleaned, (stats.titles.get(cleaned) ?? 0) + 1);
  }

  const recurring = [...sites.values()]
    .filter((stats) => stats.days.size >= MIN_ACTIVE_DAYS)
    .sort((a, b) => b.days.size - a.days.size || b.visits - a.visits)
    .slice(0, MAX_SITES);
  if (recurring.length === 0) return null;

  const titledUnknown = new Set(
    recurring
      .filter((stats) => stats.kind === "unknown")
      .slice(0, MAX_TITLED_UNKNOWN_SITES)
      .map((stats) => stats.key),
  );

  const formatSite = (stats: SiteStats): string => {
    const parts = [`${stats.label}: ${stats.days.size}d active, last ${recencyLabel(stats.lastVisit, now)}`];
    if (stats.emails.size > 0) parts.push(`accounts ${[...stats.emails].slice(0, 4).join(", ")}`);
    const showTitles =
      (stats.kind !== "unknown" && TITLED_KINDS.has(stats.kind)) || titledUnknown.has(stats.key);
    if (showTitles) {
      const titles = [...stats.titles.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TITLES_PER_SITE)
        .map(([title]) => `"${title}"`);
      if (titles.length > 0) parts.push(`pages ${titles.join(", ")}`);
    }
    return `- ${parts.join("; ")}`;
  };

  const lines: string[] = [];
  const browsers = [...new Set(sources.map((source) => source.browser))];
  lines.push(`## Browser activity (${browsers.join(", ")}, last ${BROWSING_WINDOW_DAYS} days, recurring sites only)`);

  const accounts = describeAccounts(sources.flatMap((source) => source.accounts));
  if (accounts) lines.push(`Accounts signed in to the browser: ${accounts}`);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const languages = sources.find((source) => source.languages)?.languages;
  const rhythm = [describeActiveHours(visits), describeWeekends(visits, now)].filter(Boolean).join("; ");
  lines.push(
    [
      `Time zone: ${timeZone}`,
      `language: ${languages ?? Intl.DateTimeFormat().resolvedOptions().locale}`,
      rhythm,
    ]
      .filter(Boolean)
      .join("; "),
  );

  const groups: [string, SiteStats[]][] = [
    ...KIND_ORDER.map((kind) => [kind, recurring.filter((stats) => stats.kind === kind)] as [string, SiteStats[]]),
    ["other (user's own sites or niche tools)", recurring.filter((stats) => stats.kind === "unknown")],
  ];
  for (const [kind, entries] of groups) {
    if (entries.length === 0) continue;
    lines.push(`\n### ${kind}`);
    lines.push(...entries.map(formatSite));
  }

  return { browsers, visitCount: visits.length, text: lines.join("\n") };
};
