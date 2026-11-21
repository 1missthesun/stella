/**
 * Who a Stella session token belongs to, as a stable key: the backend's token
 * identifier, else the issuer and subject. Records and caches keyed by owner
 * use it so one account's data never shows under another.
 */
export const resolveJwtOwnerScope = (
  token: string | null | undefined,
): string | null => {
  const normalized = token?.trim();
  if (!normalized) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(normalized.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const tokenIdentifier =
      typeof payload.tokenIdentifier === "string"
        ? payload.tokenIdentifier.trim()
        : "";
    if (tokenIdentifier) {
      return `token:${JSON.stringify(tokenIdentifier)}`;
    }
    const issuer = typeof payload.iss === "string" ? payload.iss.trim() : "";
    const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!issuer || !subject) return null;
    return `subject:${JSON.stringify([issuer, subject])}`;
  } catch {
    return null;
  }
};
