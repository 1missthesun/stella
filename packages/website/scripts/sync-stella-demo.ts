import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { THEME_CSS_VARS, deriveTokens, getThemeById } from "@stella/theme";

const WEBSITE = path.resolve(import.meta.dirname, "..");
const UI = path.resolve(WEBSITE, "../desktop-ui/src");
const OUT = path.join(WEBSITE, "src/components/stella-demo");
const SCOPE = ".sd";

type Node =
  | { kind: "rule"; selector: string; body: string }
  | { kind: "at"; prelude: string; children: Node[] | null; body: string };

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function parse(css: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    const semi = css.indexOf(";", i);
    if (open < 0) break;
    if (semi >= 0 && semi < open && css.slice(i, semi).trim().startsWith("@")) {
      i = semi + 1;
      continue;
    }
    const head = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith("@")) {
      const nested = /^@(media|supports|container)/.test(head);
      nodes.push({ kind: "at", prelude: head, children: nested ? parse(body) : null, body });
    } else {
      nodes.push({ kind: "rule", selector: head.replace(/\s+/g, " "), body });
    }
    i = j;
  }
  return nodes;
}

const splitSelectors = (selector: string) => {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of selector) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && !depth) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

type Pick = (selector: string) => boolean;

const SOURCES: { file: string; pick: Pick; keyframes: string[] }[] = [
  { file: "shared/styles/app-base.css", pick: (s) => [".app", ".app *", ".app button", ".app input", ".app textarea", ".app select"].includes(s), keyframes: [] },
  {
    file: "app/chat/full-shell.chat.css",
    pick: (s) =>
      [
        ":root",
        ".chat-viewport-region",
        ".event-row",
        ".message-line",
        ".message-line--assistant",
        ".message-line--user",
        ".message-line > .assistant-message-text",
        ".chat-time-divider",
        ".assistant-message-text",
        ".chat-bubble-text",
        ".event-item",
        ".event-item.user",
        ".event-item.assistant",
        ".event-body",
        ".event-row--user--just-sent .event-item.user",
        ".event-row--assistant--just-arrived .event-item.assistant",
        ".event-item.assistant .markdown",
        ".event-item.assistant .markdown :is(p, li, blockquote, td, th)",
        ".event-item.assistant .markdown :is(strong, b, th)",
      ].includes(s),
    keyframes: ["bubble-pop", "bubble-pop-fade"],
  },
  {
    file: "app/chat/indicators.css",
    pick: (s) =>
      /^\.(working-indicator|working-status|swap-text|inline-working-indicator|event-list-working-indicator|indicator-stella|text-shimmer)/.test(s) &&
      !/sidebar|orb|session-messages|chat-sidebar/.test(s),
    keyframes: ["swap-text-in", "swap-text-out", "inline-indicator-in", "inline-indicator-out", "inline-indicator-handoff-out", "stream-fade-in"],
  },
  { file: "app/chat/text-shimmer.css", pick: () => true, keyframes: [] },
  {
    file: "app/chat/markdown.css",
    pick: (s) =>
      /^\.markdown( > \*:(first|last)-child| (p|strong|b|a|ul|ol|li|li::marker|li > ul|li > ol|code)|)$/.test(s) ||
      /^\.markdown :not\(pre\) > code$/.test(s),
    keyframes: [],
  },
  {
    file: "app/chat/full-shell.composer.css",
    pick: (s) =>
      [".composer", ".composer-shell", ".composer-shell-content", ".composer-form", ".composer-input", ".composer-add-button", ".composer-submit", ".composer-mic"].includes(s) ||
      /^\.composer-(toolbar|toolbar-left|toolbar-right)$/.test(s) ||
      /^\.composer-form(\.expanded| \.composer-add-button--toolbar|:not\(\.expanded\) \.composer-model-mention-field)/.test(s),
    keyframes: [],
  },
  {
    file: "features/chat/composer-primitives.css",
    pick: (s) =>
      /^\.chat-composer-(field|field::placeholder|textarea|icon-button|icon-button--(add|stop|submit|mic)(:disabled)?)$/.test(s),
    keyframes: [],
  },
  {
    file: "shell/full-shell.layout.css",
    pick: (s) => [".chat-viewport-region", ".full-body-chat-layer", ".session-content", ".shell-topbar-tab"].includes(s),
    keyframes: [],
  },
  {
    file: "shell/shell-topbar-full.css",
    pick: (s) => [".shell-topbar-full", ".shell-topbar-full__left", ".shell-topbar-full__right"].includes(s),
    keyframes: [],
  },
  {
    file: "shell/shell-topbar-activity.css",
    pick: (s) =>
      /^\.shell-topbar-activity(__trigger|__mark|__label|__label \.text-shimmer|)$/.test(s) ||
      s === '[data-component="popover-content"].shell-topbar-activity-menu-popover',
    keyframes: [],
  },
  {
    file: "app/chat/chat-workspace-strip.css",
    pick: (s) =>
      /^\.chat-workspace-strip__(section|section-body|task-row|task-row-head|task-button|task-icon-wrap|task-icon|task-icon--(running|done)|task-label|task-label \.text-shimmer|task-progress|task-progress-item|task-progress-item\[data-newest="true"\]|row-meta)$/.test(s) ||
      s === ".chat-workspace-strip__task-row-head .chat-workspace-strip__task-button" ||
      /^\.chat-workspace-strip__task-row\[data-status="completed"\] \.chat-workspace-strip__task-label$/.test(s),
    keyframes: ["chat-workspace-strip__progress-in"],
  },
  {
    file: "ui/popover.css",
    pick: (s) => s === '[data-component="popover-content"]',
    keyframes: [],
  },
  {
    file: "shell/sidebar-sections/home-search.css",
    pick: (s) => s === ".sidebar-search" || s === ".sidebar-search__body",
    keyframes: [],
  },
  {
    file: "app/chat/file-preview-card-shell.css",
    pick: (s) => /^\.file-preview-card(__header|__title-group|__eyebrow|__title|)$/.test(s),
    keyframes: [],
  },
  {
    file: "app/chat/agent-activity-row.css",
    pick: (s) => /^\.agent-activity-files(--bubble|__pills|__pill|__pill-open|__pill-icon|__pill-name)$/.test(s),
    keyframes: [],
  },
];

