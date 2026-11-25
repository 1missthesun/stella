export const WRITE_STDIN_TOOL_NAME = "write_stdin";

export const WRITE_STDIN_TOOL_DESCRIPTION =
  "Interact with a still-running Bash session of yours: send input, wait for more output, or stop it.";


export const WRITE_STDIN_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    session_id: {
      type: "string",
      description:
        "The session_id Bash returned.",
    },
    chars: {
      type: "string",
      description:
        "Bytes to write to stdin. May be empty to poll for more output without sending input.",
    },
    write_id: {
      type: "string",
      description:
        "Optional idempotency key: retrying the same id with the same chars doesn't send them twice.",
    },
    operation: {
      type: "string",
      enum: ["write", "poll", "terminate", "close_stdin", "resize"],
      description:
        "Explicit interaction. Defaults to write for nonempty chars and poll otherwise. close_stdin supports pipe sessions; resize supports PTY sessions.",
    },
    cols: {
      type: "integer",
      minimum: 1,
      maximum: 1000,
      description: "PTY columns for operation=resize.",
    },
    rows: {
      type: "integer",
      minimum: 1,
      maximum: 1000,
      description: "PTY rows for operation=resize.",
    },
    yield_time_ms: {
      type: "number",
      description:
        "Maximum wait. A write defaults to 250 ms and caps at 30000; an empty poll defaults to 30000 and caps at 600000. Polls return on the first new output/activity, and all calls return early when the process exits.",
    },
    max_output_tokens: {
      type: "integer",
      minimum: 0,
      description:
        "Output token budget. Defaults to 10000 tokens; larger requests may be capped by the active model policy.",
    },
  },
  required: ["session_id"],
};

export const WRITE_STDIN_TOOL_REPLAY = "unsafe" as const;
