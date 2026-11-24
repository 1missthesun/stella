import type { CanvasAction } from "./canvas-actions.js";

export const EMAIL_PAGE_CANVAS = "email";

export type EmailPageSection = "needs_you" | "handled" | "waiting";
export const EMAIL_PAGE_SECTIONS: readonly EmailPageSection[] = ["needs_you", "handled", "waiting"];

export type EmailPageThread = { account: string; thread: string };

export type EmailPageItem = {
  id: string;
  section: EmailPageSection;
  title: string;
  gist: string;
  detail?: string;
  draft?: string;
  draftId?: string;
  action?: string;
  from?: string;
  count?: number;
  threads?: EmailPageThread[];
  urgent?: boolean;
  at: number;
  mailAt?: number;
};

export type EmailPageIgnored = {
  count: number;
  gist?: string;
  senders?: { name: string; count: number }[];
};

export type EmailPage = {
  items: EmailPageItem[];
  ignored: EmailPageIgnored;
  readAt?: number;
  updatedAt: number;
};

export type EmailPageView = {
  enabled: boolean;
  accounts: string[];
  page: EmailPage;
  unread: number;
  nextReadAt?: number;
};

export const emptyEmailPage = (now: number): EmailPage => ({ items: [], ignored: { count: 0 }, updatedAt: now });

export const EMAIL_PAGE_LIMITS = {
  items: 40,
  title: 140,
  gist: 600,
  detail: 4_000,
  draft: 10_000,
  action: 32,
  from: 160,
  threads: 12,
  senders: 12,
} as const;

const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/u;

const line = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max) : "";
const block = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/gu, "").trim().slice(0, max) : "";

export type EmailPageItemUpdate = { id: string } & Partial<Record<keyof Omit<EmailPageItem, "id" | "at" | "mailAt">, unknown>>;

export type EmailPageUpdate = {
  items?: EmailPageItemUpdate[];
  remove?: string[];
  ignored?: { count?: unknown; gist?: unknown; senders?: unknown } | null;
  readAt?: number;
};

const threadsOf = (value: unknown): EmailPageThread[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out: EmailPageThread[] = [];
  for (const entry of value) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const account = line(record?.account, 320).toLowerCase();
    const thread = line(record?.thread, 128);
    if (account && /^[A-Za-z0-9_-]+$/u.test(thread)) out.push({ account, thread });
    if (out.length >= EMAIL_PAGE_LIMITS.threads) break;
  }
  return out;
};

