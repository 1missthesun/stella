import {
  USER_ASK_FIELD_TYPES,
  USER_ASK_MAX_FIELDS,
  USER_ASK_PRESETS,
  USER_ASK_URGENCY_NAMES,
} from "@stella/contracts/user-ask";
import {
  handleRequestSecureInput,
  handleUseSecureValue,
  type UserToolsConfig,
} from "../user.js";
import type { ToolDefinition } from "../types.js";

export type SecureInputOptions = {
  requestSecureInput?: UserToolsConfig["requestSecureInput"];
  useSecureValue?: UserToolsConfig["useSecureValue"];
  revealSecureValueForFill?: UserToolsConfig["revealSecureValueForFill"];
  fillSecureBrowserField?: UserToolsConfig["fillSecureBrowserField"];
};

export const createRequestSecureInputTool = (
  options: SecureInputOptions,
): ToolDefinition => ({
  name: "request_secure_input",
  label: "Ask for information securely",
  workingText: "Asking for details",
  replay: "unsafe",
  awaitsUser: true,
  description:
    "Ask the user for information through a secure card, describing exactly the fields you need this time. Non-sensitive fields (an address, a one-time code) come back as values you can read. Sensitive fields (passwords, card numbers) never reach you: you get a handle instead, which `use_secure_value` can type into a browser field, pass to a command, or store in the keychain. Ask for everything a task needs in one call; the user answers once. The result has `values` (readable fields) and `handles` (sensitive fields), both keyed by field id, and every sensitive field has its own handle: for a card, `handles.card_number` goes into the number box and `handles.card_cvc` into the CVC box, one `use_secure_value` call each. For the common cases pass `preset`: \"login\" (fields `username`, readable, and `password`) or \"card\" (fields `card_number`, `card_expiry`, `card_cvc`, `postal_code`, all sensitive); add `fields` to ask for more alongside a preset, or to relabel one of its fields by giving the same id. Mark each field sensitive yourself; the user can override it. The user may answer on another device and the value travels end-to-end encrypted to this one. Always say what the value is for with `service` (the site or service, e.g. GitHub) and `account` when you know it: values the user chooses to remember are saved on this computer under that label, and a later request for the same service and account returns the saved handle at once without asking, so call this tool whenever you need a login, even one the user gave before. If a saved value turns out wrong (the login fails), call again with `replace_saved: true` to ask once for the right one, which overwrites it. The user can add a short note when they provide or decline (e.g. \"read-only key\", \"expires Friday\", \"use the one in the keychain\"); it comes back as `userNote` next to the outcome and may change what you should do. Never print, echo, cat, grep or log a secret yourself, and that includes one a command creates (a CLI that prints a new token): send that output to a private file without displaying it, check it by length or prefix only, and pass the file to the command that needs it. Stella redacts values it knows about from tool output, but a secret it never collected is only caught by pattern.",
  promptSnippet:
    "Ask for information the user has to supply (`request_secure_input`) — all fields in one call (presets `login`, `card`); each sensitive field comes back as its own handle under its field id, never as a value",
  parameters: {
    type: "object",
    properties: {
      purpose: {
        type: "string",
        description:
          "One line on what you need and why, e.g. \"Sign in to the airline to change the seat\".",
      },
      detail: {
        type: "string",
        description: "Optional extra context shown under the purpose.",
      },
      service: {
        type: "string",
        description:
          'What the value is for: the site or service, e.g. "GitHub" or "github.com". Labels the saved value and finds it again next time.',
      },
      account: {
        type: "string",
        description:
          "The account on that service (username or email) when you know it. Picks the right saved value when there are several.",
      },
      replace_saved: {
        type: "boolean",
        description:
          "The saved value for this service and account was wrong (the login failed): ask the user once for the right one and overwrite the saved one.",
      },
      preset: {
        type: "string",
        enum: [...USER_ASK_PRESETS],
        description:
          'Ready-made fields: "login" gives `username` (readable) and `password` (handle); "card" gives `card_number`, `card_expiry`, `card_cvc` and `postal_code` (each its own handle). The cards show the right keyboards and autofill for them.',
      },
      fields: {
        type: "array",
        maxItems: USER_ASK_MAX_FIELDS,
        description:
          "Exactly the fields you need for this request (all of them in one call). Each answer comes back under its field id: `values.<id>` or `handles.<id>`. Optional with a preset.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Short stable id, unique in this request, that you read this field's value or handle back under (`values.<id>` / `handles.<id>`). Well-known ids such as card_number, card_expiry, card_cvc, postal_code, username, email and password get matching keyboards and autofill.",
            },
            label: { type: "string", description: "What to show above the input." },
            type: {
              type: "string",
              enum: [...USER_ASK_FIELD_TYPES],
              description:
                "text (ordinary), secret (masked), code (short one-time code), choice (pick from choices).",
            },
            sensitive: {
              type: "boolean",
              description:
                "True when you must never see the value. Defaults to true for secret fields.",
            },
            placeholder: { type: "string" },
            hint: { type: "string" },
            optional: { type: "boolean" },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                },
                required: ["id", "label"],
              },
            },
          },
          required: ["id", "label", "type"],
        },
      },
      urgency: {
        type: "string",
        enum: [...USER_ASK_URGENCY_NAMES],
        description:
          "How far this may escalate if unanswered. The user's ceiling, quiet hours, and rate limit always win.",
      },
    },
    required: ["purpose", "service"],
  },
  execute: (args, context, extras) =>
    handleRequestSecureInput(
      { requestSecureInput: options.requestSecureInput },
      args,
      context,
      extras?.signal,
    ),
});

