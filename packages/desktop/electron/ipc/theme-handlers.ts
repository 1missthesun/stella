import { promises as fs } from "node:fs";
import path from "node:path";
import { IPC_THEME_LIST_INSTALLED } from "@stella/contracts/desktop/ipc-channels";
import { handleIpc } from "./typed-ipc.js";

const listInstalledThemes = async (stellaDataDir: string) => {
  const themesDir = path.join(stellaDataDir, "themes");
  try {
    const files = await fs.readdir(themesDir);
    const themes: unknown[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(themesDir, file), "utf-8");
        themes.push(JSON.parse(raw) as unknown);
      } catch {
        // One malformed theme file must not hide the user's other themes.
      }
    }
    return themes;
  } catch {
    return [];
  }
};

export const registerThemeHandlers = (options: {
  getStellaDataDir: () => string | null;
}) => {
  handleIpc(IPC_THEME_LIST_INSTALLED, async () => {
    const stellaDataDir = options.getStellaDataDir();
    return stellaDataDir ? await listInstalledThemes(stellaDataDir) : [];
  });
};
