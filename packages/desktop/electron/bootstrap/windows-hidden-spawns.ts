import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { installWindowsHiddenSpawns } from "@stella/node-shared/shared/windows-hidden-spawns";

// Electron main has no console on Windows, so any console program it starts
// without `windowsHide` (a helper, git, powershell, a library's own spawn)
// opens a visible Terminal window. Imported first by main.ts, before any
// module that spawns.
installWindowsHiddenSpawns(childProcess, syncBuiltinESMExports);
