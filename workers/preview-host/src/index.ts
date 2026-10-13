/**
 * The public origin of Stella previews for Slack. It holds no logic and no
 * credentials: cloud-builder's `SlackPreviewHost` entrypoint decides what
 * each request may see (`workers/cloud-builder/src/slack/previews.ts`).
 * Only previews are served here, so a site can't reach stella.sh, an app
 * origin, or Stella's API with a visitor's cookies.
 */
export default {
  async fetch(request: Request, env: PreviewHostBindings): Promise<Response> {
    if (new URL(request.url).pathname === "/__stella/healthz") return Response.json({ ok: true });
    try {
      return await env.PREVIEWS.fetch(request);
    } catch {
      return new Response("Preview unavailable. Try again.", {
        status: 503,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<PreviewHostBindings>;
