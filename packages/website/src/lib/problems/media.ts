/**
 * Where proof videos, posters and screenshots live: R2 bucket `stella-files`,
 * under marketing/proofs/<niche>/<slug>/. Upload with scripts/prepare-proof-media.sh.
 * The site serves them from its own origin: worker.mjs streams /media/proofs/*
 * from the bucket (PROOF_MEDIA binding), with byte ranges for video seeking.
 */
export const PROOFS = "/media/proofs";

/** The bucket's public address, for build-time fetches (social images) before a deploy. */
export const PROOFS_ORIGIN = "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev/marketing/proofs";

/** A proof path as a URL the build can fetch, whatever site it's deploying to. */
export const proofFetchUrl = (src: string) =>
  src.startsWith(`${PROOFS}/`) ? `${PROOFS_ORIGIN}/${src.slice(PROOFS.length + 1)}` : src;

/** The punched-in web cuts uploaded next to a recording's proof.mp4 (see VideoProof.cuts). */
export const webCuts = (dir: string) => ({
  wide: { src: `${PROOFS}/${dir}/web.mp4`, poster: `${PROOFS}/${dir}/web.jpg`, width: 1280, height: 800 },
  square: { src: `${PROOFS}/${dir}/web-square.mp4`, poster: `${PROOFS}/${dir}/web-square.jpg`, width: 720, height: 720 },
  /** A 16:10 still from the square cut (its top, at the result) for guide cards. */
  thumb: { src: `${PROOFS}/${dir}/thumb.jpg`, width: 720, height: 450 },
});
