import { NextResponse } from "next/server";
import { MAPS_RESOLVE_PATH } from "@stella/contracts/map-artifact";
import { readBackendUrl } from "@/lib/backend-url";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const BACKEND_TIMEOUT_MS = 60_000;

// Released desktops still call this route. Map lookups cost Google money, so
// it only forwards signed-in callers to the backend's resolver, which charges
// the owner's budget; it never calls Google itself.
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return NextResponse.json({ error: "Sign in to Stella to resolve maps." }, { status: 401 });
  }
  const backend = readBackendUrl();
  if (!backend) {
    return NextResponse.json({ error: "Maps resolution is not configured on this server." }, { status: 503 });
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "The map request is too large." }, { status: 413 });
  }
  try {
    const response = await fetch(`${backend}${MAPS_RESOLVE_PATH}`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Map resolution failed: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
