import type { Context } from "@earendil-works/chord";
import { defineExtension, section, type PromptInput, type PromptSection } from "@earendil-works/pi-durable";
import {
  renderExecutionDestination,
  renderExecutionDevices,
  renderMediaAccess,
} from "@stella/contracts/execution-context";
import { STELLA_MESSAGE_TARGET } from "@stella/contracts/agent-directory";
import { renderStellaPrompt, stellaPromptTools } from "@stella/contracts/stella-prompts";
import {
  MAIN_MEMORY_DISPLAY_PATH,
  MAIN_MEMORY_INJECTED_MAX_CHARS,
} from "@stella/runtime/kernel/memory/memory-layout";
import { shapeResidentMemoryDoc } from "@stella/runtime/kernel/memory/resident-doc-shape";
import { responseLanguageSection } from "@stella/runtime/kernel/runner/locale-prompt";
import { StellaAgentDoc, type StellaAgentRole } from "./agent-doc.ts";
import { messageIdsHook } from "./message-ids.ts";
import { imageBudgetHook } from "./image-budget.ts";
import { processableImagesHook } from "./processable-images.ts";
import { ENGINE_MODEL_SECTION, engineModelText, residentContextHook, runsOn } from "./resident-context.ts";
import type { StellaAgentPromptId, StellaContextSources } from "./context.ts";

export const STELLA_PROMPT_EXTENSION = "stella-prompt";

export const promptBody = (source: string): string => {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
  return (match ? source.slice(match[0].length) : source).trim();
};

const startupDoc = (path: string, content: string | undefined): string | undefined =>
  content === undefined || content.trim() === ""
    ? undefined
    : `<startup_doc path="${path}">\n${content.trim()}\n</startup_doc>`;

const memoryDoc = (path: string, raw: string | undefined, maxChars: number): string | undefined =>
  startupDoc(path, raw === undefined ? undefined : shapeResidentMemoryDoc(raw, maxChars));

const role = async (input: PromptInput, context: Context): Promise<StellaAgentRole> =>
  (await input.read.snapshot(StellaAgentDoc, input.conversationId, context)) ?? { agentType: "orchestrator", depth: 0 };

const promptIdFor = (agent: StellaAgentRole): StellaAgentPromptId =>
  agent.agentType === "orchestrator" ? "agents/orchestrator.md" : "agents/general.md";

const AGENTS_MD_MAX_CHARS = 32_000;

const homeFoldersLine = (folders: { home: string; stellaHome: string }): string =>
  `Your home folder \`~\` is ${folders.home} and \`~/.stella/\` is ${folders.stellaHome}; expand \`~\` from these when a path must be absolute, never from other paths you see.`;

const workingDirectory = async (
  input: PromptInput,
  context: Context,
  homeFolders: StellaContextSources["homeFolders"],
): Promise<string | undefined> => {
  const lines: string[] = [];
  const cwd = input.agent.cwd;
  const env = input.env;
  if (cwd && env && (await role(input, context)).agentType !== "orchestrator") {
    lines.push(
      `Your working directory is ${cwd}: shell commands and relative paths start there. You can still read and change files anywhere the work needs.`,
    );
    const file = await env.joinPath([env.cwd, "AGENTS.md"], context);
    const text = file.ok ? await env.readTextFile(file.value, context) : undefined;
    if (file.ok && text?.ok && text.value.trim()) {
      const body = text.value.trim();
      const shown =
        body.length > AGENTS_MD_MAX_CHARS
          ? `${body.slice(0, AGENTS_MD_MAX_CHARS)}\n\n[Truncated: read ${file.value} for the rest.]`
          : body;
      lines.push(`The project's instructions for agents, from ${file.value}:`, startupDoc(file.value, shown)!);
    }
  }
  if (homeFolders) lines.splice(Math.min(lines.length, 1), 0, homeFoldersLine(homeFolders));
  return lines.length > 0 ? lines.join("\n\n") : undefined;
};

