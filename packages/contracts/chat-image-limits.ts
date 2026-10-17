/**
 * What a chat client fits an attached image to before uploading it, so the
 * cloud sends it to the model as it is: the long edge and byte budget of the
 * cloud's own fit (`DURABLE_OBJECT_READ_IMAGE_CAPS`: 2576px, 1.5MB of base64),
 * with a little room under the byte budget.
 */
export const CHAT_IMAGE_MAX_EDGE = 2576;
export const CHAT_IMAGE_MAX_BYTES = 1_100_000;
/** Types every model provider takes as they are; anything else is re-encoded. */
export const CHAT_IMAGE_PASSTHROUGH_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
