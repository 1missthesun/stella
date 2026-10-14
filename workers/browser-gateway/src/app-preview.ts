import type { BrowserGatewayEnv } from "./profile-session-core.js";
import { GatewayError } from "./errors.js";
import { withTimedBrowser } from "./timed-browser.js";

const VIEWPORT = { width: 1280, height: 800 };
const NAVIGATION_TIMEOUT_MS = 20_000;
const SETTLE_MS = 900;

const previewUrl = (body: unknown): string => {
  const value =
    body && typeof body === "object" ? (body as { url?: unknown }).url : null;
  if (typeof value !== "string" || value.length > 4096)
    throw new GatewayError("bad_request", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatewayError("bad_request", 400);
  }
  if (url.protocol !== "https:" || !url.pathname.startsWith("/workspace-apps/"))
    throw new GatewayError("bad_request", 400);
  return url.toString();
};

export async function captureAppPreview(
  env: BrowserGatewayEnv,
  body: unknown,
): Promise<Response> {
  const url = previewUrl(body);
  return await withTimedBrowser(env, 10_000, async (browser) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page
      .goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS })
      .catch(() => undefined);
    await page.waitForTimeout(SETTLE_MS);
    const image = await page.screenshot({ type: "jpeg", quality: 72 });
    return new Response(new Uint8Array(image), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
      },
    });
  });
}
