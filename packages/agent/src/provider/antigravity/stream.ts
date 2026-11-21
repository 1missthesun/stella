import { randomUUID } from "node:crypto";
import {
  calculateCost,
  clampThinkingLevel,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type StreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { convertMessages, convertTools } from "@earendil-works/pi-ai/api/google-shared";
import { sanitizeSurrogates } from "@earendil-works/pi-ai/utils/sanitize-unicode";
import {
  collapseSystemMessages,
  getCurrentTools,
  getInitialSystemMessage,
} from "@earendil-works/pi-ai/utils/transcript";
import { getSystemMessageText } from "@earendil-works/pi-ai";
import { antigravityEndpoint, antigravityModelEnum, antigravityRoute, antigravityUserAgent } from "./models.ts";
import { toGeminiSchema } from "./schema.ts";
import { agyFetch } from "./transport.ts";

/** What Stella's credential store hands the provider: the access token and the account's Antigravity project. */
export type AntigravityKey = { token: string; projectId: string };

export const encodeAntigravityKey = (key: AntigravityKey): string => JSON.stringify(key);

export const decodeAntigravityKey = (raw: string | undefined): AntigravityKey | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<AntigravityKey>;
    return typeof parsed.token === "string" && parsed.token && typeof parsed.projectId === "string" && parsed.projectId
      ? { token: parsed.token, projectId: parsed.projectId }
      : undefined;
  } catch {
    return undefined;
  }
};

type Session = {
  conversationId: string;
  trajectoryId: string;
  requests: number;
  lastExecutionId?: string;
  lastTimestamp: number;
  touchedAt: number;
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 256;
const sessions = new Map<string, Session>();

/** The CLI's print-mode session id: FNV-1a 64 of the empty string, as a signed decimal. */
const NUMERIC_SESSION_ID = BigInt.asIntN(64, 0xcbf29ce484222325n).toString();

const sessionFor = (key: string): Session => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (id !== key && now - entry.touchedAt > SESSION_TTL_MS) sessions.delete(id);
  }
  let session = sessions.get(key);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
      if (oldest) sessions.delete(oldest[0]);
    }
    session = { conversationId: randomUUID(), trajectoryId: randomUUID(), requests: 0, lastTimestamp: 0, touchedAt: now };
    sessions.set(key, session);
  }
  session.touchedAt = now;
  return session;
};

type Content = { role: string; parts: Array<Record<string, unknown>> };

const isPrompt = (content: Content) =>
  content.role === "user" &&
  content.parts.some((part) => !("functionResponse" in part) && part.text !== "[Continue]");

const hasSecondUserTurn = (contents: Content[]) => {
  let sawUser = false;
  let sawModel = false;
  for (const content of contents) {
    if (content.role === "model" && sawUser) sawModel = true;
    if (!isPrompt(content)) continue;
    if (sawModel) return true;
    sawUser = true;
  }
  return false;
};

const upperTypes = (tools: unknown) =>
  Array.isArray(tools)
    ? tools.map((tool: { functionDeclarations?: Array<Record<string, unknown>> }) => ({
        functionDeclarations: (tool.functionDeclarations ?? []).map(({ parameters, ...declaration }) => ({
          ...declaration,
          ...(parameters !== undefined ? { parameters: toGeminiSchema(parameters) } : {}),
        })),
      }))
    : undefined;

export type AntigravityRequest = { wireModel: string; requestId: string; body: Record<string, unknown> };

