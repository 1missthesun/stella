import { getNiche, getProblemPage, pageDemo, publishedProblemPages } from "@/lib/problems";
import { OG_SIZE, ogChat, problemOgImage } from "@/lib/problems/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A Stella how-to guide";
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedProblemPages().map((page) => ({ niche: page.niche, problem: page.slug }));
}

export default async function Image({ params }: { params: Promise<{ niche: string; problem: string }> }) {
  const { niche, problem } = await params;
  const page = getProblemPage(niche, problem)!;
  return problemOgImage({
    eyebrow: `${getNiche(page.niche)?.name} guide`,
    headline: page.h1,
    note: "Just ask Stella",
    chat: ogChat(pageDemo(page)),
  });
}
