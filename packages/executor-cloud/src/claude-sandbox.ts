import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, chown, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  CLOUD_CLAUDE_ACCOUNTS_ROOT,
  CLOUD_NATIVE_STATE_ANCHOR,
} from "@stella/contracts/cloud-native-state";
import { CLOUD_TURN_ATTEMPT_ANCHOR } from "@stella/contracts/cloud-turn-attempt";
import { isolateToolProcessLaunch } from "@stella/runtime/kernel/tools/process-isolation.js";
import {
  CLOUD_HOST_STATE,
  CLOUD_TOOL_PROCESS_IDENTITY,
} from "./cloud-process-isolation.js";
import {
  SANDBOX_FINGERPRINTS_FILE,
  SANDBOX_FINGERPRINTS_VIEW,
  ensureFingerprints,
} from "./secure-value-fingerprints.js";

/**
 * Claude Code in the cloud runs its own Read/Edit/Write/Bash/Grep/Glob inside
 * its process, so the process itself is the sandbox: it runs as the tool user
 * (`stella-tools`, no capabilities, no_new_privs), in a mount namespace that
 * shows it only this thread's session folder, its Claude account folder and a
 * private /tmp, and in a PID namespace that shows it only its own processes.
 * The executor stays root outside it and keeps the backend capability.
 *
 * Host state, other threads' sessions, other accounts, the turn attempt
 * folders (the executor's capability) and the executor's processes are out of
 * sight. Before every turn `probeClaudeSandbox` runs a real process through
 * the same launch and fails the turn unless every escape attempt fails.
 */

const run = promisify(execFile);

const UNSHARE_PATH = "/usr/bin/unshare";
const CLAUDE_TMP_ROOT = path.join(CLOUD_HOST_STATE, "claude-tmp");
const PROCESS_LOGS_ANCHOR = "/run/stella-processes";

export type ClaudeSandbox = {
  stateRoot: string;
  accountDirectory: string;
  tmpDir: string;
  cwd: string;
  home: string;
  /** The thread's secure-value fingerprints folder (root, read-only inside). */
  fingerprintsDir: string;
};

const chownTree = async (target: string, owner: string): Promise<void> => {
  // -P (the default) never follows a symlink; -h changes a link itself.
  await run("chown", ["-R", "-P", "-h", owner, "--", target]);
};

const ownedByToolUser = async (target: string): Promise<void> => {
  await chownTree(
    target,
    `${CLOUD_TOOL_PROCESS_IDENTITY.uid}:${CLOUD_TOOL_PROCESS_IDENTITY.gid}`,
  );
};

/**
 * Give this thread's session folder back to root after the CLI has run in the
 * sandbox, so the executor's native-state machinery (the archive, the parity
 * check, and the sealed attestation) sees the root-owned tree it expects. The
 * tool user owns the folder only while its own CLI process is using it.
 */
export const restoreNativeStateOwner = async (
  stateRoot: string,
): Promise<void> => {
  await chownTree(stateRoot, "0:0").catch(() => undefined);
};

/**
 * Hand this thread's session folder and its Claude account folder to the tool
 * user (the backend restores sessions and writes logins as root) and make its
 * private /tmp. `fresh` empties /tmp: nothing of a previous process remains.
 */
const PROTECTED_HARDLINKS = "/proc/sys/fs/protected_hardlinks";

/**
 * Handing folders the tool user writes in back to it (`chown -R` as root) is
 * safe only while the kernel refuses that user a hard link to a file it does
 * not own: otherwise a link to a root file left in its session folder would
 * become the tool user's on the next turn. Some hosts boot with the
 * protection off; the executor is root and turns it on. The probe checks it
 * and fails the turn if it is still off.
 */
const protectHardlinks = async (): Promise<void> => {
  const current = await readFile(PROTECTED_HARDLINKS, "utf8").catch(() => "");
  if (current.trim() === "1") return;
  await writeFile(PROTECTED_HARDLINKS, "1\n").catch(() => undefined);
};

export const prepareClaudeSandbox = async (args: {
  stateRoot: string;
  accountDirectory: string;
  cwd: string;
  home: string;
  threadKey: string;
  fresh: boolean;
}): Promise<ClaudeSandbox> => {
  await mkdir(CLAUDE_TMP_ROOT, { recursive: true, mode: 0o700 });
  await chmod(CLAUDE_TMP_ROOT, 0o700);
  const tmpDir = path.join(
    CLAUDE_TMP_ROOT,
    createHash("sha256").update(args.threadKey).digest("hex").slice(0, 32),
  );
  if (args.fresh) await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });
  await chown(tmpDir, CLOUD_TOOL_PROCESS_IDENTITY.uid, CLOUD_TOOL_PROCESS_IDENTITY.gid);
  await chmod(tmpDir, 0o700);
  await protectHardlinks();
  if ((await readFile(PROTECTED_HARDLINKS, "utf8").catch(() => "")).trim() !== "1") {
    // Never hand the folders over without the protection.
    throw new Error("protected_hardlinks is off and could not be turned on");
  }
  await ownedByToolUser(args.stateRoot);
  await ownedByToolUser(args.accountDirectory);
  const { directory: fingerprintsDir } = await ensureFingerprints(args.threadKey);
  return {
    stateRoot: args.stateRoot,
    accountDirectory: args.accountDirectory,
    tmpDir,
    cwd: args.cwd,
    home: args.home,
    fingerprintsDir,
  };
};

