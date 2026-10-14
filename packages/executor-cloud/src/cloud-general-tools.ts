const CLOUD_GENERAL_TOOLS = [
  "Bash",
  "write_stdin",
  "apply_patch",
  "web",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "ask_user",
  "request_secure_input",
  "code",
] as const;

export const cloudGeneralToolNames = (): readonly string[] =>
  CLOUD_GENERAL_TOOLS;
