import type { Metadata } from "next";
import { Suspense } from "react";
import { MapsEmbedClient } from "./maps-embed-client";
import "./maps-embed.css";

export const metadata: Metadata = {
  title: "Map",
  robots: { index: false, follow: false },
};

export default function MapsEmbedPage() {
  return (
    <Suspense fallback={<div className="maps-embed-fallback" />}>
      <MapsEmbedClient />
    </Suspense>
  );
}
