import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const INDEX_CSS = "packages/desktop-ui/src/index.css";
const DIST = "node_modules/streamdown/dist";

export async function check(root) {
  const problems = [];
  const css = readFileSync(path.join(root, INDEX_CSS), "utf8");
  const source = css.match(/@source "([^"]*streamdown[^"]*)";/)?.[1];
  if (!source) {
    problems.push(`${INDEX_CSS} must keep an @source for Streamdown's dist, or Tailwind emits none of the utilities its markup uses`);
  } else {
    const dir = path.resolve(path.join(root, path.dirname(INDEX_CSS)), path.dirname(source));
    if (path.relative(root, dir) !== DIST || !existsSync(dir)) {
      problems.push(`${INDEX_CSS} @source "${source}" must resolve to ${DIST} (it resolves to ${path.relative(root, dir)})`);
    }
  }

  const distDir = path.join(root, DIST);
  if (existsSync(distDir)) {
    const shape = /(\w+)\.runSync\(\1\.parse\((\w+)\),\2\)/;
    const found = readdirSync(distDir)
      .filter((name) => name.endsWith(".js"))
      .some((name) => shape.test(readFileSync(path.join(distDir, name), "utf8")));
    if (!found) {
      problems.push(`Streamdown no longer renders with processor.runSync(processor.parse(text), text); packages/desktop-ui/src/app/chat/markdown-render-cache.ts wraps exactly that pair`);
    }
  }
  return problems;
}
