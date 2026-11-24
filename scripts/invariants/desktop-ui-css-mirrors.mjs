import { readFileSync } from "node:fs";
import path from "node:path";

const TIMELINE = "packages/desktop-ui/src/app/chat/ChatTimeline.tsx";
const CHAT_CSS = "packages/desktop-ui/src/app/chat/full-shell.chat.css";
const NOTCH = "packages/desktop-ui/src/shell/topbar/open-tab-notch.ts";
const TABS_CSS = "packages/desktop-ui/src/shell/topbar/shell-topbar-tabs.css";

const numberConst = (source, name) => {
  const value = source.match(new RegExp(`const ${name} = (\\d+);`))?.[1];
  return value === undefined ? null : Number(value);
};

export async function check(root) {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const problems = [];

  const timeline = read(TIMELINE);
  const rowGap = numberConst(timeline, "ROW_GAP");
  const runGap = numberConst(timeline, "ASSISTANT_RUN_GAP");
  const chatCss = read(CHAT_CSS);
  const tailGap = chatCss.match(/\.event-list-extra-tail:not\(:empty\) \{\s*margin-top: (-?\d+)px;/)?.[1];
  const vacatedPull = chatCss.match(/inline-working-indicator--vacated\)\s*\+ div\s*> \.event-list-extra-tail \{\s*margin-top: (-?\d+)px;/)?.[1];
  if (rowGap === null || runGap === null) {
    problems.push(`${TIMELINE} must declare numeric ROW_GAP and ASSISTANT_RUN_GAP`);
  } else {
    const difference = rowGap - runGap;
    if (Number(tailGap) !== difference) {
      problems.push(`${CHAT_CSS} .event-list-extra-tail:not(:empty) margin-top (${tailGap}px) must be ROW_GAP - ASSISTANT_RUN_GAP (${difference}px)`);
    }
    if (Number(vacatedPull) !== -difference) {
      problems.push(`${CHAT_CSS} vacated working-indicator pull-up (${vacatedPull}px) must be -(ROW_GAP - ASSISTANT_RUN_GAP) (${-difference}px)`);
    }
  }

  const notch = read(NOTCH);
  const footSize = numberConst(notch, "FOOT_SIZE");
  const footReach = numberConst(notch, "FOOT_REACH");
  const cssFoot = read(TABS_CSS).match(/--topbar-tab-foot: (\d+)px;/)?.[1];
  if (footSize === null || Number(cssFoot) !== footSize) {
    problems.push(`${NOTCH} FOOT_SIZE (${footSize}) must equal --topbar-tab-foot in ${TABS_CSS} (${cssFoot}px)`);
  }
  if (footSize !== null && footReach !== footSize - 1) {
    problems.push(`${NOTCH} FOOT_REACH (${footReach}) must be FOOT_SIZE - 1: the stage edge restarts under each foot's last pixel`);
  }
  return problems;
}
