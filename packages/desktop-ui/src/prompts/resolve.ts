import { getPromptDefinition } from "./catalog"
import type { PromptId } from "./types"

export const getPromptTemplateText = <TId extends PromptId>(promptId: TId): string =>
  getPromptDefinition(promptId).defaultText
