/**
 * The public origin of Stella sites (stellasites.app). It holds no logic and
 * no credentials: cloud-builder's `SitesHost` entrypoint decides what each
 * request may see (`workers/cloud-builder/src/slack/previews.ts`). Only sites
 * are served here, so a site can't reach stella.sh, an app origin, or
 * Stella's API with a visitor's cookies.
 */
export default {
  async fetch(request: Request, env: SitesHostBindings): Promise<Response> {
    if (new URL(request.url).pathname === "/__stella/healthz") return Response.json({ ok: true });
    try {
      return await env.SITES.fetch(request);
    } catch {
      return new Response("Site unavailable. Try again.", {
        status: 503,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<SitesHostBindings>;
