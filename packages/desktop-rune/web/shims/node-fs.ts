const unavailable = (name: string) => () => { throw new Error(`fs.${name} is not available in the browser`); };
export const existsSync = () => false;
export const mkdirSync = () => undefined;
export const rmSync = () => undefined;
export const readFileSync = unavailable("readFileSync");
export const writeFileSync = unavailable("writeFileSync");
export const statSync = unavailable("statSync");
export const readdirSync = () => [];
export const writeSync = unavailable("writeSync");
export const promises = {
  mkdtemp: async () => { throw new Error("fs.mkdtemp is not available in the browser"); },
  readdir: async () => [],
  readFile: async () => { throw new Error("fs.readFile is not available in the browser"); },
  rm: async () => undefined,
};
export const { mkdtemp, readdir, readFile, rm } = promises;
export default { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync, writeSync, promises };
