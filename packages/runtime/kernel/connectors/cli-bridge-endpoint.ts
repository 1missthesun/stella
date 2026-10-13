import { timingSafeEqual } from "node:crypto";

export type CliBridgeEndpoint = {
  path: string;
  token?: string;
};

const TOKEN_SEPARATOR = "#";
const MIN_TOKEN_LENGTH = 22;

const isNamedPipe = (value: string): boolean =>
  /^\\\\[.?]\\pipe\\/i.test(value);

export const formatCliBridgeEndpoint = (endpoint: CliBridgeEndpoint): string =>
  endpoint.token ? `${endpoint.path}${TOKEN_SEPARATOR}${endpoint.token}` : endpoint.path;

export const parseCliBridgeEndpoint = (endpoint: string): CliBridgeEndpoint => {
  const value = endpoint.trim();
  if (!isNamedPipe(value)) return { path: value };
  const separator = value.lastIndexOf(TOKEN_SEPARATOR);
  if (separator < 0) return { path: value };
  const token = value.slice(separator + 1);
  return {
    path: value.slice(0, separator),
    ...(token ? { token } : {}),
  };
};

export const cliBridgeEndpointNeedsToken = (endpoint: CliBridgeEndpoint): boolean =>
  isNamedPipe(endpoint.path);

export const isUsableCliBridgeToken = (token: string | undefined): token is string =>
  typeof token === "string" &&
  token.length >= MIN_TOKEN_LENGTH &&
  /^[A-Za-z0-9_-]+$/u.test(token);

export const cliBridgeTokenMatches = (
  expected: string,
  presented: unknown,
): boolean => {
  if (typeof presented !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};
