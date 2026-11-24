export const CHAT_IMAGE_MAX_EDGE = 2576;
export const CHAT_IMAGE_MAX_BYTES = 1_100_000;
export const CHAT_IMAGE_PASSTHROUGH_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