const allKeyframes = new Set(SOURCES.flatMap((source) => source.keyframes));
const renameAnimations = (body: string) =>
  body.replace(/(animation(?:-name)?\s*:)([^;]*)/g, (_, prop: string, value: string) =>
    prop + value.replace(/[\w-]+/g, (word) => (allKeyframes.has(word) ? `sd-${word}` : word)),
  );

const scopeSelector = (selector: string) =>
  splitSelectors(selector)
    .map((s) => {
      if (s === ":root") return SCOPE;
      return `${SCOPE} ${s}`;
    })
    .join(",\n");

const tidy = (body: string) =>
  body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

function emit(nodes: Node[], pick: Pick, keyframes: string[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "rule") {
      if (splitSelectors(node.selector).every(pick)) out.push(`${scopeSelector(node.selector)} { ${renameAnimations(tidy(node.body))} }`);
      continue;
    }
    const keyframe = /^@keyframes\s+([\w-]+)/.exec(node.prelude);
    if (keyframe) {
      if (keyframes.includes(keyframe[1])) out.push(`@keyframes sd-${keyframe[1]} { ${tidy(node.body)} }`);
      continue;
    }
    if (node.children && /^@(media|supports)/.test(node.prelude) && !/max-width: (600|640)px/.test(node.prelude)) {
      const inner = emit(node.children, pick, keyframes);
      if (inner.length) out.push(`${node.prelude} {\n  ${inner.join("\n  ")}\n}`);
    }
  }
  return out;
}

