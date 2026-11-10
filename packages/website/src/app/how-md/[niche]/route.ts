import { markdownResponse } from "@/lib/agent-pages";
import { getNiche, publishedNiches } from "@/lib/problems";
import { renderNicheMarkdown } from "@/lib/problems/markdown";

// Served at /how/<niche>.md through a rewrite in next.config.ts.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedNiches().map((niche) => ({ niche: niche.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ niche: string }> }) {
  const { niche } = await params;
  if (!getNiche(niche)) return new Response("Not found", { status: 404 });
  return markdownResponse(renderNicheMarkdown(niche));
}
