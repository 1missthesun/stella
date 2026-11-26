export const tmpdir = () => "/tmp";
export const homedir = () => "/";
export const platform = () => "browser";
export const fileURLToPath = (u: string | URL) => decodeURIComponent(new URL(String(u)).pathname);
export const pathToFileURL = (p: string) => new URL(`file://${encodeURI(p)}`);
export const spawnSync = () => ({ stdout: "", stderr: "", status: 1 });
export const spawn = () => { throw new Error("child_process is not available in the browser"); };
export const execFile = spawn;
export default { tmpdir, homedir, platform, fileURLToPath, pathToFileURL, spawnSync, spawn, execFile };
