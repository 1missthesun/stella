/**
 * Where proof videos, posters and screenshots live: R2 bucket `stella-files`,
 * under marketing/proofs/<niche>/<slug>/. Upload with scripts/prepare-proof-media.sh.
 * The r2.dev address is fine for the preview; production should use a custom
 * domain on the bucket (Cloudflare rate-limits r2.dev).
 */
export const PROOFS = "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev/marketing/proofs";

/** The punched-in web cuts uploaded next to a recording's proof.mp4 (see VideoProof.cuts). */
export const webCuts = (dir: string) => ({
  wide: { src: `${PROOFS}/${dir}/web.mp4`, poster: `${PROOFS}/${dir}/web.jpg`, width: 1280, height: 800 },
  square: { src: `${PROOFS}/${dir}/web-square.mp4`, poster: `${PROOFS}/${dir}/web-square.jpg`, width: 720, height: 720 },
  /** A 16:10 still from the square cut (its top, at the result) for guide cards. */
  thumb: { src: `${PROOFS}/${dir}/thumb.jpg`, width: 720, height: 450 },
});
