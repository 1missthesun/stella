import { GenerationTask, hook } from "@earendil-works/pi-durable";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";

/**
 * Bounds the inline image bytes a conversation carries. A model bills an image
 * by its pixels (an OpenAI tile set is ~765 tokens), but the request carries
 * its base64: a ~1.5MB photo per Read. Token-based compaction never trims a
 * context of images, so twenty of them put ~30MB in every request, held at
 * once as stored entries, messages, the JSON body and its bytes. In a Durable
 * Object's 128MB that ends the isolate mid-request, on every retry.
 */

export const OMITTED_IMAGE_NOTE =
  "[Image omitted from this request to keep it small: only the most recent images are sent. Read the file again if you need to see it.]";

const blocksOf = (message: Message): readonly (TextContent | ImageContent)[] | null =>
  message.role === "assistant" || typeof message.content === "string"
    ? null
    : (message.content as readonly (TextContent | ImageContent)[]);

/** Base64 characters of every inline image in `messages`. */
export const inlineImageBytes = (messages: readonly Message[]): { bytes: number; images: number } => {
  let bytes = 0;
  let images = 0;
  for (const message of messages) {
    for (const block of blocksOf(message) ?? []) {
      if (block.type !== "image") continue;
      bytes += block.data.length;
      images += 1;
    }
  }
  return { bytes, images };
};

/**
 * `messages` with the oldest images replaced by a note until the rest fit
 * `maxBytes`. The cut moves in steps of half the budget, so the request's
 * prefix (and the provider's prompt cache) changes once per half-budget of new
 * images, not on every image. The same array comes back when nothing changed.
 */
export const withImageBudget = <M extends Message>(messages: readonly M[], maxBytes: number): readonly M[] => {
  const { bytes } = inlineImageBytes(messages);
  if (bytes <= maxBytes) return messages;
  const step = Math.max(1, Math.floor(maxBytes / 2));
  const cut = (Math.floor((bytes - maxBytes) / step) + 1) * step;
  let seen = 0;
  let changed = false;
  const next = messages.map((message) => {
    const blocks = blocksOf(message);
    if (!blocks || seen >= cut) return message;
    let replaced: (TextContent | ImageContent)[] | undefined;
    blocks.forEach((block, index) => {
      if (block.type !== "image" || seen >= cut) return;
      seen += block.data.length;
      replaced ??= [...blocks];
      replaced[index] = { type: "text", text: OMITTED_IMAGE_NOTE };
    });
    if (!replaced) return message;
    changed = true;
    return { ...message, content: replaced } as M;
  });
  return changed ? next : messages;
};

/** Runs before the other request hooks so images it drops are never decoded or checked. */
export const imageBudgetHook = (maxBytes: number) =>
  hook(GenerationTask, {
    beforeRequest: (request) => {
      const messages = withImageBudget(request.messages, maxBytes);
      return messages === request.messages ? undefined : { messages };
    },
  });
