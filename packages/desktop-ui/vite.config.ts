import fs from "fs";
import { randomBytes } from "node:crypto";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import { uiStateSharedStore } from "./vite/ui-state-plugin.ts";

const __dirname = import.meta.dirname;

const ROUTER_CONFIG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "tsr.config.json"), "utf8"),
) as {
  target: "react";
  autoCodeSplitting: boolean;
  routesDirectory: string;
  generatedRouteTree: string;
};

const BUNDLE_FINGERPRINT_FILE = path.resolve(
  __dirname,
  ".dev-electron-bundle-fingerprint.json",
);
const STELLA_REPO_ROOT = path.resolve(__dirname, "..", "..");
const BUNDLED_STELLA_DATA_SEED_DIR = path.resolve(
  STELLA_REPO_ROOT,
  "packages",
  "home-seed",
);
const DIST_ELECTRON_DIR = path.resolve(
  __dirname,
  "..",
  "desktop",
  "dist-electron",
);
const NATIVE_DIR = path.resolve(__dirname, "..", "native");
const VITE_WORKSPACE_ROOT = searchForWorkspaceRoot(__dirname);
const DEV_SERVER_URL = new URL(
  process.env.STELLA_DEV_SERVER_URL?.trim() || "http://127.0.0.1:57314",
);

const normalizeWatchedFilePath = (filePath: string) =>
  path.resolve(filePath).replace(/\\/g, "/");

const PDF_WORKER_PUBLIC_REL = path.posix.join(
  "vendor",
  "pdfjs",
  "pdf.worker.min.mjs",
);
const PDF_WORKER_PUBLIC_ABS = path.resolve(
  __dirname,
  "public",
  PDF_WORKER_PUBLIC_REL,
);

/**
 * Copies the pdfjs-dist worker into `public/vendor/pdfjs/` so the renderer
 * can load it as a static asset served by Vite's dev server.
 *
 * We can't rely on Vite/Rolldown to resolve the deep package path with
 * `?url`: the bun-managed node_modules layout hides pdfjs-dist behind
 * `.bun/node_modules/` and the deep path probe (`new URL("pdfjs-dist/...")`)
 * only sees Vite's import-map resolver, which doesn't expose deep file
 * paths through that channel. Copying via Node's resolver is the most
 * portable path: it works under bun's symlink layout, npm's flat layout,
 * and pnpm's strict-peer layout.
 */
function pdfWorkerAsset(): Plugin {
  const candidatePaths = [
    // wojtekmaj/react-pdf nests pdfjs-dist as its own dependency, which is
    // the most stable resolution target across package managers.
    path.resolve(
      STELLA_REPO_ROOT,
      "node_modules",
      ".bun",
      "node_modules",
      "pdfjs-dist",
      "build",
      "pdf.worker.min.mjs",
    ),
    path.resolve(
      STELLA_REPO_ROOT,
      "node_modules",
      "pdfjs-dist",
      "build",
      "pdf.worker.min.mjs",
    ),
  ];

  const resolveSource = (): string | null => {
    for (const candidate of candidatePaths) {
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        /* try next */
      }
    }
    return null;
  };

  const ensureWorkerCopied = () => {
    const sourcePath = resolveSource();
    if (!sourcePath) {
      console.warn(
        "[pdf-worker-asset] Could not locate pdfjs-dist/build/pdf.worker.min.mjs; PDF previews will not render.",
      );
      return;
    }
    const destPath = PDF_WORKER_PUBLIC_ABS;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    let needsCopy = true;
    try {
      const sourceStat = fs.statSync(sourcePath);
      const destStat = fs.statSync(destPath);
      if (
        destStat.size === sourceStat.size &&
        destStat.mtimeMs >= sourceStat.mtimeMs
      ) {
        needsCopy = false;
      }
    } catch {
      needsCopy = true;
    }

    if (needsCopy) {
      fs.copyFileSync(sourcePath, destPath);
    }
  };

  return {
    name: "pdf-worker-asset",
    configResolved() {
      ensureWorkerCopied();
    },
  };
}

