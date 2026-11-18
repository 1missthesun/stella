import type { Story } from "../judge.ts";
import type { PublicBreach } from "../breach-catalog.ts";
import { DAY, fetchJson, fetchText } from "../pure.ts";

export const FEEDS: { source: string; url: string }[] = [
  { source: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/" },
  { source: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews" },
  { source: "SecurityWeek", url: "https://www.securityweek.com/feed/" },
  { source: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
  { source: "The Record", url: "https://therecord.media/feed" },
  { source: "DataBreaches.net", url: "https://databreaches.net/feed/" },
  { source: "Malwarebytes Labs", url: "https://www.malwarebytes.com/blog/feed/index.xml" },
  { source: "Google News", url: "https://news.google.com/rss/search?q=%22data%20breach%22%20OR%20hacked%20OR%20skimmer%20when:1d&hl=en-US&gl=US&ceid=US:en" },
  { source: "Help Net Security", url: "https://www.helpnetsecurity.com/feed/" },
  { source: "Dark Reading", url: "https://www.darkreading.com/rss.xml" },
  { source: "CyberScoop", url: "https://cyberscoop.com/feed/" },
  { source: "TechCrunch", url: "https://techcrunch.com/category/security/feed/" },
  { source: "Graham Cluley", url: "https://grahamcluley.com/feed/" },
  // Bing News, newest first: the consumer stories (shops, apps, scams) security sites skip.
  // Google News and BleepingComputer refuse requests from Stella's server, Bing doesn't.
  ...["%22data+breach%22", "hackers+customers+data", "card+skimmer+OR+%22payment+data%22", "scam+warning+OR+phishing+campaign", "malicious+extension+OR+malicious+app"].map((q) => ({
    source: "Bing News",
    url: `https://www.bing.com/news/search?q=${q}&qft=sortbydate%3d%221%22&format=rss`,
  })),
];

/** Bing wraps each article link in a click-tracking redirect; keep the article's own address. */
const unwrap = (link: string) => {
  if (!/bing\.com\/news\/apiclick/i.test(link)) return link;
  try {
    return new URL(link).searchParams.get("url") ?? link;
  } catch {
    return link;
  }
};

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];

export const parseFeed = (xml: string, source: string): Story[] => {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    const link = tag(b, "link") ?? b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const body = tag(b, "content:encoded") ?? tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "";
    const published = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    return {
      title: decode(tag(b, "title") ?? ""),
      url: unwrap(decode(link)),
      source: source === "Google News" ? decode(tag(b, "source") ?? source) : source === "Bing News" ? decode(tag(b, "News:Source") ?? source) : source,
      ...(published ? { published: new Date(decode(published)).toISOString() } : {}),
      summary: decode(body).slice(0, 900),
    };
  });
};

/** Security stories from the last `hours`, from all feeds, deduplicated by title. */
export const fetchStories = async (hours = 30): Promise<{ stories: Story[]; errors: string[] }> => {
  const since = Date.now() - hours * 3_600_000;
  const errors: string[] = [];
  const all = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        return parseFeed(await fetchText(f.url), f.source);
      } catch (e) {
        errors.push(`${f.source}: ${(e as Error).message}`);
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const stories: Story[] = [];
  for (const s of all.flat()) {
    const t = s.published ? Date.parse(s.published) : Date.now();
    if (!Number.isFinite(t) || t < since) continue;
    const k = s.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 70);
    if (!s.title || seen.has(k)) continue;
    seen.add(k);
    stories.push(s);
  }
  return { stories, errors };
};

/** Breaches added to the public list recently become stories too (they name the exact domain). */
export const breachStories = (catalog: PublicBreach[], days = 3): Story[] =>
  catalog
    .filter((b) => Date.now() - Date.parse(b.AddedDate) < days * DAY && b.IsVerified && !b.IsSpamList && !b.IsFabricated)
    .map((b) => ({
      title: `${b.Title} data breach added to Have I Been Pwned`,
      url: `https://haveibeenpwned.com/Breach/${b.Name}`,
      source: "Have I Been Pwned",
      published: b.AddedDate,
      summary: `Domain: ${b.Domain}. Breach date ${b.BreachDate}. ${b.PwnCount.toLocaleString("en-US")} accounts. Data exposed: ${b.DataClasses.join(", ")}.`,
    }));

type Kev = { vulnerabilities: { cveID: string; vendorProject: string; product: string; vulnerabilityName: string; dateAdded: string; shortDescription: string; requiredAction: string }[] };

/** Flaws CISA confirmed are being used in real attacks, added recently. */
export const kevStories = async (days = 3): Promise<Story[]> => {
  const kev = await fetchJson<Kev>("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", undefined, 30_000);
  return kev.vulnerabilities
    .filter((v) => Date.now() - Date.parse(v.dateAdded) < days * DAY)
    .map((v) => ({
      title: `Actively exploited: ${v.vendorProject} ${v.product} (${v.cveID})`,
      url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      source: "CISA Known Exploited Vulnerabilities",
      published: new Date(v.dateAdded).toISOString(),
      summary: `${v.vulnerabilityName}. ${v.shortDescription} Required action: ${v.requiredAction}`,
    }));
};
