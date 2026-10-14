import { parseCanvasShareSlug } from "@stella/contracts/canvas-share";
import { env } from "../config/env";
import { getBackendClient } from "./backend";

export async function canvasShareOpenUrl(url: string): Promise<string> {
  const slug = parseCanvasShareSlug(url, env.canvasShareBaseUrl);
  if (!slug || !env.backendUrl) return url;
  try {
    return (await getBackendClient().call("shares.viewLink", { slug })).url;
  } catch {
    return url;
  }
}
