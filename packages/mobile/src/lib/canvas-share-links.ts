import { parseCanvasShareSlug } from "@stella/contracts/canvas-share";
import { env } from "../config/env";
import { getBackendClient } from "./backend";

/**
 * The URL to open for a canvas link. A private canvas opens only for its
 * owner, so for one of the caller's own links this is the backend's view URL
 * (`shares.viewLink`, carrying a short grant the share domain trades for its
 * view cookie). Any other URL, or a link that isn't the caller's, comes back
 * as given.
 */
export async function canvasShareOpenUrl(url: string): Promise<string> {
  const slug = parseCanvasShareSlug(url, env.canvasShareBaseUrl);
  if (!slug || !env.backendUrl) return url;
  try {
    return (await getBackendClient().call("shares.viewLink", { slug })).url;
  } catch {
    return url;
  }
}
