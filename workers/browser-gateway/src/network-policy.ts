import { getDomain } from "tldts";
import { GatewayError } from "./errors.js";

export const browserGuardrailDomains = (
  allowedOrigins: readonly string[],
): readonly string[] => {
  const domains = new Set<string>();
  for (const origin of allowedOrigins) {
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      throw new GatewayError("navigation_denied", 403);
    }
    // Include the PSL private section so one tenant cannot gain egress to
    // sibling tenants on github.io, vercel.app, blogspot.com, and peers.
    const registrable = getDomain(hostname, { allowPrivateDomains: true });
    if (!registrable) {
      throw new GatewayError("navigation_denied", 403);
    }
    domains.add(registrable);
    domains.add(`*.${registrable}`);
  }
  return [...domains].sort();
};
