import { execFileSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  pidIsAlive,
  readProcessGroup,
  recordProcess,
  signalRecordedProcess,
} from '../../../runtime/kernel/shared/process-identity.ts';

const scriptDir = import.meta.dirname;
const desktopDir = resolve(scriptDir, '..', '..');
const repoRootDir = resolve(desktopDir, '..', '..');
export const stellaStatePath = resolve(
  process.env.STELLA_DATA_DIR?.trim() || resolve(homedir(), '.stella'),
);

const devElectronBinaryPaths = [
  resolve(repoRootDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
];

export const desktopGeneratedPaths = [
  resolve(desktopDir, '.stella-hmr-state.json'),
  resolve(desktopDir, 'dist-electron'),
];

export const stellaSqlitePaths = [
  'stella.sqlite',
  'stella.sqlite-shm',
  'stella.sqlite-wal',
  'stella-runs.sqlite',
  'stella-runs.sqlite-shm',
  'stella-runs.sqlite-wal',
].map((relativePath) => resolve(stellaStatePath, relativePath));

export const stellaStateRuntimePaths = [
  'electron-user-data',
  'office-previews',
  'raw',
  'tmp',
  'skills/user-profile',
  'device.json',
  'local-scheduler.json',
  'preferences.json',
  'ui-state.json',
  'stella.sqlite',
  'stella.sqlite-shm',
  'stella.sqlite-wal',
  'stella-runs.sqlite',
  'stella-runs.sqlite-shm',
  'stella-runs.sqlite-wal',
].map((relativePath) => resolve(stellaStatePath, relativePath));

const killWindowsTree = (pid) =>
  new Promise((resolvePromise) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', resolvePromise);
    killer.on('exit', resolvePromise);
  });

const waitForExit = async (pid, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(pid, 0);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    } catch {
      return;
    }
  }
};

const RESET_REASON = 'dev reset: stopping a leftover dev Electron';

// Recorded at pgrep time and re-checked before each signal, so a pid that
// exits and is reused while the reset runs is left alone. The group is
// signalled only while the process still leads it.
const killPosixTree = async (recorded) => {
  const group = readProcessGroup(recorded.pid) === recorded.pid;
  const signal = (name) => signalRecordedProcess(recorded, name, { reason: RESET_REASON, group });
  signal('SIGTERM');
  await waitForExit(recorded.pid, 2500);
  if (!pidIsAlive(recorded.pid)) return;
  signal('SIGKILL');
};

const stopResidualDevElectron = async () => {
  if (process.platform === 'win32') {
    return 0;
  }

  const matched = new Map();

  for (const binaryPath of devElectronBinaryPaths) {
    const pathFragment = binaryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let stdout = '';
    try {
      stdout = execFileSync(
        'pgrep',
        [
          '-f',
          pathFragment,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
        continue;
      }
      continue;
    }

    stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
      .forEach((pid) => matched.set(pid, recordProcess(pid, [binaryPath])));
  }

  const targets = [...matched.values()];

  await Promise.allSettled(targets.map((recorded) => killPosixTree(recorded)));
  return targets.length;
};

export const clearPaths = async (paths, options = { recursive: true }) => {
  await Promise.allSettled(
    paths.map((targetPath) =>
      fs.rm(targetPath, {
        recursive: options.recursive,
        force: true,
      }),
    ),
  );
};

export const stopDevProcesses = async () => {
  const stoppedResidualElectron = await stopResidualDevElectron();
  return {
    stoppedResidualElectron,
  };
};

export const formatStoppedProcessLines = ({
  stoppedResidualElectron,
}) => [
  stoppedResidualElectron > 0
    ? `Stopped ${stoppedResidualElectron} residual Electron dev process${stoppedResidualElectron === 1 ? '' : 'es'}.`
    : '',
];
