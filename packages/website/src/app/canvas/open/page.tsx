import type { Metadata } from "next";
import { CanvasOpenView } from "./canvas-open-view";

export const metadata: Metadata = {
  title: "Open canvas",
  description: "Open a private Stella canvas you made.",
  robots: { index: false, follow: false },
};

export default function CanvasOpenPage() {
  return (
    <div className="stella-page">
      <CanvasOpenView />
    </div>
  );
}
