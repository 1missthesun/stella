import { makeSignature } from "better-auth/crypto";
import { bearerCredential } from "../../../shared/bearer.js";
import type { BetterAuthKeys } from "../secret-rotation.js";

const SIGNED_VALUE = /^([^.]+)\.([A-Za-z0-9+/]{43}=)$/u;

const decoded = (value: string): string => {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const sameSignature = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const resigned = async (value: string, keys: BetterAuthKeys): Promise<string | null> => {
  if (!keys.previous) return null;
  const match = SIGNED_VALUE.exec(decoded(value));
  if (!match) return null;
  const [, data, signature] = match as unknown as [string, string, string];
  const [current, previous] = await Promise.all([
    makeSignature(data, keys.current),
    makeSignature(data, keys.previous),
  ]);
  if (sameSignature(signature, current) || !sameSignature(signature, previous)) return null;
  return encodeURIComponent(`${data}.${current}`);
};

const resignCookies = async (header: string, keys: BetterAuthKeys): Promise<string | null> => {
  let changed = false;
  const parts = await Promise.all(
    header.split(";").map(async (part) => {
      const index = part.indexOf("=");
      if (index < 0) return part;
      const next = await resigned(part.slice(index + 1).trim(), keys);
      if (!next) return part;
      changed = true;
      return `${part.slice(0, index)}=${next}`;
    }),
  );
  return changed ? parts.join(";") : null;
};

export type ResignedAuthRequest = { request: Request; bearer: string | null };

export const resignLegacySessionCredentials = async (
  request: Request,
  keys: BetterAuthKeys,
): Promise<ResignedAuthRequest> => {
  if (!keys.previous) return { request, bearer: null };
  const authorization = request.headers.get("authorization");
  const presented = authorization ? bearerCredential(authorization) : null;
  const bearer = presented ? await resigned(presented, keys) : null;
  const cookieHeader = request.headers.get("cookie");
  const cookies = cookieHeader ? await resignCookies(cookieHeader, keys) : null;
  if (!bearer && !cookies) return { request, bearer: null };
  const headers = new Headers(request.headers);
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  if (cookies) headers.set("cookie", cookies);
  return { request: new Request(request, { headers }), bearer };
};

export const withMigratedBearer = (
  request: Request,
  response: Response,
  bearer: string | null,
): Response => {
  if (!bearer || !response.ok || response.headers.has("set-auth-token")) return response;
  if (new URL(request.url).pathname.endsWith("/sign-out")) return response;
  const headers = new Headers(response.headers);
  headers.set("set-auth-token", bearer);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