/**
 * Runs as root inside the new mount and PID namespaces, then becomes the tool
 * user. The three folders are bound to a stage first, the anchors are covered
 * with empty tmpfs (0711: passable, not listable), and the folders are bound
 * back at their own paths, so every path Claude Code keeps stays the same.
 * The thread's secure-value fingerprints folder is bound read-only at its
 * view inside the covered host state, where the redaction hook reads it.
 */
const ENTER_SCRIPT = `set -eu
state=$1 account=$2 tmp=$3 cwd=$4 fingerprints=$5
shift 6
umask 022
mkdir -p /mnt
mount -t tmpfs -o mode=0700,size=64k stella-stage /mnt
mkdir /mnt/state /mnt/account /mnt/tmp /mnt/fingerprints
mount --bind "$state" /mnt/state
mount --bind "$account" /mnt/account
mount --bind "$tmp" /mnt/tmp
mount --bind "$fingerprints" /mnt/fingerprints
mount -t tmpfs -o mode=0711,size=1m stella-native-state ${CLOUD_NATIVE_STATE_ANCHOR}
mount -t tmpfs -o mode=0711,size=1m stella-host-state ${CLOUD_HOST_STATE}
for hidden in ${CLOUD_TURN_ATTEMPT_ANCHOR} ${PROCESS_LOGS_ANCHOR}; do
  if [ -d "$hidden" ]; then mount -t tmpfs -o mode=0700,size=64k stella-hidden "$hidden"; fi
done
mkdir -p "$state" "$account" ${SANDBOX_FINGERPRINTS_VIEW}
mount --bind /mnt/state "$state"
mount --bind /mnt/account "$account"
mount --bind /mnt/tmp /tmp
mount --bind /mnt/fingerprints ${SANDBOX_FINGERPRINTS_VIEW}
mount -o remount,bind,ro ${SANDBOX_FINGERPRINTS_VIEW}
umount /mnt/state /mnt/account /mnt/tmp /mnt/fingerprints
umount /mnt
mkdir -p "$cwd"
cd "$cwd"
exec "$@"
`;

/** The argv that runs `command` inside the sandbox. */
export const sandboxedClaudeLaunch = (
  sandbox: ClaudeSandbox,
  command: string,
  commandArgs: readonly string[],
): { command: string; args: string[] } => {
  const dropped = isolateToolProcessLaunch({
    command,
    commandArgs,
    identity: { ...CLOUD_TOOL_PROCESS_IDENTITY, home: sandbox.home },
  });
  return {
    command: UNSHARE_PATH,
    args: [
      "--pid",
      "--fork",
      "--kill-child",
      "--mount-proc",
      "--propagation",
      "private",
      "--",
      "/bin/sh",
      "-c",
      ENTER_SCRIPT,
      "stella-claude-sandbox",
      sandbox.stateRoot,
      sandbox.accountDirectory,
      sandbox.tmpDir,
      sandbox.cwd,
      sandbox.fingerprintsDir,
      "--",
      dropped.command,
      ...dropped.args,
    ],
  };
};

/**
 * Every escape a built-in Bash or Read could try, run for real as the
 * sandboxed tool user. Prints SANDBOX_OK only when all of them fail.
 */
