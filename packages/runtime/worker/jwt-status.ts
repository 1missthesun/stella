export const jwtStatus = (
  token: string,
  now = Date.now(),
): "opaque" | "valid" | "expired" | "malformed" => {
  const parts = token.split(".");
  if (parts.length !== 3) return "opaque";
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return "malformed";
    }
    return payload.exp * 1000 <= now + 30_000 ? "expired" : "valid";
  } catch {
    return "malformed";
  }
};