export const applyEmailPageUpdate = (
  page: EmailPage,
  update: EmailPageUpdate,
  now: number,
): { page: EmailPage; problems: string[]; newlyUrgent: EmailPageItem[] } => {
  const problems: string[] = [];
  const byId = new Map(page.items.map((item) => [item.id, item] as const));
  const newlyUrgent: EmailPageItem[] = [];
  for (const id of update.remove ?? []) {
    if (typeof id === "string" && !byId.delete(id)) problems.push(`There is no item ${id} to remove.`);
  }
  for (const raw of update.items ?? []) {
    const id = typeof raw?.id === "string" ? raw.id.trim() : "";
    if (!ITEM_ID_RE.test(id)) {
      problems.push(`Item id ${JSON.stringify(id)} must be lowercase letters, digits and '-', up to 48.`);
      continue;
    }
    const before = byId.get(id);
    const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
    const section = has("section")
      ? EMAIL_PAGE_SECTIONS.find((entry) => entry === raw.section)
      : before?.section;
    const title = has("title") ? line(raw.title, EMAIL_PAGE_LIMITS.title) : (before?.title ?? "");
    const gist = has("gist") ? block(raw.gist, EMAIL_PAGE_LIMITS.gist) : (before?.gist ?? "");
    if (!section || !title || !gist) {
      problems.push(`Item ${id} needs a section (needs_you, handled or waiting), a title and a gist.`);
      continue;
    }
    const pick = <T>(key: keyof EmailPageItem, read: (value: unknown) => T | undefined): T | undefined =>
      has(key) ? read(raw[key as keyof typeof raw]) : (before?.[key] as T | undefined);
    const detail = pick("detail", (value) => block(value, EMAIL_PAGE_LIMITS.detail) || undefined);
    const draft = pick("draft", (value) => block(value, EMAIL_PAGE_LIMITS.draft) || undefined);
    const draftId = pick("draftId", (value) => line(value, 128) || undefined);
    const action = pick("action", (value) => {
      const text = line(value, 200);
      if (!text || /^(?:none|n\/a|no action(?: needed)?|nothing)\.?$/iu.test(text)) return undefined;
      if (text.length > EMAIL_PAGE_LIMITS.action) {
        problems.push(`Item ${id}'s action "${text}" is too long for its button: 2 to 4 words ("Send reply", "Pay it", "Confirm 7:30").`);
        return undefined;
      }
      return text;
    });
    const from = pick("from", (value) => line(value, EMAIL_PAGE_LIMITS.from) || undefined);
    const count = pick("count", (value) =>
      typeof value === "number" && Number.isFinite(value) && value > 1 ? Math.min(Math.round(value), 100_000) : undefined,
    );
    const threads = pick("threads", (value) => {
      const list = threadsOf(value);
      return list && list.length > 0 ? list : undefined;
    });
    const urgent = section === "needs_you" && pick("urgent", (value) => (value === true ? true : undefined)) === true;
    const item: EmailPageItem = {
      id,
      section,
      title,
      gist,
      ...(detail ? { detail } : {}),
      ...(draft ? { draft } : {}),
      ...(draftId ? { draftId } : {}),
      ...(action ? { action } : {}),
      ...(from ? { from } : {}),
      ...(count ? { count } : {}),
      ...(threads ? { threads } : {}),
      ...(urgent ? { urgent: true } : {}),
      ...(before?.mailAt ? { mailAt: before.mailAt } : {}),
      at: now,
    };
    if (urgent && !before?.urgent) newlyUrgent.push(item);
    byId.delete(id);
    byId.set(id, item);
  }
  let items = [...byId.values()];
  if (items.length > EMAIL_PAGE_LIMITS.items) {
    const keep = new Set(
      [...items]
        .sort((a, b) => (a.section === "needs_you" ? 0 : 1) - (b.section === "needs_you" ? 0 : 1) || b.at - a.at)
        .slice(0, EMAIL_PAGE_LIMITS.items)
        .map((item) => item.id),
    );
    problems.push(`The page holds ${EMAIL_PAGE_LIMITS.items} items; the oldest handled and waiting ones were dropped.`);
    items = items.filter((item) => keep.has(item.id));
  }
  let ignored = page.ignored;
  if (update.ignored) {
    const count = typeof update.ignored.count === "number" && update.ignored.count >= 0 ? Math.round(update.ignored.count) : ignored.count;
    const gist = Object.prototype.hasOwnProperty.call(update.ignored, "gist")
      ? line(update.ignored.gist, 300) || undefined
      : ignored.gist;
    const senders = Array.isArray(update.ignored.senders)
      ? update.ignored.senders
          .map((entry) => {
            const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
            return { name: line(record.name, 120), count: typeof record.count === "number" ? Math.max(1, Math.round(record.count)) : 1 };
          })
          .filter((entry) => entry.name)
          .slice(0, EMAIL_PAGE_LIMITS.senders)
      : ignored.senders;
    ignored = { count, ...(gist ? { gist } : {}), ...(senders && senders.length ? { senders } : {}) };
  }
  return {
    page: {
      items,
      ignored,
      ...(update.readAt ? { readAt: update.readAt } : page.readAt ? { readAt: page.readAt } : {}),
      updatedAt: now,
    },
    problems,
    newlyUrgent,
  };
};

