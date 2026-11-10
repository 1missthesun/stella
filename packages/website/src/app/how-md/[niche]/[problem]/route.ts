import { getProblemPage, problemPath, publishedProblemPages } from "@/lib/problems";
import { renderProblemMarkdown } from "@/lib/problems/markdown";
import { getSiteUrl } from "@/lib/site-url";

// Served at /how/<niche>/<slug>.md through a rewrite in next.config.ts.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedProblemPages().map((page) => ({ niche: page.niche, problem: page.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ niche: string; problem: string }> }) {
  const { niche, problem } = await params;
  const page = getProblemPage(niche, problem);
  if (!page) return new Response("Not found", { status: 404 });
  return new Response(renderProblemMarkdown(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      Link: `<${new URL(problemPath(page), getSiteUrl()).href}>; rel="canonical"`,
    },
  });
}
