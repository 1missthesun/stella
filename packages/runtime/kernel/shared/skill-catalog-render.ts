export type RenderedSkillCatalogEntry = {
  id: string;
  description: string;
  path: string;
  hasProgram: boolean;
};

export const SKILLS_DISPLAY_ROOT = "~/.stella/skills";

export const skillDisplayPath = (id: string): string =>
  `${SKILLS_DISPLAY_ROOT}/${id}/SKILL.md`;

export const renderInlineSkillCatalogBlock = (
  entries: readonly RenderedSkillCatalogEntry[],
): string => {
  const lines = ["<skills>", "## Skills"];

  if (entries.length === 0) {
    lines.push("- No saved skills yet.");
  } else {
    for (const entry of entries) {
      const suffix = entry.hasProgram
        ? " Includes optional `scripts/program.ts`."
        : "";
      lines.push(
        `- \`${entry.id}\` — ${entry.description} (path: ${entry.path})${suffix}`,
      );
    }
  }

  lines.push("</skills>");

  return lines.join("\n");
};
