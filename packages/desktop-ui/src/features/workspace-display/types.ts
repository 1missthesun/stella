import type { ReactNode } from "react";
import type { DisplayTabPayload } from "@stella/contracts/desktop/display-payload";

export type DisplayTabKind =
  | "home"
  | "chat"
  | "canvas"
  | "url"
  | "markdown"
  | "source-diff"
  | "media"
  | "image"
  | "pdf"
  | "office-document"
  | "office-spreadsheet"
  | "office-slides"
  | "video"
  | "audio"
  | "model3d"
  | "download"
  | "text"
  | "folder"
  | "trash";

export type DisplayTabSpec = {
  id: string;
  kind: DisplayTabKind;
  title: string;
  tooltip?: string;
  render: () => ReactNode;
  metadata?: Record<string, unknown>;
  payload?: DisplayTabPayload;
};

export type DisplayTab = DisplayTabSpec & {
  ord: number;
};

export type OpenTabOptions = {
  activate?: boolean;
  openPanel?: boolean;
};
