import {
  renderStellaPrompt,
  stellaPromptTools,
} from "@stella/contracts/stella-prompts";

import { STELLA_PROMPT_DEFAULTS } from "./defaults.generated.js";

export const bundledPrompt = (id: string): string => {
  const prompt = STELLA_PROMPT_DEFAULTS.prompts.find(
    (candidate) => candidate.id === id,
  );
  if (!prompt) throw new Error(`Bundled prompt ${id} is missing.`);
  return prompt.content;
};

export const renderCloudAgentPrompt = (
  id: "agents/general.md",
  tools: Readonly<{ names: Iterable<string>; history: boolean }>,
): string =>
  renderStellaPrompt(bundledPrompt(id), {
    env: "cloud",
    tools: stellaPromptTools(tools.names, {
      history: tools.history,
      memory: false,
    }),
  });
