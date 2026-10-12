type ToolActivityStatus = "running" | "completed" | "error" | "canceled";

/** A settled tool call carried on an assistant chat row. */
export type ToolStep = {
  id: string;
  toolName: string;
  status: ToolActivityStatus;
  /** Pruned string args. */
  args?: Record<string, string>;
  /**
   * Bounded tool-result preview, carried only for tools whose result the UI
   * renders directly (Schedule receipts). Never the raw unbounded result.
   */
  resultPreview?: string;
  /** Immutable chronology metadata captured when chat observed the call. */
  textOffset?: number;
};
