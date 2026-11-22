import { getPromptTemplateText } from "./resolve";

export const getVoiceSessionPromptConfig = (): {
  basePrompt: string
  functionCallHandoffPrompt: string
} => ({
  basePrompt: getPromptTemplateText("voice_orchestrator.base").trim(),
  functionCallHandoffPrompt: getPromptTemplateText(
    "voice_orchestrator.function_call_handoff",
  ).trim(),
})
