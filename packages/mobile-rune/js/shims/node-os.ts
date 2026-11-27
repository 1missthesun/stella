/// <reference path="../natives.d.ts" />
// `node:os` on the phone: the web's stand-ins, with the phone's own home (its app data) and name.
import { platform, tmpdir } from "../../../desktop-rune/web/shims/node-misc";

export { platform, tmpdir };
export const homedir = () => __native.env.documents.replace(/\/Documents\/?$/, "");
export const hostname = () => __native.env.model || "phone";
export default { tmpdir, platform, homedir, hostname };