const STATIC_PREFIXES = ["--font-family-sans--", "--font-size-", "--weight-", "--radius-", "--space-", "--lh-"];
const STATIC_NAMES = [
  "--font-family-sans",
  "--font-family-mono",
  "--font-family-display",
  "--shadow-sm",
  "--shadow-overlay",
  "--overlay-surface-bg",
  "--glass-blur",
  "--panel-surface-bg-gradient",
  "--panel-surface-highlight",
  "--chat-assistant-bubble-fill",
  "--surface-base",
  "--text-muted",
  "--focus-ring",
];
const isStaticToken = (name: string) => STATIC_NAMES.includes(name) || STATIC_PREFIXES.some((prefix) => name.startsWith(prefix));

function staticTokens(): { base: string[]; dark: string[] } {
  const nodes = parse(stripComments(readFileSync(path.join(UI, "index.css"), "utf8")));
  const base: string[] = [];
  const dark: string[] = [];
  const decls = (body: string) =>
    body
      .split(";")
      .map((d) => d.trim().replace(/\s+/g, " "))
      .filter((d) => d.startsWith("--"));
  for (const node of nodes) {
    const target = node.kind === "rule" && node.selector === ":root" ? base : node.kind === "rule" && node.selector === ".dark" ? dark : node.kind === "at" && node.prelude === "@theme inline" ? base : null;
    if (!target) continue;
    for (const decl of decls(node.body)) if (isStaticToken(decl.split(":")[0].trim())) target.push(decl);
  }
  return { base, dark };
}

function themeTokens(dark: boolean): string[] {
  const theme = getThemeById("default")!;
  const tokens = deriveTokens(dark ? theme.dark : theme.light, dark, { flat: theme.flat === true });
  return THEME_CSS_VARS.map(([name, key]) => `${name}: ${tokens[key]}`);
}

function buildCss(): string {
  const { base, dark } = staticTokens();
  const parts = [
    "/* Generated by scripts/sync-stella-demo.ts from packages/desktop-ui and packages/theme. Do not edit. */",
    `${SCOPE} { ${base.join("; ")}; }`,
    `${SCOPE}[data-theme="light"] { color-scheme: light; ${themeTokens(false).join("; ")}; }`,
    `${SCOPE}[data-theme="dark"] { color-scheme: dark; ${dark.join("; ")}; ${themeTokens(true).join("; ")}; }`,
  ];
  for (const source of SOURCES) {
    const css = stripComments(readFileSync(path.join(UI, source.file), "utf8"));
    const rules = emit(parse(css), source.pick, source.keyframes);
    if (!rules.length) throw new Error(`${source.file}: nothing matched; the replica's source moved`);
    const missing = source.keyframes.filter((name) => !rules.some((rule) => rule.startsWith(`@keyframes sd-${name} `)));
    if (missing.length) throw new Error(`${source.file}: keyframes ${missing.join(", ")} are gone`);
    parts.push(`/* ${source.file} */`, ...rules);
  }
  return `${parts.join("\n")}\n`;
}

