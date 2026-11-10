import { getNiche, publishedNiches } from "@/lib/problems";
import { OG_SIZE, problemOgImage } from "@/lib/problems/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Stella how-to guides";
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedNiches().map((niche) => ({ niche: niche.slug }));
}

export default async function Image({ params }: { params: Promise<{ niche: string }> }) {
  const niche = getNiche((await params).niche)!;
  return problemOgImage({ eyebrow: `${niche.name} guides`, headline: niche.h1 });
}
