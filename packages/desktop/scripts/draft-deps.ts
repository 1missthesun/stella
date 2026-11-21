import path from "node:path";
import { prepareDraftDependencies } from "../electron/services/app-source/draft-deps.js";

const draftRoot = path.resolve(process.argv[2] ?? process.cwd());
const appRoot = path.resolve(process.env.STELLA_APP_DIR ?? path.join(import.meta.dirname, "..", "..", ".."));
if (draftRoot === appRoot) {
  console.error("That is the app checkout itself, not a draft.");
  process.exit(2);
}
const result = await prepareDraftDependencies({ draftRoot, appRoot, bun: process.execPath });
const said = {
  ready: "Dependencies are ready.",
  linked: "Linked the draft's packages.",
  installed: "Installed the packages for these dependencies once; later drafts with the same dependencies link them.",
};
console.log(`${said[result.mode]} (${result.ms} ms)`);
