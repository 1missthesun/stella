import { renderAnswerMarkdown } from "@/lib/agent-pages";
import { ANSWER_PAGES, getAnswerPage } from "@/lib/answers";
import { getSiteUrl } from "@/lib/site-url";

// Served at /ai/<slug>.md through a rewrite in next.config.ts.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return ANSWER_PAGES.map((page) => ({ slug: page.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const page = getAnswerPage(slug);
  if (!page) return new Response("Not found", { status: 404 });
  return new Response(renderAnswerMarkdown(page), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      Link: `<${new URL(`/ai/${page.slug}`, getSiteUrl()).href}>; rel="canonical"`,
    },
  });
}
