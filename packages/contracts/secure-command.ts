/**
 * Running a command with a secure value in it, without the value ever being
 * part of the command text: `{{secret}}` becomes a reference to an
 * environment variable the runner sets only for that one process, quoted so
 * the value expands as exactly one word wherever the marker stands.
 */

export const SECURE_COMMAND_PLACEHOLDER = "{{secret}}";

/** The variable a runner sets to the value for the one command it runs. */
export const SECURE_COMMAND_VALUE_ENV = "STELLA_SECURE_VALUE";

const POSIX_REFERENCE = {
  unquoted: `"$${SECURE_COMMAND_VALUE_ENV}"`,
  double: `$${SECURE_COMMAND_VALUE_ENV}`,
  single: `'"$${SECURE_COMMAND_VALUE_ENV}"'`,
} as const;

export type ResolvedSecureCommand =
  | Readonly<{ ok: true; command: string }>
  | Readonly<{ ok: false; error: string }>;

/** A POSIX shell command with every marker replaced by a quoted reference to the variable. */
export const resolveSecureCommand = (
  command: string,
  placeholder?: string,
): ResolvedSecureCommand => {
  const marker = placeholder || SECURE_COMMAND_PLACEHOLDER;
  if (!command.includes(marker)) {
    return {
      ok: false,
      error: `The command has no ${marker} where the value should go.`,
    };
  }
  let state: keyof typeof POSIX_REFERENCE = "unquoted";
  let output = "";
  let index = 0;
  while (index < command.length) {
    if (command.startsWith(marker, index)) {
      output += POSIX_REFERENCE[state];
      index += marker.length;
      continue;
    }
    const character = command[index]!;
    if (state !== "single" && character === "\\" && index + 1 < command.length) {
      output += character + command[index + 1];
      index += 2;
      continue;
    }
    if (state === "unquoted" && character === "'") state = "single";
    else if (state === "single" && character === "'") state = "unquoted";
    else if (state === "unquoted" && character === '"') state = "double";
    else if (state === "double" && character === '"') state = "unquoted";
    output += character;
    index += 1;
  }
  if (state !== "unquoted") {
    return {
      ok: false,
      error: `That command's ${state} quotes are unbalanced, so ${marker} could not be placed where it would expand. Fix the quoting, or leave ${marker} outside quotes.`,
    };
  }
  return { ok: true, command: output };
};
