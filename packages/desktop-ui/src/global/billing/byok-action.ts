export const OPEN_MODEL_PICKER_EVENT = 'stella:open-model-picker'

export const openModelPickerAt = (provider?: string): void => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<{ provider?: string }>(OPEN_MODEL_PICKER_EVENT, {
      detail: provider ? { provider } : {},
    }),
  )
}

export const BYOK_TOAST_ACTION = {
  label: 'Use my own key',
  onClick: (): void => openModelPickerAt(),
} as const