const PROBE_SCRIPT = `ok=1
fail() { echo "FAIL $1"; ok=0; }
field() { sed -n "s/^$1:[[:space:]]*//p" /proc/self/status | tr -s ' \\t' '  ' | sed 's/ *$//'; }
[ "$(field Uid)" = "${CLOUD_TOOL_PROCESS_IDENTITY.uid} ${CLOUD_TOOL_PROCESS_IDENTITY.uid} ${CLOUD_TOOL_PROCESS_IDENTITY.uid} ${CLOUD_TOOL_PROCESS_IDENTITY.uid}" ] || fail uid
[ "$(field Gid)" = "${CLOUD_TOOL_PROCESS_IDENTITY.gid} ${CLOUD_TOOL_PROCESS_IDENTITY.gid} ${CLOUD_TOOL_PROCESS_IDENTITY.gid} ${CLOUD_TOOL_PROCESS_IDENTITY.gid}" ] || fail gid
[ -z "$(field Groups)" ] || fail groups
for cap in CapInh CapPrm CapEff CapBnd CapAmb; do
  case "$(field $cap)" in *[!0]*) fail "$cap" ;; esac
done
[ "$(field NoNewPrivs)" = 1 ] || fail no_new_privs
[ "$(cat /proc/sys/fs/protected_hardlinks 2>/dev/null)" = 1 ] || fail protected_hardlinks
for status in /proc/[0-9]*/status; do
  uid=$(sed -n 's/^Uid:[[:space:]]*\\([0-9]*\\).*/\\1/p' "$status" 2>/dev/null)
  [ -z "$uid" ] || [ "$uid" = "${CLOUD_TOOL_PROCESS_IDENTITY.uid}" ] || fail "process_visible:$status"
done
ls ${CLOUD_NATIVE_STATE_ANCHOR}/ >/dev/null 2>&1 && fail native_state_listable
ls ${CLOUD_HOST_STATE}/ >/dev/null 2>&1 && fail host_state_listable
ls ${CLOUD_TURN_ATTEMPT_ANCHOR}/ >/dev/null 2>&1 && fail attempts_listable
touch ${CLOUD_NATIVE_STATE_ANCHOR}/.probe 2>/dev/null && fail native_state_writable
for hidden in "$@"; do
  if [ -e "$hidden" ] || [ -L "$hidden" ]; then fail "visible:$hidden"; fi
  cat "$hidden" >/dev/null 2>&1 && fail "readable:$hidden"
done
for locked in ${CLOUD_HOST_STATE} ${CLOUD_NATIVE_STATE_ANCHOR} ${CLOUD_TURN_ATTEMPT_ANCHOR}; do
  unshare -Urm sh -c "umount -l $locked && ls $locked" >/dev/null 2>&1 && fail "unmounted:$locked"
done
probe="$STELLA_SANDBOX_STATE/.sandbox-probe"
touch "$probe" 2>/dev/null && rm -f "$probe" || fail state_not_writable
[ -r "$STELLA_SANDBOX_ACCOUNT/.credentials.json" ] || fail account_not_readable
[ -w /tmp ] || fail tmp_not_writable
[ -r "$STELLA_SANDBOX_HOOK" ] || fail hook_not_readable
[ -r "${SANDBOX_FINGERPRINTS_FILE}" ] || fail fingerprints_not_readable
[ -w "${SANDBOX_FINGERPRINTS_FILE}" ] && fail fingerprints_writable
[ -w "${SANDBOX_FINGERPRINTS_VIEW}" ] && fail fingerprints_folder_writable
mv "${SANDBOX_FINGERPRINTS_FILE}" "${SANDBOX_FINGERPRINTS_FILE}.moved" 2>/dev/null && fail fingerprints_movable
[ -x "$STELLA_SANDBOX_RUNTIME" ] || fail runtime_not_executable
[ $ok = 1 ] && echo SANDBOX_OK
`;

const childrenOf = async (directory: string): Promise<string[]> =>
  (await readdir(directory).catch(() => [] as string[])).map((name) =>
    path.join(directory, name),
  );

/** What the sandbox must not reach, listed as root outside it. */
const hiddenPaths = async (sandbox: ClaudeSandbox): Promise<string[]> => {
  // The sandbox sees two host-state paths: the accounts folder holding its
  // own account, and the orchestrator's (empty) working folder.
  const hostState = (await childrenOf(CLOUD_HOST_STATE)).filter(
    (entry) =>
      entry !== CLOUD_CLAUDE_ACCOUNTS_ROOT &&
      sandbox.cwd !== entry &&
      !sandbox.cwd.startsWith(`${entry}/`),
  );
  const accounts = (await childrenOf(CLOUD_CLAUDE_ACCOUNTS_ROOT)).filter(
    (entry) => entry !== sandbox.accountDirectory,
  );
  const sessions = (await childrenOf(CLOUD_NATIVE_STATE_ANCHOR)).filter(
    (entry) => entry !== sandbox.stateRoot,
  );
  const attempts = await childrenOf(CLOUD_TURN_ATTEMPT_ANCHOR);
  const logs = await childrenOf(PROCESS_LOGS_ANCHOR);
  return [
    ...hostState,
    ...accounts.slice(0, 16),
    ...sessions.slice(0, 16),
    ...attempts.slice(0, 16),
    ...logs.slice(0, 16),
    path.join(CLOUD_HOST_STATE, "claude-logins"),
    path.join(CLOUD_HOST_STATE, "claude-keepers"),
  ];
};

/**
 * Run the probe through the same sandbox Claude Code is about to run in.
 * Resolves to undefined when every escape failed, else to what got through.
 */
export const probeClaudeSandbox = async (
  sandbox: ClaudeSandbox,
  hook: { hookScript: string; runtime: string },
): Promise<string | undefined> => {
  const launch = sandboxedClaudeLaunch(sandbox, "/bin/sh", [
    "-c",
    PROBE_SCRIPT,
    "stella-claude-sandbox-probe",
    ...(await hiddenPaths(sandbox)),
  ]);
  try {
    const { stdout } = await run(launch.command, launch.args, {
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        STELLA_SANDBOX_STATE: sandbox.stateRoot,
        STELLA_SANDBOX_ACCOUNT: sandbox.accountDirectory,
        STELLA_SANDBOX_HOOK: hook.hookScript,
        STELLA_SANDBOX_RUNTIME: hook.runtime,
      },
      timeout: 15_000,
      maxBuffer: 256 * 1024,
    });
    if (stdout.trim().split("\n").includes("SANDBOX_OK")) return undefined;
    return stdout.trim() || "the probe printed nothing";
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    return (
      `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`.trim() ||
      failed.message ||
      "the probe could not run"
    );
  }
};
