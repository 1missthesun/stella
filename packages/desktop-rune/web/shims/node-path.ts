const norm = (parts: string[]) => {
  const out: string[] = [];
  for (const p of parts.join("/").split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out;
};
export const sep = "/";
export const delimiter = ":";
export const join = (...parts: string[]) => {
  const abs = parts[0]?.startsWith("/");
  return (abs ? "/" : "") + norm(parts).join("/") || ".";
};
export const resolve = (...parts: string[]) => "/" + norm(parts).join("/");
export const normalize = (p: string) => join(p);
export const isAbsolute = (p: string) => p.startsWith("/");
export const dirname = (p: string) => {
  const i = p.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? (i === 0 ? "/" : ".") : p.slice(0, i);
};
export const basename = (p: string, ext?: string) => {
  const b = p.replace(/\/+$/, "").split("/").pop() ?? "";
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
};
export const relative = (from: string, to: string) => {
  const a = norm([from]);
  const b = norm([to]);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
};
export const parse = (p: string) => ({ root: p.startsWith("/") ? "/" : "", dir: dirname(p), base: basename(p), ext: extname(p), name: basename(p, extname(p)) });
export const posix = { sep, delimiter, join, resolve, normalize, isAbsolute, dirname, basename, extname, relative, parse };
export const win32 = posix;
export default posix;
