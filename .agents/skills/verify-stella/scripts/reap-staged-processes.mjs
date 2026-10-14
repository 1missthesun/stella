#!/usr/bin/env node
// Stops processes that belong to an iOS verify staging folder
// (/tmp/stella-ios-verify.XXXXXX): Metro, Expo, and the React Native
// DevTools window Metro opens, which detach and outlive their parent. A
// process belongs to a folder when its command line, environment (PWD and
// friends, inherited from the shell that ran Metro) or working directory
// names it. The folder name is random, so nothing else can match.
//
//   reap-staged-processes.mjs <staged-path>   stop that folder's processes
//   reap-staged-processes.mjs --orphans       stop processes of staging folders that no longer exist,
//                                             and Metro/Expo/RN DevTools whose checkout was deleted
//   add --dry-run to only list them
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const orphans = args.includes("--orphans");
const target = args.find((arg) => !arg.startsWith("--"));
const STAGED = /\/(?:private\/)?tmp\/stella-ios-verify\.[A-Za-z0-9]+/g;
if (!orphans && !(target && /^\/tmp\/stella-ios-verify\.[A-Za-z0-9]+$/.test(target))) {
  process.stderr.write("usage: reap-staged-processes.mjs </tmp/stella-ios-verify.XXXXXX> | --orphans [--dry-run]\n");
  process.exit(2);
}
// Shared daemons that restart on demand and serve other projects too.
const SHARED = /(^|\/)watchman\b/;

const run = (command, argv) =>
  spawnSync(command, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }).stdout ?? "";

const table = () =>
  run("/bin/ps", ["-axeww", "-o", "pid=,ppid=,lstart=,command="])
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, started, text]) => ({ pid: Number(pid), ppid: Number(ppid), started, text }));

const cwds = () => {
  const byPid = new Map();
  let pid = 0;
  for (const line of run("/usr/sbin/lsof", ["-nP", "-a", "-d", "cwd", "-Fpn"]).split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) byPid.set(pid, line.slice(1));
  }
  return byPid;
};

const normalize = (value) => value.replace(/^\/private\/tmp\//, "/tmp/");
const stagedPathsIn = (text) => [...new Set((text.match(STAGED) ?? []).map(normalize))];

const rows = table();
const byPid = new Map(rows.map((row) => [row.pid, row]));
const ancestors = new Set();
for (let pid = process.pid; pid && !ancestors.has(pid); pid = byPid.get(pid)?.ppid) ancestors.add(pid);
const cwdByPid = cwds();

const belongs = (paths) =>
  orphans ? paths.some((entry) => !existsSync(entry)) : paths.includes(target);

// Metro, Expo and React Native DevTools whose own install was deleted (a
// removed worktree, not just a /tmp stage). A live project's files exist,
// so only leftovers of deleted checkouts match.
const RN_TOOL = /react-native-devtools|@react-native\/debugger-shell|expo(?:\/bin\/cli|\s+start)|\bmetro\b/;
const installDeleted = (row) => {
  const command = row.text.split(/\s[A-Z_][A-Z0-9_]*=/)[0] ?? row.text;
  if (!RN_TOOL.test(command)) return false;
  const modulePaths = (command.match(/\/[^\s]*\/node_modules\/[^\s]*/g) ?? []).map((entry) => entry.split(/[?=]/)[0]);
  return modulePaths.length > 0 && modulePaths.some((entry) => !existsSync(entry));
};

const victims = rows.filter((row) => {
  if (ancestors.has(row.pid) || SHARED.test(row.text.split(/\s+/)[0] ?? "")) return false;
  const paths = stagedPathsIn(`${row.text} ${cwdByPid.get(row.pid) ?? ""}`);
  if (paths.length > 0) return belongs(paths);
  return orphans && installDeleted(row);
});

const summary = victims.map(({ pid, text }) => ({ pid, command: text.slice(0, 140) }));
if (dryRun || victims.length === 0) {
  process.stdout.write(`${JSON.stringify({ dryRun, processes: summary })}\n`);
  process.exit(0);
}
for (const { pid } of victims) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}
const stillRunning = () => {
  const now = new Map(table().map((row) => [row.pid, row]));
  return victims.filter((victim) => now.get(victim.pid)?.started === victim.started);
};
const deadline = Date.now() + 4_000;
while (Date.now() < deadline && stillRunning().length > 0) await delay(250);
const killed = [];
for (const victim of stillRunning()) {
  try {
    process.kill(victim.pid, "SIGKILL");
    killed.push(victim.pid);
  } catch {}
}
process.stdout.write(`${JSON.stringify({ stopped: summary, forceKilled: killed })}\n`);
