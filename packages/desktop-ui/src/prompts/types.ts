type PromptTemplateValues = {
  "voice_orchestrator.base": undefined
  "voice_orchestrator.function_call_handoff": undefined
  "synthesis.profile.system": undefined
  "synthesis.profile.user": {
    signals: string
  }
  "synthesis.welcome_message.user": {
    coreMemory: string
  }
}

export type PromptId = keyof PromptTemplateValues

export type PromptDefinition<TId extends PromptId = PromptId> = {
  id: TId
  module: string
  title: string
  defaultText: string
}

export type PromptCatalog = {
  [TId in PromptId]: PromptDefinition<TId>
}
