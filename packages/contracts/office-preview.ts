import { hasFields, isString } from "./value-guards.js";

export type OfficePreviewStatus = "starting" | "ready" | "error" | "stopped";

export type OfficePreviewFormat = "docx" | "xlsx" | "pptx" | null;

export type OfficePreviewRef = {
  sessionId: string;
  title: string;
  sourcePath: string;
};

export type OfficePreviewSnapshot = {
  sessionId: string;
  title: string;
  sourcePath: string;
  format: OfficePreviewFormat;
  startedAt: number;
  updatedAt: number;
  status: OfficePreviewStatus;
  html: string;
  error?: string;
};

export const isOfficePreviewRef = (value: unknown): value is OfficePreviewRef =>
  hasFields(value, { sessionId: isString, title: isString, sourcePath: isString });
