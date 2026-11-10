/**
 * Where proof videos, posters and screenshots live: R2 bucket `stella-files`,
 * under marketing/proofs/<niche>/<slug>/. Upload with scripts/prepare-proof-media.sh.
 * The r2.dev address is fine for the preview; production should use a custom
 * domain on the bucket (Cloudflare rate-limits r2.dev).
 */
export const PROOFS = "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev/marketing/proofs";
