// Builds the media page (page/main.ts) for the system WebView and writes it to stdout. Run as its own
// process: Bun.build keeps native memory for the life of the process that calls it.

import type { BunPlugin } from "bun";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DESKTOP_UI_SRC = resolve(import.meta.dir, "../../../desktop-ui/src");
const PAGE_UI_STATE = join(import.meta.dir, "page/ui-state.ts");
const DICTATION_PCM_WORKLET = resolve(import.meta.dir, "../../../desktop-ui/public/dictation-pcm-worklet.js");
const EXTENSIONS = [".ts", ".tsx", ".js"];

const resolveFile = (base: string) => {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) if (existsSync(join(base, `index${ext}`))) return join(base, `index${ext}`);
  return undefined;
};

const desktopUi: BunPlugin = {
  name: "media-page-desktop-ui",
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      if (args.path === "@/platform/ui-state") return { path: PAGE_UI_STATE };
      const path = resolveFile(join(DESKTOP_UI_SRC, args.path.slice(2)));
      return path ? { path } : undefined;
    });
  },
};

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "page/main.ts")],
  target: "browser",
  format: "iife",
  minify: true,
  define: { DICTATION_PCM_WORKLET: JSON.stringify(readFileSync(DICTATION_PCM_WORKLET, "utf8")) },
  plugins: [desktopUi],
});
if (!result.success) {
  process.stderr.write(result.logs.map(String).join("\n"));
  process.exit(1);
}
process.stdout.write(await result.outputs[0]!.text());