export const createUseSecureValueTool = (
  options: SecureInputOptions,
): ToolDefinition => ({
  name: "use_secure_value",
  label: "Use a stored secret",
  workingText: "Using it",
  replay: "unsafe",
  description:
    "Use a sensitive value you hold a handle for, without ever seeing it. Each handle is one field's value: take it from the `handles` of a `request_secure_input` result by field id (`handles.password`, `handles.card_cvc`), and make one call per field. Types it into a browser field, substitutes it into one command, or stores it in the OS keychain. You get back confirmation that it was used, never the value. A command's output comes back with the value redacted, even when split across lines; never write a command meant to reveal or transform it (echo, base64, rev, writing it to a file you then read).",
  parameters: {
    type: "object",
    properties: {
      handle: {
        type: "string",
        description:
          "One field's handle from `request_secure_input` (fresh or reused from a saved value), e.g. its `handles.card_number`. Different fields have different handles; never reuse one field's handle for another field.",
      },
      into: {
        type: "object",
        description:
          'Where the value goes: {"kind":"browser_field","selector":"#password"} fills a field in the tab you are driving with the browser API (your current tab, or pass "tabId": tab.id and "backend": "in-app" or "external" for Chrome), {"kind":"command","command":"login --token {{secret}}"}, or {"kind":"keychain","service":"…","account":"…"}.',
        properties: {
          kind: {
            type: "string",
            enum: ["browser_field", "command", "keychain"],
          },
          selector: { type: "string" },
          tabId: { type: "string" },
          backend: { type: "string", enum: ["in-app", "external"] },
          command: { type: "string" },
          placeholder: {
            type: "string",
            description: "Token replaced by the secret. Defaults to {{secret}}.",
          },
          cwd: { type: "string" },
          service: { type: "string" },
          account: { type: "string" },
        },
        required: ["kind"],
      },
    },
    required: ["handle", "into"],
  },
  execute: (args, context) =>
    handleUseSecureValue(
      {
        useSecureValue: options.useSecureValue,
        ...(options.revealSecureValueForFill
          ? { revealSecureValueForFill: options.revealSecureValueForFill }
          : {}),
        ...(options.fillSecureBrowserField
          ? { fillSecureBrowserField: options.fillSecureBrowserField }
          : {}),
      },
      args,
      context,
    ),
});
