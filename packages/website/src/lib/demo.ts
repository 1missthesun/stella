export type DemoCard = {
  kind?: string;
  title: string;
  lines?: string[];
  image?: { src: string; alt: string; width: number; height: number };
};

export type DemoStep =
  | { you: string }
  | { stella: string; files?: string[] }
  | { task: string; rows: string[] }
  | { card: DemoCard }
  | { caption: string };

export function demoFrom({
  prompt,
  ack,
  task,
  rows,
  reply,
  files,
}: {
  prompt: string;
  ack?: string;
  task?: string;
  rows?: string[];
  reply: string;
  files?: string[];
}): DemoStep[] {
  const steps: DemoStep[] = [{ caption: "Ask in your own words." }, { you: prompt }];
  if (ack) steps.push({ stella: ack });
  if (task) steps.push({ caption: "Stella does it on your computer." }, { task, rows: rows ?? [] });
  steps.push({ caption: task ? "Then tells you what it did." : "And answers." }, { stella: reply, ...(files?.length ? { files } : {}) });
  return steps;
}

export type DemoInline = { text: string; bold?: boolean; href?: string; code?: boolean };
export type DemoBlock = { kind: "p"; parts: DemoInline[] } | { kind: "ul"; items: DemoInline[][] };

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

export function parseInline(text: string): DemoInline[] {
  const parts: DemoInline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    if (match[1] !== undefined) parts.push({ text: match[1], bold: true });
    else if (match[2] !== undefined) parts.push({ text: match[2], href: match[3] });
    else parts.push({ text: match[4], code: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

export function parseBlocks(text: string): DemoBlock[] {
  const blocks: DemoBlock[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push({ kind: "p", parts: [] });
      continue;
    }
    const bullet = /^[-•*]\s+(.*)$/.exec(trimmed);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.items.push(parseInline(bullet[1]));
      else blocks.push({ kind: "ul", items: [parseInline(bullet[1])] });
    } else if (last?.kind === "p" && last.parts.length) {
      last.parts.push({ text: " " }, ...parseInline(trimmed));
    } else {
      if (last?.kind === "p" && !last.parts.length) blocks.pop();
      blocks.push({ kind: "p", parts: parseInline(trimmed) });
    }
  }
  return blocks.filter((block) => block.kind === "ul" || block.parts.length);
}

export function demoText(steps: DemoStep[]): string {
  const lines: string[] = [];
  for (const step of steps) {
    if ("you" in step) lines.push(`**You:** ${step.you}`, "");
    else if ("stella" in step) {
      lines.push(`**Stella:** ${step.stella}`);
      if (step.files?.length) lines.push(`Files: ${step.files.join(", ")}`);
      lines.push("");
    } else if ("task" in step) {
      lines.push(`*Stella works on: ${step.task}*`, ...step.rows.map((row) => `- ${row}`), "");
    } else if ("card" in step) {
      lines.push(`*${step.card.kind ? `${step.card.kind}: ` : ""}${step.card.title}*`, ...(step.card.lines ?? []).map((line) => `- ${line}`), "");
    }
  }
  return lines.join("\n").trimEnd();
}

export const demoReply = (steps: DemoStep[]) =>
  [...steps].reverse().find((step): step is Extract<DemoStep, { stella: string }> => "stella" in step)?.stella ?? "";

export type ChatItem =
  | { kind: "user"; text: string; step: number }
  | { kind: "assistant"; text: string; files?: string[]; step: number }
  | { kind: "card"; card: DemoCard; step: number };

export function chatItems(steps: DemoStep[]): ChatItem[] {
  const items: ChatItem[] = [];
  steps.forEach((step, i) => {
    if ("you" in step) items.push({ kind: "user", text: step.you, step: i });
    else if ("stella" in step && (step.stella.trim() || step.files?.length)) items.push({ kind: "assistant", text: step.stella, files: step.files, step: i });
    else if ("card" in step) items.push({ kind: "card", card: step.card, step: i });
  });
  return items;
}