const DEV_CSP_NONCE = randomBytes(16).toString("base64");

function devCspNonce(): Plugin {
  return {
    name: "dev-csp-nonce",
    apply: "serve",
    config: () => ({ html: { cspNonce: DEV_CSP_NONCE } }),
    transformIndexHtml(html) {
      return html.replace(
        /(http-equiv=["']Content-Security-Policy["'][\s\S]*?script-src)/i,
        `$1 'nonce-${DEV_CSP_NONCE}'`,
      );
    },
  };
}

function backendPreconnectHint(): Plugin {
  let origin: string | null = null;
  return {
    name: "backend-preconnect-hint",
    configResolved(config) {
      try {
        const value = config.env.VITE_STELLA_BACKEND_URL?.trim();
        origin = value ? new URL(value).origin : null;
      } catch {
        origin = null;
      }
    },
    transformIndexHtml(html, ctx) {
      if (!origin || path.basename(ctx.filename) !== "index.html") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "link",
            attrs: { rel: "preconnect", href: origin, crossorigin: "anonymous" },
            injectTo: "head" as const,
          },
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [
    TanStackRouterVite(ROUTER_CONFIG),
    react(),
    tailwindcss(),
    devCspNonce(),
    backendPreconnectHint(),
    uiStateSharedStore(),
    pdfWorkerAsset(),
  ],
  optimizeDeps: {
    include: [
      "streamdown",
      "recharts",
      "react-pdf",
      "motion",
      "@tanstack/react-router",
      "@tanstack/react-table",
      "@legendapp/list/react",
      "zod",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-switch",
    ],
    entries: ["index.html", "overlay.html", "companion.html"],
    rolldownOptions: {
      transform: {
        target: "esnext",
      },
    },
  },
  server: {
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/context/AppProviders.tsx",
        "./src/shell/FullShell.tsx",
        "./src/router.tsx",
        "./src/routes/__root.tsx",
        "./src/app/home/HomeContent.jsx",
        "./src/app/chat/ChatColumn.tsx",
        "./src/app/chat/ChatTimeline.tsx",
        "./src/app/chat/ConversationEvents.tsx",
        "./src/app/chat/Composer.tsx",
        "./src/app/chat/MessageRow.tsx",
        "./src/overlay-entry.tsx",
        "./src/companion-entry.tsx",
      ],
    },
    host: DEV_SERVER_URL.hostname,
    port: Number(DEV_SERVER_URL.port || 80),
    strictPort: true,
    forwardConsole: true,
    hmr: { overlay: false },
    fs: {
      allow: [VITE_WORKSPACE_ROOT],
    },
    watch: {
      ignored: [
        `${BUNDLED_STELLA_DATA_SEED_DIR.replace(/\\/g, "/")}/**`,
        `${DIST_ELECTRON_DIR.replace(/\\/g, "/")}/**`,
        `${NATIVE_DIR.replace(/\\/g, "/")}/**`,
        normalizeWatchedFilePath(BUNDLE_FINGERPRINT_FILE),
      ],
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: /^react$/,
        replacement: path.resolve(
          STELLA_REPO_ROOT,
          "node_modules/react/index.js",
        ),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: path.resolve(
          STELLA_REPO_ROOT,
          "node_modules/react/jsx-runtime.js",
        ),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: path.resolve(
          STELLA_REPO_ROOT,
          "node_modules/react/jsx-dev-runtime.js",
        ),
      },
      {
        find: /^react-dom$/,
        replacement: path.resolve(
          STELLA_REPO_ROOT,
          "node_modules/react-dom/index.js",
        ),
      },
      {
        find: /^react-dom\/client$/,
        replacement: path.resolve(
          STELLA_REPO_ROOT,
          "node_modules/react-dom/client.js",
        ),
      },
    ],
    dedupe: ["react", "react-dom"],
  },
});
