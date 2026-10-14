import type { NextConfig } from "next";
import path from "path";
import { loadEnv } from "vite";

const desktopPublicEnv = loadEnv(
  process.env.NODE_ENV || "production",
  path.resolve(__dirname, "../desktop-ui"),
  "VITE_",
);
const stellaBackendUrl = (
  process.env.NEXT_PUBLIC_STELLA_BACKEND_URL ||
  desktopPublicEnv.VITE_STELLA_BACKEND_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");
const publicTurnstileSiteKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  desktopPublicEnv.VITE_TURNSTILE_SITE_KEY;

const REVALIDATING_ASSET_CACHE =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    cssChunking: "strict",
  },
  env: {
    ...(stellaBackendUrl
      ? { NEXT_PUBLIC_STELLA_BACKEND_URL: stellaBackendUrl }
      : {}),
    ...(publicTurnstileSiteKey
      ? { NEXT_PUBLIC_TURNSTILE_SITE_KEY: publicTurnstileSiteKey }
      : {}),
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 82],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.fal.media",
      },
    ],
    minimumCacheTTL: 31536000,
  },
  async redirects() {
    return [
      { source: "/agents", destination: "/one-chat", permanent: true },
      { source: "/agents.md", destination: "/one-chat.md", permanent: true },
      { source: "/go", destination: "/", statusCode: 301 },
      { source: "/slack", destination: "/crew", permanent: true },
    ];
  },
  async rewrites() {
    return stellaBackendUrl
      ? [
          {
            source: "/chat-app/u/:fork/:tree/:path*",
            destination: `${stellaBackendUrl}/web-renderer/:fork/:tree/:path*`,
          },
        ]
      : [];
  },
  async headers() {
    return [
      {
        source: "/challenge",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/chat",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/chat-app/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // Must follow the `/chat-app/:path*` rule: when several rules match,
        // Next applies them in order and the last value for a key wins, so
        // listing this first left the hashed bundle revalidating on every
        // visit.
        source: "/chat-app/assets/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/chat-app/u/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source:
          "/:asset(stella-logo|stella-logo-ui|stella-wallpaper).:ext(png|jpg|svg)",
        headers: [{ key: "Cache-Control", value: REVALIDATING_ASSET_CACHE }],
      },
      {
        source: "/:asset(icon|apple-icon).png",
        headers: [{ key: "Cache-Control", value: REVALIDATING_ASSET_CACHE }],
      },
      {
        source:
          "/:folder(mock-app-icons|doc-mocks|app-mocks|demos)/:path*.:ext(png|jpg|jpeg|webp|avif|svg)",
        headers: [{ key: "Cache-Control", value: REVALIDATING_ASSET_CACHE }],
      },
    ];
  },
};

export default nextConfig;
