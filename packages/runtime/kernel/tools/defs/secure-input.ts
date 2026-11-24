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
    "Get a value only the user has (a login, card, one-time code, address). Stella looks in the user's saved values first: a login or card the user chose to remember comes back at once, with no card shown, when `service` names it (an exact name, a URL or subdomain of it, or the name with words around it all match; `account` picks one when several accounts are saved). Only when nothing saved answers does the user get a secure card, and when a saved value answers some fields the card asks only for the rest. So call this whenever you need a login, without asking anyone first and even if you don't know whether one is saved. `saved_only: true` only looks: it returns the saved value, or `not_saved` with `savedHere`, the names of everything saved (never values), and shows the user nothing. Describe exactly the fields you need, all in one call. Non-sensitive fields (an address, a one-time code) come back as values you can read. Sensitive fields (passwords, card numbers) never reach you: you get a handle instead, which `use_secure_value` can type into a browser field, pass to a command, or store in the keychain. A handle is not used up: you can fill it as many times as you need (a value the user didn't save works for you for 30 minutes, a saved one until it is removed), so never ask the user again for a value you still hold a handle for. The result has `values` (readable fields) and `handles` (sensitive fields), both keyed by field id, and every sensitive field has its own handle: for a card, `handles.card_number` goes into the number box and `handles.card_cvc` into the CVC box, one `use_secure_value` call each. For the common cases pass `preset`: \"login\" (fields `username`, readable, and `password`) or \"card\" (fields `card_number`, `card_expiry`, `card_cvc`, `postal_code`, all sensitive); add `fields` to ask for more alongside a preset, or to relabel one of its fields by giving the same id. Mark each field sensitive yourself; the user can override it. The user may answer on another device and the value travels end-to-end encrypted to this one. Values the user chooses to remember are saved under `service` and `account`, so name the site or service the way people say it (e.g. \"GitHub\", \"Bank of America\"). If a saved value turns out wrong (the login fails), call again with `replace_saved: true` to ask once for the right one, which overwrites it. The user can add a short note when they provide or decline (e.g. \"read-only key\", \"expires Friday\", \"use the one in the keychain\"); it comes back as `userNote` next to the outcome and may change what you should do. Never print, echo, cat, grep or log a secret yourself, and that includes one a command creates (a CLI that prints a new token): send that output to a private file without displaying it, check it by length or prefix only, and pass the file to the command that needs it. Stella redacts values it knows about from tool output, but a secret it never collected is only caught by pattern.",
  promptSnippet:
    "Get a login, card or other value only the user has (`request_secure_input`): a value they saved comes back without asking them, otherwise they get a secure card — all fields in one call (presets `login`, `card`); each sensitive field comes back as its own handle under its field id, never as a value",
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
          'What the value is for: the site or service, e.g. "GitHub" or "github.com". Finds a saved value for it, and labels the value if the user saves it.',
      },
      account: {
        type: "string",
        description:
          "The account on that service (username or email) when you know it. Picks the right saved value when there are several.",
      },
      saved_only: {
        type: "boolean",
        description:
          "Only look in the saved values: return the saved value, or `not_saved` with the names of what is saved, and never show the user a card.",
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

const USE_SECURE_VALUE_PARAMETERS = {
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
        'Where the value goes: {"kind":"browser_field","selector":"#otp"} fills one field in the tab you are driving with the browser API (your current tab, or pass "tabId": tab.id and "backend": "in-app" or "external" for Chrome); make the selector match exactly that field (an id, name or autocomplete attribute, or a snapshot ref). Add "mode":"move" to clear the value from wherever it already is on the page before filling, or "mode":"clear" to only clear it. Or {"kind":"command","command":"login --token {{secret}}"}, or {"kind":"keychain","service":"…","account":"…"}.',
      properties: {
        kind: {
          type: "string",
          enum: ["browser_field", "command", "keychain"],
        },
        selector: { type: "string" },
        mode: {
          type: "string",
          enum: ["fill", "move", "clear"],
          description:
            'Browser fields only. "fill" (default); "move" clears the value from every field on the page that holds it, then fills selector (to correct a wrong landing); "clear" only clears it.',
        },
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
};

export const createUseSecureValueTool = (
  options: SecureInputOptions,
): ToolDefinition => ({
  name: "use_secure_value",
  label: "Use a stored secret",
  workingText: "Using it",
  replay: "unsafe",
  description:
    "Use a sensitive value you hold a handle for, without ever seeing it. Each handle is one field's value: take it from the `handles` of a `request_secure_input` result by field id (`handles.password`, `handles.card_cvc`), and make one call per field. Types it into a browser field, substitutes it into one command, or stores it in the OS keychain. You get back where it went, never the value: a browser fill names the field the value is in now (its id, name, label, type). The handle stays usable, so if it landed in the wrong field, call again with a selector for the right field and `\"mode\":\"move\"`, which clears it from the wrong field first; a value that lands in a visible field other than the one your selector matched is cleared from there by itself. Never ask the user to re-enter a value because a fill went wrong. A command's output comes back with the value redacted, even when split across lines; never write a command meant to reveal or transform it (echo, base64, rev, writing it to a file you then read).",
  parameters: USE_SECURE_VALUE_PARAMETERS,
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

export const REQUEST_SECURE_INPUT_CLOUD_DESCRIPTION =
  "Get a value only the user has (a login, card, one-time code, address). You run in Stella's cloud, and Stella looks in the user's saved values first: when one of the user's computers that keeps their saved values is online, a login or card they chose to remember comes back at once, with no card shown, when `service` names it (an exact name, a URL or subdomain of it, or the name with words around it all match; `account` picks one when several accounts are saved). The computer seals it to a key that exists only in this task's own process; Stella's cloud never holds a key that opens it. Otherwise the user gets a secure card they can answer on any of their devices (a phone that holds the login fills it with one tap), sealed the same way. So call this whenever you need a login, without asking anyone first and even if you don't know whether one is saved. `saved_only: true` only looks: it returns the saved value, or `not_saved` with `savedHere` (the names of what is saved, never values) and `reason` (`no_computer` when no computer that keeps saved values is online), and shows the user nothing. Describe exactly the fields you need, all in one call. Non-sensitive fields (an address, a one-time code) come back as values you can read. Sensitive and masked fields (passwords, card numbers) never reach you: you get a handle instead, which `use_secure_value` can type into a field of your cloud browser or pass to a command. A handle is not used up: you can fill it as many times as you need for 30 minutes or until this turn ends, so never ask the user again for a value you still hold a handle for; after that, calling this again gets a saved value back without asking them. The result has `values` (readable fields) and `handles` (sensitive fields), both keyed by field id, and every sensitive field has its own handle: for a card, `handles.card_number` goes into the number box and `handles.card_cvc` into the CVC box, one `use_secure_value` call each. For the common cases pass `preset`: \"login\" (fields `username`, readable, and `password`) or \"card\" (fields `card_number`, `card_expiry`, `card_cvc`, `postal_code`, all sensitive); add `fields` to ask for more alongside a preset, or to relabel one of its fields by giving the same id. Mark each field sensitive yourself; the user can override it. Values the user chooses to remember are saved on their devices under `service` and `account`, so name the site or service the way people say it (e.g. \"GitHub\", \"Bank of America\"). If a saved value turns out wrong (the login fails), call again with `replace_saved: true` to ask once for the right one, which overwrites it. The user can add a short note when they provide or decline (e.g. \"read-only key\", \"expires Friday\"); it comes back as `userNote` next to the outcome and may change what you should do. Never print, echo, cat, grep or log a secret yourself, and that includes one a command creates (a CLI that prints a new token): send that output to a private file without displaying it, check it by length or prefix only, and pass the file to the command that needs it. Stella redacts values it knows about from tool output, but a secret it never collected is only caught by pattern.";

export const USE_SECURE_VALUE_CLOUD_DESCRIPTION =
  "Use a sensitive value you hold a handle for, without ever seeing it. Each handle is one field's value: take it from the `handles` of a `request_secure_input` result by field id (`handles.password`, `handles.card_cvc`), and make one call per field. Types it into a field of your cloud browser (the one `code`'s `browser` drives; open the page there first), or substitutes it into one command run in your workspace as your own shell's user. You get back where it went, never the value: a browser fill names the field the value is in now (its id, name, label, type). The handle stays usable (30 minutes, or until this turn ends), so if it landed in the wrong field, call again with a selector for the right field and `\"mode\":\"move\"`, which clears it from the wrong field first; a value that lands in a visible field other than the one your selector matched is cleared from there by itself. Never ask the user to re-enter a value because a fill went wrong. A command's output comes back with the value redacted, even when split across lines; never write a command meant to reveal or transform it (echo, base64, rev, writing it to a file you then read). A cloud task has no keychain: nothing it stores outlasts the turn.";

export const USE_SECURE_VALUE_CLOUD_PARAMETERS = {
  ...USE_SECURE_VALUE_PARAMETERS,
  properties: {
    ...USE_SECURE_VALUE_PARAMETERS.properties,
    into: {
      ...USE_SECURE_VALUE_PARAMETERS.properties.into,
      description:
        'Where the value goes: {"kind":"browser_field","selector":"#otp"} fills one field in your cloud browser\'s current tab (or pass "tabId" from browser.tabs()); make the selector match exactly that field (a CSS selector, text=/role= selector, or ref=eN from the latest observation). Add "mode":"move" to clear the value from wherever it already is on the page before filling, or "mode":"clear" to only clear it. Or {"kind":"command","command":"login --token {{secret}}"} (cwd defaults to your workspace).',
      properties: {
        kind: { type: "string", enum: ["browser_field", "command"] },
        selector: USE_SECURE_VALUE_PARAMETERS.properties.into.properties.selector,
        mode: USE_SECURE_VALUE_PARAMETERS.properties.into.properties.mode,
        tabId: USE_SECURE_VALUE_PARAMETERS.properties.into.properties.tabId,
        command: USE_SECURE_VALUE_PARAMETERS.properties.into.properties.command,
        placeholder: USE_SECURE_VALUE_PARAMETERS.properties.into.properties.placeholder,
        cwd: USE_SECURE_VALUE_PARAMETERS.properties.into.properties.cwd,
      },
    },
  },
};
