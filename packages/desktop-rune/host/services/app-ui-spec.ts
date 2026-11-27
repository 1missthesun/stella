// The app UI the host loads (host/app.tsx), shared with the boot-bundle builder
// (scripts/build-boot-bundles.ts) so a prebuilt boot bundle has the key boot asks for.

import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export const appUiSpec = () => {
  const entry = resolve(ROOT, process.env.STELLA_RUNE_APP ?? "ui/App.tsx");
  return {
    entry,
    dir: dirname(entry),
    tsconfig: join(ROOT, "tsconfig.build.json"),
    external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
  };
};
