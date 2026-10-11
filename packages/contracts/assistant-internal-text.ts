import { PI_REPORT_RE } from "./pi-chat.js";

const FENCE_RE = /^\s{0,3}(```|~~~)/;
const HARNESS_BLOCK_RE = /<harness>\s*([\s\S]*?)\s*<\/harness>/g;
const REPORT_FIELD_RE = /^([a-z_]+):\s?(.*?)\s*$/;
const HIDDEN_REPORT_FIELDS = new Set([
  "thread_id",
  "agent_type",
  "agent_state",
  "presentation",
]);

const mapOutsideCode = (text: string, map: (prose: string) => string) => {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const marker = FENCE_RE.exec(line)?.[1] ?? null;
    if (fence === null && marker) {
      out.push(map(prose.join("\n")));
      prose = [];
      fence = marker;
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      if (marker === fence) fence = null;
      continue;
    }
    prose.push(line);
  }
  if (fence === null) out.push(map(prose.join("\n")));
  else out.push(prose.join("\n"));
  return out.join("\n");
};

const presentReportEcho = (text: string): string => {
  const lines = text.trimStart().split("\n");
  const heading = PI_REPORT_RE.exec(lines[0]?.trim() ?? "")?.[1];
  if (!heading) return text;
  const fields = new Map<string, string>();
  let index = 1;
  for (; index < lines.length; index += 1) {
    const match = REPORT_FIELD_RE.exec(lines[index]!.trim());
    if (!match) break;
    fields.set(match[1]!, match[2]!);
  }
  if (fields.size === 0) return text;
  const description = fields.get("description")?.trim();
  const detail = (fields.get("error") ?? fields.get("result"))?.trim();
  const extra = [...fields]
    .filter(
      ([key]) =>
        !HIDDEN_REPORT_FIELDS.has(key) &&
        key !== "description" &&
        key !== "error" &&
        key !== "result",
    )
    .map(([key, value]) => `${key}: ${value}`);
  const summary = [
    `**${heading}**${description ? `: ${description}` : ""}`,
    ...(detail ? [detail] : []),
    ...extra,
  ].join("\n\n");
  const rest = lines.slice(index).join("\n").trim();
  return rest ? `${summary}\n\n${rest}` : summary;
};

/**
 * Stella's reply as the desktop and the phone show it. A reply sometimes repeats what the
 * runtime told the model rather than the user: a tool's `<harness>`
 * diagnostics, or the header of an agent's report. Diagnostics outside code
 * show as their text, as a markdown sanitizer that drops the
 * unknown tag would, and an echoed report keeps its outcome, task and message but
 * not its internal thread and agent fields.
 */
export const presentAssistantText = (text: string): string => {
  if (!text.includes("<harness>") && !PI_REPORT_RE.test(text.trimStart())) {
    return text;
  }
  return presentReportEcho(
    mapOutsideCode(text, (prose) =>
      prose.replace(HARNESS_BLOCK_RE, (_block, inner: string) => inner.trim()),
    ),
  );
};