export function buildAntigravityRequest(
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
): AntigravityRequest {
  const level = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
  const route = antigravityRoute(model.id, level === "off" ? "low" : level);
  if (!route) throw new Error(`antigravity/${model.id} isn't an Antigravity model Stella knows.`);

  const normalized = collapseSystemMessages(context);
  const contents = convertMessages(model as Model<"google-generative-ai">, normalized) as Content[];
  const last = contents.at(-1);
  if (
    last?.role === "model" &&
    !(last.parts.length > 0 && last.parts.every((part) => "functionResponse" in part))
  ) {
    contents.push({ role: "user", parts: [{ text: "[Continue]" }] });
  }
  const system = getInitialSystemMessage(normalized.messages);
  const systemText = system ? getSystemMessageText(system) : "";
  const tools = getCurrentTools(normalized.messages);

  const sessionKey =
    options?.sessionId ||
    (() => {
      const first = normalized.messages.find((message) => message.role !== "system");
      return first?.timestamp !== undefined ? `message:${first.timestamp}` : "default";
    })();
  const session = sessionFor(sessionKey);
  const timestamp = Math.max(Date.now(), session.lastTimestamp + 1);
  session.lastTimestamp = timestamp;
  session.requests += 1;
  if (session.lastExecutionId || hasSecondUserTurn(contents)) session.lastExecutionId = randomUUID();
  const modelEnum = antigravityModelEnum(route.wireModel);

  const generationConfig: Record<string, unknown> = {
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxOutputTokens: Math.min(options?.maxTokens ?? route.maxOutputTokens, route.maxOutputTokens),
    thinkingConfig: route.thinkingConfig,
  };

  const body: Record<string, unknown> = {
    contents,
    ...(systemText.trim()
      ? { systemInstruction: { role: "system", parts: [{ text: sanitizeSurrogates(systemText) }] } }
      : {}),
    ...(tools.length > 0 ? { tools: upperTypes(convertTools(tools, true, false)) } : {}),
    labels: {
      cascade_id: session.conversationId,
      ...(session.lastExecutionId ? { last_execution_id: session.lastExecutionId } : {}),
      last_step_index: String(contents.length - 1),
      ...(modelEnum ? { model_enum: modelEnum } : {}),
      request_id: `${session.trajectoryId}-${session.requests - 1}`,
      root_cascade_id: session.conversationId,
      trajectory_id: session.trajectoryId,
      used_claude: "false",
      used_claude_conservative: "false",
      used_non_gemini_model: "false",
    },
    generationConfig,
    sessionId: NUMERIC_SESSION_ID,
  };
  return {
    wireModel: route.wireModel,
    requestId: `agent/${session.conversationId}/${timestamp}/${session.trajectoryId}/${contents.length}`,
    body,
  };
}

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
};

type Chunk = {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  responseId?: string;
  error?: { code?: number; status?: string; message?: string };
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
};

async function* sseChunks(response: Response): AsyncGenerator<Chunk> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frame = function* (text: string): Generator<Chunk> {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const inner = (parsed as { response?: unknown })?.response;
      yield (inner && typeof inner === "object" ? inner : parsed) as Chunk;
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        yield* frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* frame(buffer);
  } finally {
    reader.releaseLock();
  }
}

const finishReasonStop = (reason: string): "stop" | "length" | "error" =>
  reason === "STOP" ? "stop" : reason === "MAX_TOKENS" || reason === "CONTINUATION" ? "length" : "error";

/** Google's error body, as a sentence for the person reading the turn. */
export const describeAntigravityFailure = (status: number, body: string): string => {
  let message = body.trim().slice(0, 600);
  let reason: string | undefined;
  try {
    const error = (JSON.parse(body) as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } })
      .error;
    if (error?.message) message = error.message;
    reason = error?.details?.find((detail) => typeof detail.reason === "string")?.reason ?? error?.status;
  } catch {
    // Not JSON: keep the raw text.
  }
  if (status === 401) return "Your Google Antigravity sign-in has ended. Sign in again in Settings.";
  if (status === 403 && /TOS_VIOLATION/i.test(`${reason ?? ""} ${message}`)) {
    return `Google suspended Antigravity on this Google account (TOS_VIOLATION): ${message}`;
  }
  if (status === 403 || status === 404) return `Google Antigravity refused this model for your account: ${message}`;
  if (status === 429) return `Google Antigravity usage limit reached: ${message}`;
  return `Google Antigravity request failed (HTTP ${status}${reason ? `, ${reason}` : ""}): ${message}`;
};

const RETRYABLE = new Set([500, 502, 503, 504]);

async function send(
  request: AntigravityRequest,
  key: AntigravityKey,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const envelope = JSON.stringify({
    project: key.projectId,
    requestId: request.requestId,
    request: request.body,
    model: request.wireModel,
    userAgent: "antigravity",
    requestType: "agent",
  });
  const headers = {
    Authorization: `Bearer ${key.token}`,
    "Content-Type": "application/json",
    "User-Agent": antigravityUserAgent(),
    "Accept-Encoding": "gzip",
  };
  const override = process.env.STELLA_ANTIGRAVITY_ENDPOINT?.trim();
  const endpoints = override ? [override] : [antigravityEndpoint(), "https://cloudcode-pa.googleapis.com"];
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      const response = await agyFetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers,
        body: envelope,
        ...(signal ? { signal } : {}),
      });
      if (RETRYABLE.has(response.status) && endpoint !== endpoints.at(-1)) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Couldn't reach Google Antigravity.");
}

