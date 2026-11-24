/**
 * Running a command with a secure value in it, without the value ever being
 * part of the command text: `{{secret}}` becomes a reference to an
 * environment variable the runner sets only for that one process, quoted so
 * the value expands as exactly one word wherever the marker stands.
 */

export const SECURE_COMMAND_PLACEHOLDER = "{{secret}}";

/** The variable a runner sets to the value for the one command it runs. */
export const SECURE_COMMAND_VALUE_ENV = "STELLA_SECURE_VALUE";

type QuoteState = "unquoted" | "double" | "single";

const POSIX_REFERENCE: Record<QuoteState, string> = {
  unquoted: `"$${SECURE_COMMAND_VALUE_ENV}"`,
  double: `$${SECURE_COMMAND_VALUE_ENV}`,
  single: `'"$${SECURE_COMMAND_VALUE_ENV}"'`,
};

/**
 * Where the reader is in the command: plain text, inside quotes, or inside a
 * command substitution (`$( … )`, a bracket within one, or backticks), which
 * starts its own quoting even when it sits inside double quotes.
 */
type Context = "unquoted" | "double" | "single" | "substitution" | "paren" | "backtick";

const quoteStateOf = (context: Context): QuoteState =>
  context === "double" || context === "single" ? context : "unquoted";

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
  const stack: Context[] = ["unquoted"];
  const top = (): Context => stack[stack.length - 1]!;
  let output = "";
  let index = 0;
  while (index < command.length) {
    const context = top();
    if (command.startsWith(marker, index)) {
      output += POSIX_REFERENCE[quoteStateOf(context)];
      index += marker.length;
      continue;
    }
    const character = command[index]!;
    if (context !== "single" && character === "\\" && index + 1 < command.length) {
      output += character + command[index + 1];
      index += 2;
      continue;
    }
    if (context === "single") {
      if (character === "'") stack.pop();
    } else if (character === "$" && command[index + 1] === "(") {
      stack.push("substitution");
      output += "$(";
      index += 2;
      continue;
    } else if (character === "`") {
      if (context === "backtick") stack.pop();
      else stack.push("backtick");
    } else if (context === "double") {
      if (character === '"') stack.pop();
    } else if (character === "'") {
      stack.push("single");
    } else if (character === '"') {
      stack.push("double");
    } else if (character === "(" && context !== "unquoted") {
      stack.push("paren");
    } else if (character === ")" && (context === "substitution" || context === "paren")) {
      stack.pop();
    }
    output += character;
    index += 1;
  }
  if (stack.length !== 1) {
    const open = top();
    const what =
      open === "single" || open === "double"
        ? `${open} quotes are unbalanced`
        : open === "backtick"
          ? "backticks are unbalanced"
          : "brackets are unbalanced";
    return {
      ok: false,
      error: `That command's ${what}, so ${marker} could not be placed where it would expand. Fix the quoting, or leave ${marker} outside quotes.`,
    };
  }
  return { ok: true, command: output };
};
