/**
 * An image a conversation keeps in object storage instead of inline. The
 * block stays `{ type: "image", mimeType, data }`, with `data` holding this
 * reference rather than base64, so every store and protocol that carries image
 * blocks carries it unchanged. Only the cloud conversation that wrote it turns
 * it back into something a model reads: a signed URL in the request body, or
 * the bytes where a provider takes no URLs.
 *
 * The prefix is not base64 (`:` is outside both alphabets), so a reference can
 * never be mistaken for an image's bytes.
 */
export const IMAGE_REF_PREFIX = "stella-r2-image:";

export const isImageRef = (data: unknown): data is string =>
  typeof data === "string" && data.startsWith(IMAGE_REF_PREFIX);

export const imageRef = (key: string): string => `${IMAGE_REF_PREFIX}${key}`;

export const imageRefKey = (data: string): string => data.slice(IMAGE_REF_PREFIX.length);
