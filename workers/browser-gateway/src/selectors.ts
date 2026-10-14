import { GatewayError } from "./errors.js";

const REF_SELECTOR = /^ref=(e[1-9][0-9]{0,3})$/u;
const MAX_SELECTOR_LENGTH = 4_096;

export const parseAgentSelector = (
  value: unknown,
  options: Readonly<{ allowRef: boolean }>,
): string => {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > MAX_SELECTOR_LENGTH ||
    value.includes("\u0000")
  ) {
    throw new GatewayError("bad_request", 400);
  }
  if (value.startsWith("ref=")) {
    if (!options.allowRef || !REF_SELECTOR.test(value)) {
      throw new GatewayError("bad_request", 400);
    }
  }
  return value;
};

export const ELEMENT_REF_ATTRIBUTE = "data-stella-ref";

export const toPlaywrightSelector = (selector: string): string => {
  const ref = REF_SELECTOR.exec(selector);
  return ref ? `[${ELEMENT_REF_ATTRIBUTE}="${ref[1]}"]` : selector;
};

export const exactRoleSelector = (role: string, name: string): string =>
  `internal:role=${role}[name=${JSON.stringify(name)}s]`;