export const EMAIL_HANDLED_SHOWN_MS = 3 * 24 * 60 * 60_000;

const stillShown = (item: EmailPageItem, now: number): boolean =>
  item.section !== "handled" || typeof item.at !== "number" || now - item.at < EMAIL_HANDLED_SHOWN_MS;

export const readEmailPage = (json: string | null | undefined, now: number): EmailPage => {
  if (!json) return emptyEmailPage(now);
  try {
    const parsed = JSON.parse(json) as Partial<EmailPage>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items.filter((item) => stillShown(item, now)) : [],
      ignored: parsed.ignored && typeof parsed.ignored === "object" ? parsed.ignored : { count: 0 },
      ...(typeof parsed.readAt === "number" ? { readAt: parsed.readAt } : {}),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : now,
    };
  } catch {
    return emptyEmailPage(now);
  }
};

export const describeEmailPage = (page: EmailPage): string => {
  if (page.items.length === 0 && page.ignored.count === 0) return "The Email page is empty.";
  const lines = EMAIL_PAGE_SECTIONS.flatMap((section) => {
    const items = page.items.filter((item) => item.section === section);
    return items.length === 0
      ? []
      : [
          `${section}:`,
          ...items.map(
            (item) =>
              `- ${item.id}${item.urgent ? " (urgent)" : ""}: ${item.title} — ${item.gist}${item.action ? ` [button: ${item.action}]` : ""}${item.draft ? ` [draft reply${item.draftId ? ` ${item.draftId}` : ""}]` : ""}`,
          ),
        ];
  });
  return [
    "The Email page now:",
    ...lines,
    `ignored: ${page.ignored.count}${page.ignored.gist ? ` (${page.ignored.gist})` : ""}`,
  ].join("\n");
};

export const EMAIL_PAGE_CHECK_ACTION = "check";

export const EMAIL_PAGE_OFF_ACTION = "off";
export const EMAIL_PAGE_RULE_REMOVE_PREFIX = "rule-remove:";

export const isEmailPageHostAction = (id: string): boolean =>
  id === EMAIL_PAGE_OFF_ACTION || id.startsWith(EMAIL_PAGE_RULE_REMOVE_PREFIX);

export const emailPageActions = (page: EmailPage, rules: readonly { ruleId: string; text: string }[] = []): CanvasAction[] => [
  { id: EMAIL_PAGE_CHECK_ACTION, label: "Check my email now" },
  { id: EMAIL_PAGE_OFF_ACTION, label: "Turn off Email" },
  ...rules.map((rule) => ({ id: `${EMAIL_PAGE_RULE_REMOVE_PREFIX}${rule.ruleId}`, label: `Remove the rule: ${rule.text}`.slice(0, 200) })),
  ...page.items.flatMap((item): CanvasAction[] => [
    ...(item.action
      ? [{ id: `${item.section === "handled" ? "undo" : "do"}:${item.id}`, label: `${item.action}: ${item.title}` }]
      : []),
    { id: `tell:${item.id}`, label: `About ${item.title}` },
  ]),
];

export const gmailThreadUrl = (thread: EmailPageThread): string =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(thread.account)}#all/${encodeURIComponent(thread.thread)}`;

/**
 * A script end tag inside a raw template gets rewritten by source transforms into
 * a helper the renderer can't load, so it is joined on outside the template.
 */
