export const EXEC_COMMAND_TOOL_NAME = "Bash";
export const LEGACY_EXEC_COMMAND_TOOL_NAME = "exec_command";

export const EXEC_COMMAND_TOOL_DESCRIPTION =
  "Run a shell command and return its output. A command still running at timeout_ms keeps running, and the result carries a session_id for write_stdin. Node.js and Stella CLIs (stella-browser, stella-office, stella-computer, stella-media, stella-x-api) are on PATH.";


export const EXEC_COMMAND_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    cmd: { type: "string", description: "Shell command to execute." },
    workdir: {
      type: "string",
      description:
        "Optional working directory to run the command in; defaults to the turn cwd.",
    },
    shell: {
      type: "string",
      description:
        "Shell binary. Defaults to the user's login shell on macOS/Linux; on Windows pwsh, then Windows PowerShell, then cmd.exe.",
    },
    tty: {
      type: "boolean",
      description:
        "True gives the command a real terminal (PTY, or ConPTY on Windows) for programs that need one; default is pipes.",
    },
    timeout_ms: {
      type: "number",
      description:
        "How long to wait for the command to exit, in ms. Defaults to 120000; maximum 600000. Raise it for long builds instead of polling.",
    },
    run_in_background: {
      type: "boolean",
      description:
        "True returns at once with a session_id, for servers, watchers and jobs you don't need to wait on.",
    },
    max_output_tokens: {
      type: "integer",
      minimum: 0,
      description:
        "Output token budget. Defaults to 10000 tokens; larger requests may be capped by the active model policy.",
    },
    login: {
      type: "boolean",
      description:
        "On Unix, true invokes the shell with -lc and false with -c. Defaults to true.",
    },
  },
  required: ["cmd"],
};

export const EXEC_COMMAND_TOOL_REPLAY = "unsafe" as const;
