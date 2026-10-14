import type {
  ImageContent,
  Message,
  TextContent,
} from "@earendil-works/pi-ai";
import type { Static, TSchema } from "@sinclair/typebox";
import type { StoredImageContent } from "../storage/shared.js";

export interface CustomAgentMessages {
  runtimeInternal?: {
    role: "runtimeInternal";
    content: string | (TextContent | ImageContent)[];
    timestamp: number;
    customType?: string;
    eventId?: string;
    display?: boolean;
  };
  __customAgentMessagesBrand?: never;
}

export type AgentMessage =
  | Message
  | NonNullable<CustomAgentMessages[keyof CustomAgentMessages]>;

export interface AgentToolResult<T> {
  content: (TextContent | StoredImageContent)[];
  details: T;
  isError?: boolean;
  modelOutputTokens?: number;
}

export type AgentToolUpdateCallback<T = unknown> = (
  partialResult: AgentToolResult<T>,
) => void;

export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> {
  name: string;
  description: string;
  parameters: TParameters;
  label: string;
  workingText?: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}
