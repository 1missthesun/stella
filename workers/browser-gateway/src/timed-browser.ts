import { launch } from "@cloudflare/playwright";
import { GatewayError, publicErrorResponse } from "./errors.js";
import type { BrowserGatewayEnv } from "./profile-session-core.js";

type Browser = Awaited<ReturnType<typeof launch>>;

// Lifetime of the capture browser, launch to close, for the caller to bill.
export const BROWSER_MS_HEADER = "x-stella-browser-ms";

export const withTimedBrowser = async (
  env: BrowserGatewayEnv,
  keepAliveMs: number,
  work: (browser: Browser) => Promise<Response>,
): Promise<Response> => {
  const startedAt = Date.now();
  const browser = await launch(env.BROWSER, { keep_alive: keepAliveMs }).catch(() => {
    throw new GatewayError("browser_unavailable", 503);
  });
  let response: Response;
  try {
    response = await work(browser);
  } catch (error) {
    response = publicErrorResponse(error);
  } finally {
    await browser.close().catch(() => undefined);
  }
  response.headers.set(BROWSER_MS_HEADER, String(Date.now() - startedAt));
  return response;
};
