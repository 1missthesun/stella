import { proofFetchUrl } from "@/lib/problems/media";
import { formatDate, getNiche, getProblemPage, publishedProblemPages } from "@/lib/problems";
import { OG_SIZE, problemOgImage } from "@/lib/problems/og";

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
  const proof = page.proof;
  return problemOgImage({
    eyebrow: `${getNiche(page.niche)?.name} guide`,
    headline: page.h1,
    note:
      proof.kind === "steps-only"
        ? `Manual steps + Stella · checked ${formatDate(page.lastChecked)}`
        : `Shown working on ${proof.platform} · ${formatDate(proof.recordedOn)}`,
    poster: proof.kind === "video" ? proofFetchUrl(proof.output?.poster ?? proof.video.poster) : proof.kind === "shots" ? proofFetchUrl(proof.shots[0].src) : undefined,
  });
}
