import { promises as fs } from "node:fs";
import path from "node:path";

const GENERATED_SKILL_MARKERS = [
  "<!-- stella-connect-native-skill -->",
  "<!-- stella-connect-mcp-skill -->",
];

export const isGeneratedConnectorSkill = (skillMarkdown: string): boolean =>
  GENERATED_SKILL_MARKERS.some((marker) => skillMarkdown.includes(marker));

export const removeGeneratedConnectorSkills = async (
  stellaDataDir: string,
): Promise<string[]> => {
  const root = path.join(stellaDataDir, "skills");
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(root, entry.name);
    const content = await fs
      .readFile(path.join(skillDir, "SKILL.md"), "utf-8")
      .catch(() => null);
    if (!content || !isGeneratedConnectorSkill(content)) continue;
    await fs.rm(skillDir, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
};