const agentIdentity: PromptSection["render"] = async (input, context) => {
  const agent = await role(input, context);
  if (agent.agentType === "orchestrator" || !agent.threadId) return undefined;
  const starter = agent.startedBy
    ? agent.startedBy.label === "Stella"
      ? `Stella started you; its thread_id is ${agent.startedBy.threadId} ("${STELLA_MESSAGE_TARGET}" also reaches it).`
      : `The agent "${agent.startedBy.label}" started you; its thread_id is ${agent.startedBy.threadId}.`
    : `Stella started you; send_message to "${STELLA_MESSAGE_TARGET}" reaches it.`;
  return [
    `Your thread_id is ${agent.threadId}.`,
    starter,
    'Every message from Stella or another agent arrives as `<agent-message from="…" thread_id="…">`, marked `relation="started you"` when it is from whoever started you; answer it with send_message to that thread_id.',
  ].join(" ");
};

const orchestratorOnly = (
  render: (input: PromptInput, context: Context) => Promise<string | undefined>,
): PromptSection["render"] =>
  async (input, context) => ((await role(input, context)).agentType === "orchestrator" ? render(input, context) : undefined);

export function stellaPromptExtension(sources: StellaContextSources) {
  const memory = (context: Context) => sources.memory(context);
  return defineExtension({
    name: STELLA_PROMPT_EXTENSION,
    hooks: [
      ...(sources.requestImageBytes ? [imageBudgetHook(sources.requestImageBytes)] : []),
      processableImagesHook,
      residentContextHook,
      messageIdsHook,
    ],
    sections: [
      section(
        "preamble",
        async (input, context) => {
          const agent = await role(input, context);
          const source = await sources.agentPrompt(promptIdFor(agent), context);
          if (source === undefined) return undefined;
          const memoryOn = agent.agentType === "orchestrator" && (await memory(context)).enabled;
          const hasCode = input.agent.tools.some((tool) => tool.name === "code");
          const tools = stellaPromptTools(
            input.agent.tools.map((tool) => tool.name),
            {
              history: hasCode && ((await sources.codeHistory?.(agent.agentType, context)) ?? false),
              memory: memoryOn && hasCode,
            },
          );
          return renderStellaPrompt(promptBody(source), { env: sources.env, tools });
        },
        { tag: false },
      ),
      section(
        "personality",
        orchestratorOnly(async (_input, context) => startupDoc("~/.stella/PERSONALITY.md", await sources.personality(context))),
        { tag: false },
      ),
      section(
        "main-memory",
        orchestratorOnly(async (_input, context) => {
          const docs = await memory(context);
          return docs.enabled ? memoryDoc(MAIN_MEMORY_DISPLAY_PATH, docs.main, MAIN_MEMORY_INJECTED_MAX_CHARS) : undefined;
        }),
        { tag: false },
      ),
      section("skills", async (_input, context) => sources.skillsCatalog(context), { tag: false }),
      section("execution-devices", async (input, context) => {
        const orchestrator = (await role(input, context)).agentType === "orchestrator";
        if (!orchestrator && !input.agent.tools.some((tool) => tool.name === "switch_destination")) return undefined;
        const snapshot = await sources.executionContext(input.conversationId, context);
        return snapshot && renderExecutionDevices(snapshot, orchestrator ? "orchestrator" : "agent");
      }),
      section("execution-destination", async (input, context) => {
        const snapshot = await sources.executionContext(input.conversationId, context);
        return snapshot && renderExecutionDestination(snapshot);
      }),
      section(ENGINE_MODEL_SECTION, async (input) =>
        input.agent.model ? engineModelText(runsOn(input.agent.model.provider, input.agent.model.modelId, input.agent.thinkingLevel)) : undefined,
      ),
      section("working-directory", async (input, context) =>
        sources.env === "cloud" ? undefined : workingDirectory(input, context, sources.homeFolders),
      ),
      section("agent-identity", agentIdentity),
      section("media-access", async (input, context) => {
        const snapshot = await sources.executionContext(input.conversationId, context);
        return snapshot && renderMediaAccess(snapshot);
      }),
      section(
        "response-language",
        orchestratorOnly(async (_input, context) => responseLanguageSection(await sources.locale?.(context))?.text),
        { tag: false },
      ),
    ],
  });
}
