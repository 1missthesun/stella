import { createContext } from "react";
export type DisplayFileSource = {
  key: string;
  read: (path: string, maxBytes?: number) => Promise<{
    bytes: Uint8Array; mimeType: string; truncated?: boolean;
  }>;
  /** A URL a `<video>` or `<audio>` can stream from, when the source has one. */
  mediaUrl?: () => Promise<string>;
};
export const DisplayFileSourceContext = createContext<DisplayFileSource | null>(null);
