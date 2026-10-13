import { createContext } from "react";
export type DisplayFileSource = {
  key: string;
  read: (path: string, maxBytes?: number) => Promise<{
    bytes: Uint8Array; mimeType: string; truncated?: boolean;
  }>;
  /** A URL a `<video>` or `<audio>` can stream from, when the source has one. */
  mediaUrl?: () => Promise<string>;
  /**
   * The document's path in the owner's Drive, when it is a Drive file: a
   * canvas registers it so its relative assets load from that Drive folder.
   */
  drivePath?: string;
};
export const DisplayFileSourceContext = createContext<DisplayFileSource | null>(null);
