type ToolActivityStatus = "running" | "completed" | "error" | "canceled";

export type ToolStep = {
  id: string;
  toolName: string;
  status: ToolActivityStatus;
  args?: Record<string, string>;
  resultPreview?: string;
  textOffset?: number;
};
