import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stella — Your personal AI assistant",
    short_name: "Stella",
    description:
      "Your personal AI assistant. Chat, voice, automation, and a fully customizable interface — all in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f8ff",
    theme_color: "#f3f8ff",
    icons: [
      {
        src: "/icon.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/stella-logo.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
