import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;
const repo = path.resolve(here, "../../..");
const ui = path.resolve(repo, "packages/desktop-ui/src");

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
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
