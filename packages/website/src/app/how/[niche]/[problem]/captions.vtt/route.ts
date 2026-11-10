import { captionsVtt, getProblemPage, publishedProblemPages } from "@/lib/problems";

// Captions for a page's proof video, built from its transcript moments.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedProblemPages()
    .filter((page) => page.proof.kind === "video" && !page.proof.video.captions)
    .map((page) => ({ niche: page.niche, problem: page.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ niche: string; problem: string }> }) {
  const { niche, problem } = await params;
  const page = getProblemPage(niche, problem);
  const vtt = page ? captionsVtt(page) : null;
  if (!vtt) return new Response("Not found", { status: 404 });
  return new Response(vtt, {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=86400" },
  });
}
