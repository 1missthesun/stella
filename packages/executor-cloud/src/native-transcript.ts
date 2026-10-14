import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";

type Execution = Extract<CloudExecutionSelection, { engine: "anthropic" }>;
type Block = Record<string, unknown>;
type Usage = { inputTokens: number; outputTokens: number; llmCalls: number };

const MCP_PREFIX = "mcp__stella__";
const RESULT_MAX_CHARS = 16_000;
const ARGUMENTS_MAX_CHARS = 64_000;
const TURN_MAX_CHARS = 2_000_000;

const asRecord = (value: unknown): Block | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Block) : undefined;

const numberAt = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n[...truncated]` : text);

const resultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const block = asRecord(part);
      if (block?.type === "text" && typeof block.text === "string") return block.text;
      if (block?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const userText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const block = asRecord(part);
      return block?.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
};

const toolArguments = (input: unknown): Record<string, unknown> => {
  const record = asRecord(input) ?? {};
  const json = JSON.stringify(record);
  return json.length > ARGUMENTS_MAX_CHARS ? { truncated: clip(json, 2_000) } : record;
};

const usageOf = (raw: unknown) => {
  const usage = asRecord(raw);
  const input = numberAt(usage?.input_tokens);
  const output = numberAt(usage?.output_tokens);
  const cacheRead = numberAt(usage?.cache_read_input_tokens);
  const cacheWrite = numberAt(usage?.cache_creation_input_tokens);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
};

type OpenAssistant = {
  id: string;
  message: AgentMessage & { role: "assistant"; content: Block[] };
};

export const createNativeTranscript = (args: { prompt: string; inputPrompt: string; execution: Execution }) => {
  const messages: AgentMessage[] = [];
  const toolNames = new Map<string, string>();
  const assistants = new Map<string, OpenAssistant>();
  let promptEchoed = false;
  let assistantCount = 0;

  const assistant = (event: Block) => {
    const message = asRecord(event.message);
    if (!message || !Array.isArray(message.content)) return;
    const id = typeof message.id === "string" && message.id ? message.id : `message:${messages.length}`;
    let open = assistants.get(id);
    if (!open) {
      const created = {
        role: "assistant",
        content: [] as Block[],
        api: "claude-code",
        provider: args.execution.provider,
        model: args.execution.model,
        ...(typeof message.model === "string" && message.model ? { responseModel: message.model } : {}),
        responseId: id,
        usage: usageOf(message.usage),
        stopReason: "stop",
        timestamp: Date.now(),
      } as unknown as OpenAssistant["message"];
      open = { id, message: created };
      assistants.set(id, open);
      messages.push(created);
      assistantCount += 1;
    } else {
      (open.message as { usage: unknown }).usage = usageOf(message.usage);
    }
    for (const raw of message.content) {
      const block = asRecord(raw);
      if (!block) continue;
      if (block.type === "text" && typeof block.text === "string") {
        open.message.content.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        open.message.content.push({
          type: "thinking",
          thinking: block.thinking,
          ...(typeof block.signature === "string" ? { thinkingSignature: block.signature } : {}),
        });
      } else if (block.type === "redacted_thinking" && typeof block.data === "string") {
        open.message.content.push({ type: "thinking", thinking: "", thinkingSignature: block.data, redacted: true });
      } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
        const name = block.name.startsWith(MCP_PREFIX) ? block.name.slice(MCP_PREFIX.length) : block.name;
        toolNames.set(block.id, name);
        open.message.content.push({ type: "toolCall", id: block.id, name, arguments: toolArguments(block.input) });
        (open.message as { stopReason: string }).stopReason = "toolUse";
      }
    }
  };

  const user = (event: Block) => {
    const message = asRecord(event.message);
    const content = message?.content;
    if (event.isReplay === true) {
      const text = userText(content).trim();
      if (!text) return;
      if (!promptEchoed && text === args.inputPrompt.trim()) {
        promptEchoed = true;
        return;
      }
      messages.push({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const block = asRecord(raw);
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      messages.push({
        role: "toolResult",
        toolCallId: block.tool_use_id,
        toolName: toolNames.get(block.tool_use_id) ?? "tool",
        isError: block.is_error === true,
        content: [{ type: "text", text: clip(resultText(block.content), RESULT_MAX_CHARS) || "(no output)" }],
        timestamp: Date.now(),
      } as AgentMessage);
    }
  };

  return {
    observe(event: Record<string, unknown>): void {
      if (event.type === "assistant" && event.parent_tool_use_id == null) assistant(event);
      else if (event.type === "user" && event.parent_tool_use_id == null) user(event);
    },
    messages(result: { finalText: string; error?: string; usage: Usage }): AgentMessage[] | undefined {
      if (assistantCount === 0) return undefined;
      const turn: AgentMessage[] = [
        { role: "user", content: [{ type: "text", text: args.prompt }], timestamp: Date.now() } as AgentMessage,
        ...messages.filter((message) => message.role !== "assistant" || (message.content as unknown as Block[]).length > 0),
      ];
      const last = turn.findLast((message) => message.role === "assistant") as OpenAssistant["message"] | undefined;
      const lastText = (last?.content ?? [])
        .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();
      const finalText = result.finalText.trim();
      if (result.error || (finalText && finalText !== lastText) || turn.at(-1)?.role !== "assistant") {
        turn.push({
          role: "assistant",
          content: [{ type: "text", text: result.finalText || result.error || "" }],
          api: "claude-code",
          provider: args.execution.provider,
          model: args.execution.model,
          usage: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: result.usage.inputTokens + result.usage.outputTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: result.error ? "error" : "stop",
          ...(result.error ? { errorMessage: result.error } : {}),
          timestamp: Date.now(),
        } as AgentMessage);
      } else if (last) {
        (last as { stopReason: string }).stopReason = "stop";
      }
      return JSON.stringify(turn).length > TURN_MAX_CHARS ? undefined : turn;
    },
  };
};