const TIMINGS: { name: string; file: string; constant: string }[] = [
  { name: "indicatorShowDelayMs", file: "features/chat/working-indicator-state.ts", constant: "INLINE_WORKING_INDICATOR_SHOW_DELAY_MS" },
  { name: "indicatorMinVisibleMs", file: "features/chat/working-indicator-state.ts", constant: "INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS" },
  { name: "indicatorPoseRotateMs", file: "features/chat/working-indicator-state.ts", constant: "WORKING_INDICATOR_POSE_ROTATE_MS" },
  { name: "indicatorEnterMs", file: "app/chat/InlineWorkingIndicator.tsx", constant: "ENTER_ANIMATION_MS" },
  { name: "indicatorExitMs", file: "app/chat/InlineWorkingIndicator.tsx", constant: "EXIT_ANIMATION_MS" },
  { name: "handoffWaitMs", file: "app/chat/reply-handoff.ts", constant: "HANDOFF_WAIT_MS" },
  { name: "runEndWaitMs", file: "app/chat/reply-handoff.ts", constant: "RUN_END_WAIT_MS" },
  { name: "followLerp", file: "shell/use-chat-scroll-management.ts", constant: "FOLLOW_LERP_FACTOR" },
  { name: "activityMarkSize", file: "shell/ShellTopBarActivity.tsx", constant: "MARK_SIZE_PX" },
  { name: "activityLabelShimmerMs", file: "shell/ShellTopBarActivity.tsx", constant: "LABEL_SHIMMER_MS" },
  { name: "indicatorMarkSize", file: "app/chat/WorkingIndicator.tsx", constant: "INDICATOR_MARK_SIZE_PX" },
  { name: "rowGap", file: "app/chat/ChatTimeline.tsx", constant: "ROW_GAP" },
  { name: "assistantRunGap", file: "app/chat/ChatTimeline.tsx", constant: "ASSISTANT_RUN_GAP" },
  { name: "userRunGap", file: "app/chat/ChatTimeline.tsx", constant: "USER_RUN_GAP" },
  { name: "composerExpandedRadiusPx", file: "shared/hooks/use-animated-composer-shell.ts", constant: "expandedRadiusPx" },
];

const COLUMN_FIELDS = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"] as const;

function buildTimings(): string {
  const lines = TIMINGS.map(({ name, file, constant }) => {
    const source = readFileSync(path.join(UI, file), "utf8");
    const match = new RegExp(`const ${constant}\\s*=\\s*([\\d.]+)`).exec(source);
    if (!match) throw new Error(`${file}: ${constant} is gone`);
    return `  /** ${constant} in desktop-ui/src/${file} */\n  ${name}: ${match[1]},`;
  });
  const shell = readFileSync(path.join(UI, "shared/hooks/use-animated-composer-shell.ts"), "utf8");
  const expandAbove = /if \(textarea\.scrollHeight > (\d+)\) setExpanded\(true\)/.exec(shell)?.[1];
  const collapseAtMost = /if \(pillScrollHeight <= (\d+)\) setExpanded\(false\)/.exec(shell)?.[1];
  if (!expandAbove || expandAbove !== collapseAtMost) throw new Error("use-animated-composer-shell.ts: the composer's expand rule changed shape");
  lines.push(`  /** updateComposerTextareaExpansion in desktop-ui/src/shared/hooks/use-animated-composer-shell.ts: the one-line pill holds a field this tall */\n  composerPillMaxPx: ${expandAbove},`);
  const placeholder = JSON.parse(readFileSync(path.join(UI, "shared/i18n/locales/en.json"), "utf8"))?.app?.chat?.composer?.placeholder?.default;
  if (typeof placeholder !== "string") throw new Error("en.json: app.chat.composer.placeholder.default is gone");
  const column = /FULL_CHAT_CONTENT_STYLE[^=]*=\s*\{([^}]*)\}/.exec(readFileSync(path.join(UI, "app/chat/ChatColumn.tsx"), "utf8"))?.[1];
  if (!column) throw new Error("ChatColumn.tsx: FULL_CHAT_CONTENT_STYLE is gone");
  const maxWidth = /maxWidth:\s*"min\(([\d.]+)rem, 100%\)"/.exec(column)?.[1];
  if (!maxWidth) throw new Error("ChatColumn.tsx: the column's maxWidth changed shape");
  const fields = COLUMN_FIELDS.map((field) => {
    const value = new RegExp(`${field}:\\s*(\\d+)`).exec(column)?.[1];
    if (!value) throw new Error(`ChatColumn.tsx: ${field} is gone`);
    return `    ${field}: ${value},`;
  });
  return `// Generated by scripts/sync-stella-demo.ts from packages/desktop-ui. Do not edit.\nexport const APP_TIMING = {\n${lines.join("\n")}\n} as const;\n\n/** FULL_CHAT_CONTENT_STYLE in desktop-ui/src/app/chat/ChatColumn.tsx */\nexport const APP_COLUMN = {\n    maxWidthRem: ${maxWidth},\n${fields.join("\n")}\n} as const;\n\n/** app.chat.composer.placeholder.default in desktop-ui/src/shared/i18n/locales/en.json */\nexport const APP_COMPOSER_PLACEHOLDER = ${JSON.stringify(placeholder)};\n`;
}

