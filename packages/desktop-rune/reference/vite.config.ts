import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = import.meta.dirname;
const repo = path.resolve(here, "../../..");
const ui = path.resolve(repo, "packages/desktop-ui/src");

const pdfWorker = (): Plugin => ({
  name: "pdf-worker",
  configureServer(server) {
    const fromReactPdf = createRequire(createRequire(path.join(repo, "package.json")).resolve("react-pdf"));
    const worker = fromReactPdf.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
    server.middlewares.use("/vendor/pdfjs/pdf.worker.min.mjs", (_req, res) => {
      res.setHeader("Content-Type", "text/javascript");
      res.end(readFileSync(worker));
    });
  },
});

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), pdfWorker()],
  define: { "import.meta.env.VITE_STELLA_REPO": JSON.stringify(repo) },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${ui}/` },
      { find: /^react$/, replacement: path.resolve(repo, "node_modules/react/index.js") },
      { find: /^react-dom$/, replacement: path.resolve(repo, "node_modules/react-dom/index.js") },
      { find: /^react-dom\/client$/, replacement: path.resolve(repo, "node_modules/react-dom/client.js") },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 57390), strictPort: true, fs: { allow: [repo] } },
});
