import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const APP = "packages/desktop-ui/src/App.tsx";
const EAGER_LAYERS = [
  ["UserAskEventsLayer", "./features/user-ask/UserAskEventsLayer"],
  ["RemoteExecutionConsentLayer", "./global/execution/RemoteExecutionConsentLayer"],
];
const BOOTSTRAP_DIR = "packages/desktop-ui/src/bootstrap";
const CLOUD_BIND = "packages/desktop-ui/src/features/cloud/CloudProjectsCard.tsx";

export async function check(root) {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const problems = [];

  const app = read(APP);
  for (const [name, specifier] of EAGER_LAYERS) {
    if (!app.includes(`import { ${name} } from "${specifier}";`)) {
      problems.push(`${APP} must import ${name} statically: main sends its IPC events fire-and-forget, and an unmounted listener drops them`);
    }
    if (new RegExp(`lazy\\(.*${name}`).test(app)) {
      problems.push(`${APP} must not lazy-load ${name}`);
    }
  }

  for (const name of readdirSync(path.join(root, BOOTSTRAP_DIR))) {
    const file = `${BOOTSTRAP_DIR}/${name}`;
    const source = read(file);
    if (/\buseUiState\b|\bsetConversationId\b/.test(source)) {
      problems.push(`${file} must not write UiState.conversationId: the root layout is the only selection authority, and a bootstrap write loops the shell`);
    }
  }

  const bind = read(CLOUD_BIND);
  if (/\blocation\b|clipboard|URLSearchParams|searchParams/.test(bind)) {
    problems.push(`${CLOUD_BIND} must take the connect code only from the user's own action, never from a URL or the clipboard`);
  }
  const finishUses = bind.match(/handleFinishConnect/g)?.length ?? 0;
  if (finishUses !== 2 || !bind.includes("onClick={() => void handleFinishConnect()}")) {
    problems.push(`${CLOUD_BIND} handleFinishConnect must run only from its button's click`);
  }

  return problems;
}
