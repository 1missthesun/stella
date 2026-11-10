import { OG_SIZE, problemOgImage } from "@/lib/problems/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Stella how-to guides";

export default function Image() {
  return problemOgImage({ eyebrow: "How-to", headline: "Your problem, answered properly." });
}