export function streamAntigravity(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  void (async () => {
    try {
      const key = decodeAntigravityKey(options?.apiKey);
      if (!key) throw new Error("Sign in to Google Antigravity in Settings to use this model.");
      let request = buildAntigravityRequest(model, context, options);
      const next = await options?.onPayload?.(request.body, model);
      if (next !== undefined && next && typeof next === "object") {
        request = { ...request, body: next as Record<string, unknown> };
      }
      const response = await send(request, key, options?.signal);
      await options?.onResponse?.(
        { status: response.status, headers: Object.fromEntries(response.headers.entries()) },
        model,
      );
      if (!response.ok) {
        throw new Error(describeAntigravityFailure(response.status, await response.text().catch(() => "")));
      }
      stream.push({ type: "start", partial: output });

      let current: TextContent | ThinkingContent | undefined;
      let pendingSignature: string | undefined;
      let finish: string | undefined;
      const index = () => output.content.length - 1;
      const close = () => {
        if (!current) return;
        if (current.type === "text") {
          stream.push({ type: "text_end", contentIndex: index(), content: current.text, partial: output });
        } else {
          stream.push({ type: "thinking_end", contentIndex: index(), content: current.thinking, partial: output });
        }
        current = undefined;
      };

      for await (const chunk of sseChunks(response)) {
        await options?.onProviderStreamEvent?.(chunk, model);
        if (chunk.error) {
          throw new Error(
            `Google Antigravity stream error${chunk.error.status ? ` (${chunk.error.status})` : ""}: ${chunk.error.message ?? ""}`,
          );
        }
        if (chunk.promptFeedback?.blockReason) {
          throw new Error(
            `Google Antigravity blocked the prompt (${chunk.promptFeedback.blockReason})${
              chunk.promptFeedback.blockReasonMessage ? `: ${chunk.promptFeedback.blockReasonMessage}` : ""
            }`,
          );
        }
        output.responseId ||= chunk.responseId;
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.thought && !part.text && part.thoughtSignature && !part.functionCall) {
            pendingSignature = part.thoughtSignature;
            continue;
          }
          if (part.text !== undefined && (part.text || part.thoughtSignature)) {
            const thinking = part.thought === true;
            if (!current || (thinking ? current.type !== "thinking" : current.type !== "text")) {
              close();
              current = thinking ? { type: "thinking", thinking: "" } : { type: "text", text: "" };
              output.content.push(current);
              stream.push({ type: thinking ? "thinking_start" : "text_start", contentIndex: index(), partial: output });
            }
            if (current.type === "thinking") {
              current.thinking += part.text;
              if (part.thoughtSignature) current.thinkingSignature = part.thoughtSignature;
              stream.push({ type: "thinking_delta", contentIndex: index(), delta: part.text, partial: output });
            } else {
              current.text += part.text;
              if (part.thoughtSignature) current.textSignature = part.thoughtSignature;
              stream.push({ type: "text_delta", contentIndex: index(), delta: part.text, partial: output });
            }
          }
          if (part.functionCall) {
            close();
            const signature = part.thoughtSignature ?? pendingSignature;
            pendingSignature = undefined;
            const given = part.functionCall.id;
            const id =
              given && !output.content.some((block) => block.type === "toolCall" && block.id === given)
                ? given
                : `${part.functionCall.name ?? "call"}_${randomUUID().slice(0, 8)}`;
            const call: ToolCall = {
              type: "toolCall",
              id,
              name: part.functionCall.name ?? "",
              arguments: (part.functionCall.args ?? {}) as ToolCall["arguments"],
              ...(signature ? { thoughtSignature: signature } : {}),
            };
            output.content.push(call);
            stream.push({ type: "toolcall_start", contentIndex: index(), partial: output });
            stream.push({
              type: "toolcall_delta",
              contentIndex: index(),
              delta: JSON.stringify(call.arguments),
              partial: output,
            });
            stream.push({ type: "toolcall_end", contentIndex: index(), toolCall: call, partial: output });
          }
        }
        if (candidate?.finishReason) finish = candidate.finishReason;
        const usage = chunk.usageMetadata;
        if (usage) {
          const cacheRead = usage.cachedContentTokenCount ?? 0;
          output.usage = {
            input: Math.max(0, (usage.promptTokenCount ?? 0) - cacheRead),
            output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            cacheRead,
            cacheWrite: 0,
            reasoning: usage.thoughtsTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
          calculateCost(model, output.usage);
        }
      }
      close();
      if (pendingSignature) {
        const thinking = [...output.content].reverse().find((block) => block.type === "thinking");
        if (thinking?.type === "thinking") thinking.thinkingSignature = pendingSignature;
      }
      if (options?.signal?.aborted) throw new Error("Request was aborted");
      if (!finish) throw new Error("Google Antigravity ended its answer without finishing.");
      output.rawStopReason = finish;
      const stop = finishReasonStop(finish);
      if (stop === "error") throw new Error(`Google Antigravity stopped with: ${finish}`);
      const reason =
        stop === "stop" && output.content.some((block) => block.type === "toolCall") ? "toolUse" : stop === "length" ? "length" : "stop";
      output.stopReason = reason;
      stream.push({ type: "done", reason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
}

export const antigravityStreams = {
  stream: (model: Model<Api>, context: TranscriptContext, options?: StreamOptions) =>
    streamAntigravity(model, context, options),
  streamSimple: (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) =>
    streamAntigravity(model, context, options),
};
