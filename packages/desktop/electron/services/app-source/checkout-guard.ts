import { promises as fs } from "node:fs";
import path from "node:path";
import { gitRaw } from "./git.js";

const MARKER = "stella-checkout-guard v5";

export const DRAFT_AGENTS_DIR = "stella-drafts";

const HOOK = `#!/bin/sh
# ${MARKER} (written by Stella; rewritten on launch)
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
case "$1" in
prepared)
  [ -n "$STELLA_DRAFTS_DIR" ] && [ -n "$STELLA_APP_DIR" ] || exit 0
  here=$(cd "$common" 2>/dev/null && pwd -P) || exit 0
  app=$(unset GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE; cd "$STELLA_APP_DIR" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
  app=$(cd "$app" 2>/dev/null && pwd -P) || exit 0
  [ "$here" = "$app" ] || exit 0
  branch=$(sed -n 's/^ref: //p' "$common/HEAD")
  [ -n "$branch" ] || exit 0
  while read -r old new ref; do
    if [ "$ref" = "$branch" ] && [ "$old" != "$new" ]; then
      echo "Stella's running checkout can't be changed directly ($ref)." >&2
      echo "Follow the modify-stella skill: make the change in a draft under \\$STELLA_DRAFTS_DIR; the user applies it with Update." >&2
      echo "If this command already changed files in the checkout, restore them with: git -C \\"\\$STELLA_APP_DIR\\" reset --merge" >&2
      echo "This guard is deliberate: don't unset STELLA_DRAFTS_DIR, skip hooks or otherwise work around it." >&2
      exit 1
    fi
  done
  ;;
committed)
  [ -n "$STELLA_AGENT_ID" ] || exit 0
  while read -r old new ref; do
    case "$ref" in refs/heads/draft/*) ;; *) continue ;; esac
    case "$new" in *[!0]*) ;; *) continue ;; esac
    mkdir -p "$common/${DRAFT_AGENTS_DIR}" &&
      printf '%s\\n' "$STELLA_AGENT_ID" > "$common/${DRAFT_AGENTS_DIR}/\${ref#refs/heads/draft/}"
  done
  ;;
esac
exit 0
`;

export const installCheckoutGuard = async (
  appDir: string,
  log: (event: string, data: Record<string, unknown>) => void,
) => {
  const hooks = await gitRaw(appDir, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "hooks",
  ]);
  if (hooks.code !== 0) return;
  const target = path.join(hooks.stdout.trim(), "reference-transaction");
  const existing = await fs.readFile(target, "utf8").catch(() => null);
  if (existing === HOOK) return;
  if (existing !== null && !existing.includes("stella-checkout-guard")) {
    log("app-source.checkout-guard-skipped", { reason: "foreign hook" });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, HOOK, { mode: 0o755 });
  await fs.chmod(target, 0o755);
};
