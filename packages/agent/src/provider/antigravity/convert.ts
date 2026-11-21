/**
 * Stella's messages as Gemini `contents`, the way the Antigravity CLI sends them.
 *
 * Adapted from pi-ai's `api/google-shared` `convertMessages` (MIT, Earendil Works). That module
 * imports the Google GenAI SDK at load time for two enum constants, which would put the whole SDK
 * (and google-auth-library with it, about 1 MB) into Electron's main bundle and every launch. This
 * copy uses only pi-ai's dependency-free helpers.
 */
import type { Api, Message, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { sanitizeSurrogates } from "@earendil-works/pi-ai/utils/sanitize-unicode";
import { collapseSystemMessages, withoutInitialSystemMessage } from "@earendil-works/pi-ai/utils/transcript";

export type Part = Record<string, unknown>;
export type Content = { role: string; parts: Part[] };

// Thought signatures go back to Google as bytes, so only well-formed base64 from this same model is kept.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const keepSignature = (sameModel: boolean, signature: string | undefined) =>
  sameModel && signature && signature.length % 4 === 0 && BASE64.test(signature) ? signature : undefined;

// Every Antigravity model is Gemini 3 or later: tool calls carry ids, and tool results can hold images.
const normalizeToolCallId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

export function toGeminiContents(model: Model<Api>, context: TranscriptContext): Content[] {
  const conversation = withoutInitialSystemMessage(collapseSystemMessages(context).messages) as Message[];
  const contents: Content[] = [];
  for (const message of transformMessages(conversation, model, normalizeToolCallId)) {
    if (message.role === "user") {
      const parts: Part[] =
        typeof message.content === "string"
          ? [{ text: sanitizeSurrogates(message.content) }]
          : message.content.map((item) =>
              item.type === "text"
                ? { text: sanitizeSurrogates(item.text) }
                : { inlineData: { mimeType: item.mimeType, data: item.data } },
            );
      if (parts.length > 0) contents.push({ role: "user", parts });
      continue;
    }

    if (message.role === "assistant") {
      const sameModel = message.provider === model.provider && message.model === model.id;
      const parts: Part[] = [];
      for (const block of message.content) {
        if (block.type === "text") {
          const thoughtSignature = keepSignature(sameModel, block.textSignature);
          // An empty part still matters when it carries the signature Gemini expects back.
          if (!block.text?.trim() && !thoughtSignature) continue;
          parts.push({ text: sanitizeSurrogates(block.text), ...(thoughtSignature ? { thoughtSignature } : {}) });
        } else if (block.type === "thinking") {
          if (sameModel) {
            const thoughtSignature = keepSignature(sameModel, block.thinkingSignature);
            if (!block.thinking?.trim() && !thoughtSignature) continue;
            parts.push({
              thought: true,
              text: sanitizeSurrogates(block.thinking),
              ...(thoughtSignature ? { thoughtSignature } : {}),
            });
          } else if (block.thinking?.trim()) {
            // Another model's reasoning goes back as plain text: its signature means nothing here.
            parts.push({ text: sanitizeSurrogates(block.thinking) });
          }
        } else if (block.type === "toolCall") {
          const thoughtSignature = keepSignature(sameModel, block.thoughtSignature);
          parts.push({
            functionCall: { name: block.name, args: block.arguments ?? {}, id: block.id },
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    if (message.role === "toolResult") {
      const text = message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      const images = model.input.includes("image") ? message.content.filter((item) => item.type === "image") : [];
      const value = text.trim() ? sanitizeSurrogates(text) : images.length > 0 ? "(see attached image)" : "";
      const part: Part = {
        functionResponse: {
          name: message.toolName,
          response: message.isError ? { error: value } : { output: value },
          ...(images.length > 0
            ? { parts: images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })) }
            : {}),
          id: message.toolCallId,
        },
      };
      // Cloud Code wants every function response of a turn in one user message.
      const last = contents.at(-1);
      if (last?.role === "user" && last.parts.some((existing) => "functionResponse" in existing)) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  return contents;
}
