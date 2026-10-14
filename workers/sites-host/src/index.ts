/**
 * The public origin of Stella sites (stellasites.app). It holds no logic and
 * no credentials: cloud-builder's `SitesHost` entrypoint decides what each
 * request may see (`workers/cloud-builder/src/slack/previews.ts`). Only sites
 * are served here, so a site can't reach stella.sh, an app origin, or
 * Stella's API with a visitor's cookies. The bare domain (`SITES_APEX`) says
 * what the domain is and where to report abuse.
 */
const ABOUT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stellasites.app</title>
<style>
body { font: 16px/1.55 system-ui, -apple-system, sans-serif; margin: 0; color: #1c1c1e; background: #fafafa; }
main { max-width: 36rem; margin: 12vh auto; padding: 0 1.5rem; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
a { color: #0a58ca; }
</style>
</head>
<body>
<main>
<h1>stellasites.app</h1>
<p>Sites on this domain are published by people using <a href="https://stella.sh/">Stella</a>, an AI assistant made by FromYou, LLC. Each site lives on its own subdomain and is created by its workspace, not by FromYou.</p>
<p>To report phishing, malware or other abuse on a stellasites.app site, email <a href="mailto:contact@fromyou.ai?subject=Abuse%20report%20for%20stellasites.app">contact@fromyou.ai</a> with the full link. We review reports and take sites down.</p>
</main>
</body>
</html>
`;

const about = (): Response =>
  new Response(ABOUT, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });

export default {
  async fetch(request: Request, env: SitesHostBindings): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__stella/healthz") return Response.json({ ok: true });
    if (env.SITES_APEX && url.hostname === env.SITES_APEX) return about();
    try {
      const response = await env.SITES.fetch(request);
      if (!response.headers.has("service-worker-allowed")) return response;
      const headers = new Headers(response.headers);
      headers.delete("service-worker-allowed");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch {
      return new Response("Site unavailable. Try again.", {
        status: 503,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<SitesHostBindings>;
