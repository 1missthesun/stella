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
    "Get a value only the user has (a login, card, one-time code, address), without asking anyone first. Saved values come first: a login or card the user chose to remember comes back at once, with no card shown, when `service` names it; otherwise the user gets a secure card asking only for what nothing saved answers, which they can answer on any device. Ask for every field you need in one call. Readable fields come back in `values`; sensitive ones (passwords, card numbers) never reach you: each comes back as its own handle in `handles` under its field id, for `use_secure_value`. A handle can be used again and again (an unsaved value for 30 minutes, a saved one until it is removed), so never ask twice for a value you hold a handle for. The user may add a note (`userNote`, e.g. \"read-only key\") that can change what you should do.",
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
          'The site or service as people name it, e.g. "GitHub" or "Bank of America". A saved value matches on an exact name, a URL or subdomain of it, or the name with words around it; a value the user saves is labelled with it.',
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
          "The fields you need, all in one call. Optional with a preset; add fields to ask for more, or give a preset field's id to relabel it.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Unique in this request; the answer comes back under it. Well-known ids (card_number, card_expiry, card_cvc, postal_code, username, email, password) get matching keyboards and autofill.",
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
                "True when you must never see the value (the user can override it). Defaults to true for secret fields.",
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
        "One field's handle from `request_secure_input`, e.g. its `handles.card_number`; each field has its own.",
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
    "Use a sensitive value you hold a handle for without ever seeing it, one call per field's handle: type it into a browser field, substitute it into one command, or store it in the OS keychain. You get back where it went, never the value: a browser fill names the field the value is now in. If it landed in the wrong field, call again with the right selector and `\"mode\":\"move\"` rather than asking the user again; a value that lands in a visible field other than the one your selector matched is cleared from there by itself. A command's output comes back with the value redacted; never write a command meant to reveal or transform it (echo, base64, writing it to a file you then read).",
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
  "Get a value only the user has (a login, card, one-time code, address), without asking anyone first. Saved values come first: while one of the user's computers that keeps their saved values is online, a login or card they chose to remember comes back at once, with no card shown, when `service` names it; that computer seals it to a key only this task's process has, so Stella's cloud can never open it. Otherwise the user gets a secure card, sealed the same way, that they can answer on any device (a phone holding the login fills it with one tap). Ask for every field you need in one call. Readable fields come back in `values`; sensitive and masked ones (passwords, card numbers) never reach you: each comes back as its own handle in `handles` under its field id, for `use_secure_value`. A handle lasts 30 minutes or until this turn ends, so never ask twice for a value you hold a handle for; after that, calling again returns a saved value without asking. `saved_only` reports `reason: no_computer` when no such computer is online. The user may add a note (`userNote`, e.g. \"read-only key\") that can change what you should do.";

export const USE_SECURE_VALUE_CLOUD_DESCRIPTION =
  "Use a sensitive value you hold a handle for without ever seeing it, one call per field's handle: type it into a field of your cloud browser (the one `code`'s `browser` drives; open the page there first), or substitute it into one command run in your workspace as your shell's user. You get back where it went, never the value: a browser fill names the field the value is now in. If it landed in the wrong field, call again with the right selector and `\"mode\":\"move\"` rather than asking the user again; a value that lands in a visible field other than the one your selector matched is cleared from there by itself. A command's output comes back with the value redacted; never write a command meant to reveal or transform it (echo, base64, writing it to a file you then read). A cloud task has no keychain: nothing it stores outlasts the turn.";

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