export const EMAIL_PAGE_FRAME_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Email</title>
<style>
:root{--bg:#fff;--fg:#111214;--muted:#6b6f76;--faint:#9a9ea5;--line:#ececee;--soft:#f5f5f6;--accent:#2871c9;--accent-fg:#fff;color-scheme:light}
:root.dark{--bg:#0f1012;--fg:#ececee;--muted:#9a9ea5;--faint:#6b6f76;--line:#222428;--soft:#18191c;--accent:#5b9be6;--accent-fg:#0b1220;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg)}
html{scrollbar-width:thin;scrollbar-color:var(--line) transparent}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
main{max-width:680px;margin:0 auto;padding:28px 20px 56px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}
h1{font-size:24px;line-height:1.2;font-weight:650;letter-spacing:-.02em;margin:0}
.sub{color:var(--muted);font-size:13px;margin:0 0 28px}
h2{font-size:13px;font-weight:600;color:var(--muted);margin:36px 0 4px;display:flex;gap:8px;align-items:baseline}
h2 .n{color:var(--faint);font-weight:500}
section:first-of-type h2{margin-top:8px}
.item{padding:16px 0;border-bottom:1px solid var(--line)}
.item:last-child{border-bottom:0}
.t{display:flex;align-items:baseline;gap:8px}
h3{font-size:16px;line-height:1.35;font-weight:600;margin:0;letter-spacing:-.01em}
.dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--accent);transform:translateY(-2px)}
.meta{color:var(--muted);font-size:13px;margin:2px 0 0}
.gist{margin:6px 0 0}
.handled .gist,.waiting .gist{color:var(--muted)}
.detail{margin:10px 0 0;font-size:14px}
.detail p{margin:0 0 8px}
.detail ul{margin:0 0 8px;padding-left:18px}
.draft{margin:12px 0 0;padding:12px 14px;background:var(--soft);border-radius:10px;white-space:pre-wrap;font-size:14px}
.draft-label{font-size:12px;color:var(--muted);margin:12px 0 -6px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:12px}
button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.primary{border:0;border-radius:9px;background:var(--accent);color:var(--accent-fg);font-weight:600;font-size:14px;padding:8px 14px;min-height:36px}
.quiet{border:0;background:none;color:var(--fg);font-weight:500;font-size:14px;padding:8px 0;min-height:36px}
.quiet:hover{color:var(--accent)}
.link{color:var(--muted);font-size:13px;text-decoration:none;padding:8px 0}
.link:hover{color:var(--fg)}
.more{border:0;background:none;color:var(--muted);font-size:13px;padding:6px 0 0}
.status{color:var(--muted);font-size:13px;margin:10px 0 0}
form.tell{margin-top:10px;display:flex;flex-direction:column;gap:8px}
textarea{font:inherit;font-size:16px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-height:76px;resize:vertical;outline:none}
textarea:focus{border-color:var(--accent)}
form.tell .row{margin-top:0}
.empty{color:var(--muted);margin:10px 0 0}
details.ignored{margin-top:36px;border-top:1px solid var(--line);padding-top:14px}
details.ignored summary{cursor:pointer;color:var(--muted);font-size:14px;list-style:none}
details.ignored summary::-webkit-details-marker{display:none}
details.ignored summary::after{content:" ›";color:var(--faint)}
details.ignored[open] summary::after{content:" ⌄"}
.senders{list-style:none;padding:0;margin:10px 0 0;font-size:14px}
.senders li{display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)}
.off{padding-top:12px}
.off p{color:var(--muted);margin:8px 0 0}
footer{margin-top:40px;border-top:1px solid var(--line);padding-top:14px;color:var(--muted);font-size:13px}
footer p{margin:0 0 6px}
footer details summary{cursor:pointer;list-style:none;padding:4px 0}
footer details summary::-webkit-details-marker{display:none}
footer details summary::after{content:" ›";color:var(--faint)}
footer details[open] summary::after{content:" ⌄"}
.rules{list-style:none;padding:0;margin:6px 0 10px}
.rules li{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)}
.rules li:last-child{border-bottom:0}
.rules .rule{color:var(--fg);font-size:14px}
.rules .kind{display:block;color:var(--muted);font-size:12px}
.small{border:0;background:none;color:var(--muted);font-size:13px;padding:6px 0}
.small:hover{color:var(--fg)}
.confirm{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:6px}
.confirm p{margin:0;color:var(--fg)}
[data-stella-state="sending"]{opacity:.55}
@media (max-width:420px){main{padding:20px 16px 48px}}
</style>
</head>
<body>
<main id="root"></main>
<script>
(() => {
  const root = document.getElementById("root");
  const ui = { open: {}, telling: {}, pending: {} };
  let view = null;
  let locale = undefined;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  const when = (at) => {
    if (!at) return "";
    const date = new Date(at);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    try {
      return sameDay
        ? date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
    } catch {
      return date.toISOString().slice(0, 16).replace("T", " ");
    }
  };

  const inline = (parent, text) => {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (/^\*\*[^*]+\*\*$/.test(part)) parent.appendChild(el("strong", "", part.slice(2, -2)));
      else if (part) parent.appendChild(document.createTextNode(part));
    }
  };

  const richText = (text) => {
    const box = el("div", "detail");
    for (const chunk of String(text).split(/\n{2,}/)) {
      const lines = chunk.split("\n");
      if (lines.every((entry) => /^\s*[-•]\s+/.test(entry))) {
        const list = el("ul");
        for (const entry of lines) {
          const li = el("li");
          inline(li, entry.replace(/^\s*[-•]\s+/, ""));
          list.appendChild(li);
        }
        box.appendChild(list);
      } else {
        const p = el("p");
        lines.forEach((entry, index) => {
          if (index) p.appendChild(el("br"));
          inline(p, entry);
        });
        box.appendChild(p);
      }
    }
    return box;
  };

  const gmailUrl = (thread) =>
    "https://mail.google.com/mail/?authuser=" + encodeURIComponent(thread.account) + "#all/" + encodeURIComponent(thread.thread);

  const button = (cls, text, action) => {
    const node = el("button", cls, text);
    node.type = "button";
    if (action) node.setAttribute("data-stella-action", action);
    return node;
  };

  const renderItem = (item) => {
    const box = el("article", "item " + item.section);
    box.dataset.id = item.id;
    const head = el("div", "t");
    if (item.urgent) {
      const dot = el("span", "dot");
      dot.setAttribute("aria-label", "Urgent");
      head.appendChild(dot);
    }
    head.appendChild(el("h3", "", item.title));
    box.appendChild(head);
    const meta = [];
    if (item.from) meta.push(item.from);
    if (item.count > 1) meta.push(item.count + " emails");
    if (view && view.accounts.length > 1 && item.threads && item.threads[0]) meta.push(item.threads[0].account);
    if (item.mailAt) meta.push(when(item.mailAt));
    if (meta.length) box.appendChild(el("p", "meta", meta.join(" · ")));
    box.appendChild(el("p", "gist", item.gist));

    const hasMore = Boolean(item.detail || item.draft);
    const open = Boolean(ui.open[item.id]);
    if (hasMore && open) {
      if (item.detail) box.appendChild(richText(item.detail));
      if (item.draft) {
        box.appendChild(el("p", "draft-label", "Reply Stella drafted"));
        box.appendChild(el("div", "draft", item.draft));
      }
    }
    if (hasMore) {
      const more = el("button", "more", open ? "Less" : item.draft ? "Read the reply" : "More");
      more.type = "button";
      more.addEventListener("click", () => {
        ui.open[item.id] = !open;
        render();
      });
      box.appendChild(more);
    }

    const pending = ui.pending[item.id];
    if (pending) {
      box.appendChild(el("p", "status", pending));
      return box;
    }
    const row = el("div", "row");
    if (item.action) {
      const id = (item.section === "handled" ? "undo:" : "do:") + item.id;
      row.appendChild(button(item.section === "handled" ? "quiet" : "primary", item.action, id));
    }
    const tell = button("quiet", "Tell Stella");
    tell.addEventListener("click", () => {
      ui.telling[item.id] = !ui.telling[item.id];
      render();
      if (ui.telling[item.id]) {
        const area = root.querySelector('article[data-id="' + CSS.escape(item.id) + '"] textarea');
        if (area) area.focus();
      }
    });
    row.appendChild(tell);
    const thread = item.threads && item.threads[0];
    if (thread) {
      const link = el("a", "link", "Open in Gmail");
      link.href = gmailUrl(thread);
      link.target = "_blank";
      link.rel = "noopener";
      row.appendChild(link);
    }
    box.appendChild(row);
    if (ui.telling[item.id]) {
      const form = el("form", "tell");
      form.setAttribute("data-stella-action", "tell:" + item.id);
      const area = el("textarea");
      area.name = "text";
      area.placeholder = "Tell Stella what to do, or why it doesn't matter";
      area.required = true;
      form.appendChild(area);
      const buttons = el("div", "row");
      const send = el("button", "primary", "Send");
      send.type = "submit";
      buttons.appendChild(send);
      const cancel = button("quiet", "Cancel");
      cancel.addEventListener("click", () => {
        ui.telling[item.id] = false;
        render();
      });
      buttons.appendChild(cancel);
      form.appendChild(buttons);
      area.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send.click();
      });
      box.appendChild(form);
    }
    return box;
  };

  const KIND_TEXT = { wake: "Tells you at once", act: "Stella acts at once", ignore: "Left off this page" };

  const renderFooter = () => {
    const footer = el("footer");
    const reads = [];
    if (view.accounts.length) reads.push("Stella reads " + view.accounts.join(", "));
    if (view.nextReadAt) reads.push("next on her own " + when(view.nextReadAt));
    if (reads.length) footer.appendChild(el("p", "", reads.join(" · ")));
    const rules = Array.isArray(view.rules) ? view.rules : [];
    const details = el("details");
    if (ui.rulesOpen) details.open = true;
    details.addEventListener("toggle", () => {
      ui.rulesOpen = details.open;
    });
    details.appendChild(el("summary", "", rules.length ? "Your rules (" + rules.length + ")" : "Your rules"));
    if (rules.length) {
      const list = el("ul", "rules");
      for (const rule of rules) {
        const li = el("li");
        const text = el("span", "rule", rule.text);
        text.appendChild(el("span", "kind", KIND_TEXT[rule.kind] || ""));
        li.appendChild(text);
        li.appendChild(button("small", "Remove", "rule-remove:" + rule.ruleId));
        list.appendChild(li);
      }
      details.appendChild(list);
    }
    details.appendChild(el("p", "", "Tell Stella what matters and what doesn't, and she keeps it as a rule."));
    footer.appendChild(details);
    if (ui.confirmOff) {
      const box = el("div", "confirm");
      box.appendChild(el("p", "", "Stella stops reading your mail and this page is cleared."));
      box.appendChild(button("small", "Turn off", "off"));
      const cancel = button("small", "Cancel");
      cancel.addEventListener("click", () => {
        ui.confirmOff = false;
        render();
      });
      box.appendChild(cancel);
      footer.appendChild(box);
    } else {
      const off = button("small", "Turn off Email");
      off.addEventListener("click", () => {
        ui.confirmOff = true;
        render();
      });
      footer.appendChild(off);
    }
    return footer;
  };

  const SECTIONS = [
    ["needs_you", "Needs you", "Nothing needs you."],
    ["handled", "I handled", ""],
    ["waiting", "Waiting on others", ""],
  ];

  const render = () => {
    const focused = document.activeElement && document.activeElement.tagName === "TEXTAREA"
      ? { id: document.activeElement.closest("article")?.dataset.id, value: document.activeElement.value, start: document.activeElement.selectionStart }
      : null;
    const drafts = {};
    for (const area of root.querySelectorAll("article textarea")) drafts[area.closest("article").dataset.id] = area.value;
    root.textContent = "";
    if (!view) return;
    const header = el("header");
    header.appendChild(el("h1", "", "Email"));
    if (view.enabled) header.appendChild(button("quiet", "Check now", "check"));
    root.appendChild(header);
    if (!view.enabled) {
      const off = el("div", "off");
      off.appendChild(el("p", "", "Turn on Email and Stella reads your mail a few times a day, keeps this page of what needs you, and handles the rest when you say so."));
      root.appendChild(off);
      return;
    }
    const page = view.page;
    const sub = [];
    sub.push(page.readAt ? "Read by Stella " + when(page.readAt) : "Stella hasn't read your mail yet");
    if (view.unread > 0) sub.push(view.unread + " new since");
    if (view.accounts.length > 1) sub.push(view.accounts.length + " inboxes");
    root.appendChild(el("p", "sub", sub.join(" · ")));

    for (const [key, title, empty] of SECTIONS) {
      const items = page.items
        .filter((item) => item.section === key)
        .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.at - a.at);
      if (items.length === 0 && !empty) continue;
      const section = el("section", key);
      const h2 = el("h2", "", title);
      if (items.length) h2.appendChild(el("span", "n", items.length));
      section.appendChild(h2);
      if (items.length === 0) section.appendChild(el("p", "empty", page.readAt ? empty : "Stella will fill this in when she reads your mail."));
      for (const item of items) section.appendChild(renderItem(item));
      root.appendChild(section);
    }

    if (page.ignored && page.ignored.count > 0) {
      const details = el("details", "ignored");
      if (ui.ignoredOpen) details.open = true;
      details.addEventListener("toggle", () => {
        ui.ignoredOpen = details.open;
      });
      details.appendChild(el("summary", "", "Ignored " + page.ignored.count + (page.ignored.count === 1 ? " email" : " emails")));
      if (page.ignored.gist) details.appendChild(el("p", "meta", page.ignored.gist));
      if (page.ignored.senders && page.ignored.senders.length) {
        const list = el("ul", "senders");
        for (const sender of page.ignored.senders) {
          const li = el("li");
          li.appendChild(el("span", "", sender.name));
          li.appendChild(el("span", "", sender.count));
          list.appendChild(li);
        }
        details.appendChild(list);
      }
      root.appendChild(details);
    }

    root.appendChild(renderFooter());

    for (const [id, value] of Object.entries(drafts)) {
      const area = root.querySelector('article[data-id="' + CSS.escape(id) + '"] textarea');
      if (area) area.value = value;
    }
    if (focused && focused.id) {
      const area = root.querySelector('article[data-id="' + CSS.escape(focused.id) + '"] textarea');
      if (area) {
        area.focus();
        try { area.setSelectionRange(focused.start, focused.start); } catch {}
      }
    }
  };

  window.addEventListener("stella:data", (event) => {
    const data = event.detail || {};
    document.documentElement.classList.toggle("dark", data.theme === "dark");
    if (data.accent) document.documentElement.style.setProperty("--accent", data.accent);
    if (data.accentFg) document.documentElement.style.setProperty("--accent-fg", data.accentFg);
    locale = data.locale || undefined;
    const before = view ? new Map(view.page.items.map((item) => [item.id, item.at])) : null;
    view = data.view || null;
    if (view && before) {
      for (const item of view.page.items) {
        if (before.get(item.id) !== item.at) delete ui.pending[item.id];
      }
    }
    render();
  });

  document.addEventListener("stella:action", (event) => {
    const detail = event.detail || {};
    const match = /^(do|undo|tell):(.+)$/.exec(detail.id || "");
    if (!match) return;
    const id = match[2];
    if (detail.state === "sent") {
      if (match[1] === "tell") ui.telling[id] = false;
      ui.pending[id] = match[1] === "tell" ? "Sent to Stella." : "Stella's on it.";
      render();
    } else if (detail.state === "failed" || detail.state === "refused") {
      ui.pending[id] = undefined;
      render();
    }
  });
})();
`.concat("</", "script>\n</body>\n</html>");