const ICONS = ["Plus", "Mic", "ArrowUp", "CircleDot", "CheckCircle2", "FileText", "Bell", "Monitor", "SlidersHorizontal", "Settings", "MessageSquare"];

const sharedIcon = (source: string, constant: string) => {
  const found = new RegExp(`const ${constant}\\s*=\\s*\\(?\\s*<>([\\s\\S]*?)</>\\s*\\)?;`).exec(source)?.[1];
  if (!found) throw new Error(`ui/icons.tsx: ${constant} is gone`);
  return found.replace(/\s+/g, " ").trim();
};

function buildIcons(): string {
  const source = readFileSync(path.join(UI, "ui/icons.tsx"), "utf8");
  const entries = ICONS.map((name) => {
    const start = source.indexOf(`export const ${name} = createIcon(`);
    if (start < 0) throw new Error(`ui/icons.tsx: ${name} is gone`);
    const open = source.indexOf(",", start) + 1;
    const end = source.indexOf(");\n", open);
    const bare = /^\s*(\w+)\s*$/.exec(source.slice(open, end))?.[1];
    if (bare) return `  ${name}: ${JSON.stringify(sharedIcon(source, bare))},`;
    const svg = source
      .slice(open, end)
      .replace(/=\{(\w+)\}/g, (_, constant: string) => {
        const value = new RegExp(`const ${constant}\\s*=\\s*("[^"]*")`).exec(source)?.[1];
        if (!value) throw new Error(`ui/icons.tsx: ${constant} is gone`);
        return `=${value}`;
      })
      .replace(/\{(\w+)\}/g, (_, constant: string) => sharedIcon(source, constant))
      .replace(/<\/?>/g, "")
      .replace(/\s+/g, " ")
      .replace(/ ([a-z]+[A-Z][A-Za-z]*)=/g, (_, attr: string) => ` ${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}=`)
      .trim();
    if (/[{}]/.test(svg)) throw new Error(`ui/icons.tsx: ${name} uses expressions the replica can't copy`);
    return `  ${name}: ${JSON.stringify(svg)},`;
  });
  return `// Generated by scripts/sync-stella-demo.ts from packages/desktop-ui/src/ui/icons.tsx. Do not edit.\nexport const APP_ICONS = {\n${entries.join("\n")}\n} as const;\n\nexport type AppIconName = keyof typeof APP_ICONS;\n`;
}

const FONT = { from: path.join(UI, "assets/fonts/manrope.woff2"), to: path.join(OUT, "manrope.woff2") };

const outputs: { file: string; content: string | Buffer }[] = [
  { file: path.join(OUT, "app.generated.css"), content: buildCss() },
  { file: path.join(OUT, "app-timing.generated.ts"), content: buildTimings() },
  { file: path.join(OUT, "app-icons.generated.ts"), content: buildIcons() },
  { file: FONT.to, content: readFileSync(FONT.from) },
];

if (process.argv.includes("--check")) {
  const stale = outputs.filter(({ file, content }) => {
    try {
      return !Buffer.from(content).equals(readFileSync(file));
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(
      `The Stella chat replica is behind the desktop app: ${stale.map(({ file }) => path.relative(WEBSITE, file)).join(", ")}.\nRun \`bun scripts/sync-stella-demo.ts\` in packages/website, look at a guide page, and commit the result.`,
    );
    process.exit(1);
  }
  console.log("Stella chat replica matches the desktop app.");
} else {
  for (const { file, content } of outputs) writeFileSync(file, content);
  console.log(`Wrote ${outputs.map(({ file }) => path.relative(WEBSITE, file)).join(", ")}`);
}
