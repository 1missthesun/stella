import {
  BYOK_TOAST_ACTION,
  OPEN_MODEL_PICKER_EVENT,
} from '@/global/billing/byok-action'
import type { ManagedModelAudience } from '@/global/billing/audience'
import {
  buildCapabilityRestrictionToast,
  readBillingAudience,
  resolveDeniedCapability,
  type Capability,
} from '@/global/billing/capabilities'
import { i18nFallback } from '@/shared/i18n/I18nProvider'
import { showToast, type ToastOptions } from '@/ui/toast'
import { planUsageDialog } from '@/global/billing/plan-usage-dialog-store'
import { detectLlmRouteFailureKind } from "@stella/contracts/llm-route-failure"
import {
  STELLA_USAGE_LIMIT_DESCRIPTIONS,
  STELLA_USAGE_LIMIT_TITLES,
} from '@stella/contracts/stella-usage-limit'
import {
  presentComposerNotice,
  type ComposerNoticeKind,
} from '@/features/chat/composer-notice-store'
import {
  classifyStellaProviderError,
  isStellaLimitOrAuthClassification,
  type StellaProviderErrorKind,
} from './stella-provider-error-classifier'

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string

export type StellaProviderErrorToastOptions = {
  audience?: ManagedModelAudience | null
  t?: Translate
}

const stripClaudeCodeMark = (message: string) =>
  message.replace(/^\s*\[claude-code\/[a-z-]+\]\s*/i, '').trim()

const claudeLoginEmailOf = (message: string): string | undefined =>
  /(?:login for|signed in to|Sign in to)\s+([^\s@]+@[^\s@]+?)(?=[.,;)]?(?:\s|$))/i.exec(
    message,
  )?.[1]

const openBilling = () => planUsageDialog.open()
const openSignInDialog = () => {
  void import('@/router').then(({ router }) => {
    void router.navigate({
      to: '.',
      search: (prev: { dialog?: 'auth' | 'connect' }) => ({
        ...prev,
        dialog: 'auth' as const,
      }),
    })
  })
}

const openModelPicker = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_MODEL_PICKER_EVENT))
}

const chooseModelAction = {
  label: 'Choose model',
  onClick: openModelPicker,
}

const connectProviderAction = {
  label: 'Connect a provider',
  onClick: openModelPicker,
}

const upgradeAction = {
  label: 'Upgrade',
  onClick: openBilling,
}

const signInAction = {
  label: 'Sign in',
  onClick: openSignInDialog,
}

export const isStellaLimitOrAuthReason = (
  reason: string | null | undefined,
): boolean =>
  isStellaLimitOrAuthClassification(classifyStellaProviderError(reason))

const resolveCapabilityToast = (
  capability: Capability | undefined,
  options: StellaProviderErrorToastOptions,
): ToastOptions | null => {
  if (!capability) return null
  const audience =
    options.audience === undefined ? readBillingAudience() : options.audience
  const restriction = resolveDeniedCapability(audience, capability)
  if (!restriction) return null
  return buildCapabilityRestrictionToast(restriction, options.t)
}

export const resolveStellaProviderErrorToast = (
  reason: string | null | undefined,
  options: StellaProviderErrorToastOptions = {},
): ToastOptions => {
  const t = options.t ?? ((key, params) => i18nFallback.t(key, params))
  const classification = classifyStellaProviderError(reason)
  const message = classification.message

  const routeFailureKind = detectLlmRouteFailureKind(message)
  if (routeFailureKind === 'missing-credential') {
    return {
      title: 'Provider key needed',
      description:
        'Stella could not use your selected model because its API key is missing or unreadable. Add or re-check it in Settings → Model, or pick another model.',
      variant: 'error',
      duration: 8000,
      action: chooseModelAction,
      secondaryAction: BYOK_TOAST_ACTION,
    }
  }
  if (
    routeFailureKind === 'unknown-model' ||
    routeFailureKind === 'unsupported-provider'
  ) {
    return {
      title: 'Model unavailable',
      description:
        'Stella could not use your selected model. Choose a different model to continue.',
      variant: 'error',
      duration: 8000,
      action: chooseModelAction,
    }
  }
  if (routeFailureKind === 'no-stella-route') {
    return {
      title: 'No model available',
      description:
        'Sign in to use Stella, or add your own provider key to keep going.',
      variant: 'error',
      duration: 8000,
      action: signInAction,
      secondaryAction: BYOK_TOAST_ACTION,
    }
  }

  switch (classification.kind) {
    case 'claude-code-login': {
      const email = claudeLoginEmailOf(message)
      return {
        title: 'Claude Code needs login',
        description: email
          ? `Claude Code needs to sign in to ${email} on this computer before Stella can use it.`
          : 'Claude Code needs to sign in on this computer before Stella can use it.',
        variant: 'error',
        duration: 10000,
      }
    }
    case 'claude-code-usage-limit':
      return {
        title: 'Claude usage limit reached',
        description:
          stripClaudeCodeMark(message) ||
          'Your Claude plan reached its usage limit. Try again after it resets.',
        variant: 'error',
        duration: 10000,
      }
    case 'sign-in-required':
      return {
        title: 'Stella models need a Stella account',
        description:
          'Sign in to use Stella models, or connect Claude Code, ChatGPT or an API key to keep going.',
        variant: 'error',
        duration: 8000,
        action: signInAction,
        secondaryAction: connectProviderAction,
      }
    case 'chatgpt-auth':
      return {
        title: 'Reconnect ChatGPT',
        description:
          'Your ChatGPT sign-in has expired. Reconnect it from the model picker, or choose another model.',
        variant: 'error',
        duration: 10000,
        action: chooseModelAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'chatgpt-usage-limit':
      return {
        title: 'ChatGPT usage limit reached',
        description:
          'Your ChatGPT Pro usage limit has been reached. Choose another model now, or try again after it resets.',
        variant: 'error',
        duration: 10000,
        action: chooseModelAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'capability-required': {
      const precise = resolveCapabilityToast(classification.capability, options)
      if (precise) return precise
      return {
        title: t('billing.capabilityRestriction.genericTitle'),
        description: t('billing.capabilityRestriction.genericDescription'),
        variant: 'error',
        duration: 8000,
        action: upgradeAction,
      }
    }
    case 'free-allowance-exhausted':
      return {
        title: STELLA_USAGE_LIMIT_TITLES.free_allowance,
        description: STELLA_USAGE_LIMIT_DESCRIPTIONS.free_allowance,
        variant: 'error',
        duration: 10000,
        action: upgradeAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'billing':
      return {
        title: STELLA_USAGE_LIMIT_TITLES.plan_limit,
        description: STELLA_USAGE_LIMIT_DESCRIPTIONS.plan_limit,
        variant: 'error',
        duration: 8000,
        action: upgradeAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'rate-limit':
      return {
        title: 'Model usage limit reached',
        description:
          'This model has reached a temporary usage limit. Choose another model or try again shortly.',
        variant: 'error',
        duration: 8000,
        action: chooseModelAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'account-auth':
      return {
        title: 'Please sign in again',
        description:
          'Stella needs you to reconnect your account before continuing.',
        variant: 'error',
        duration: 8000,
        action: signInAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'provider-access':
      return {
        title: 'Provider access needed',
        description:
          'Reconnect the selected provider or choose another model to continue.',
        variant: 'error',
        duration: 9000,
        action: chooseModelAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'model-restriction':
      return {
        title: 'Model not available on your plan',
        description:
          'Stella will use the recommended model for your current plan. Upgrade to switch models, or use your own provider key.',
        variant: 'error',
        duration: 8000,
        action: upgradeAction,
        secondaryAction: BYOK_TOAST_ACTION,
      }
    case 'context-limit':
      return {
        title: 'This chat is too long',
        description:
          'Start a new chat or remove some attachments, then try again.',
        variant: 'error',
        duration: 9000,
      }
    case 'content-blocked':
      return {
        title: 'The model could not answer that',
        description:
          'The model blocked this request. Try rewording it or choose another model.',
        variant: 'error',
        duration: 9000,
        action: chooseModelAction,
      }
    case 'timeout':
      return {
        title: 'The response timed out',
        description: 'The model took too long to respond. Please try again.',
        variant: 'error',
        duration: 8000,
      }
    case 'network':
      return {
        title: 'Stella could not connect',
        description: 'Check your internet connection and try again.',
        variant: 'error',
        duration: 8000,
      }
    case 'service-unavailable':
      return {
        title: 'Stella is having trouble connecting',
        description:
          'The model service is temporarily unavailable. Please try again in a moment.',
        variant: 'error',
        duration: 7000,
      }
    case 'malformed-request':
      return {
        title: 'Stella could not send that request',
        description:
          'Something about the request format was not accepted. Please try again.',
        variant: 'error',
        duration: 7000,
      }
    case 'unknown':
      return {
        title: 'Stella could not finish',
        description:
          classification.detail ??
          'Stella could not finish this response. Please try again.',
        variant: 'error',
        duration: 10000,
      }
  }
}

const COMPOSER_NOTICE_KIND_BY_ERROR: Partial<
  Record<StellaProviderErrorKind, ComposerNoticeKind>
> = {
  'sign-in-required': 'sign-in',
  'account-auth': 'sign-in',
  'claude-code-login': 'sign-in',
  'claude-code-usage-limit': 'limit',
  billing: 'upgrade',
  'free-allowance-exhausted': 'upgrade',
  'capability-required': 'upgrade',
  'model-restriction': 'upgrade',
  'rate-limit': 'limit',
  'chatgpt-usage-limit': 'limit',
  'chatgpt-auth': 'provider',
  'provider-access': 'provider',
}

export const resolveStellaProviderErrorNoticeKind = (
  reason: string | null | undefined,
): ComposerNoticeKind | null => {
  const classification = classifyStellaProviderError(reason)
  const routeFailureKind = detectLlmRouteFailureKind(classification.message)
  if (routeFailureKind === 'no-stella-route') return 'sign-in'
  if (
    routeFailureKind === 'missing-credential' ||
    routeFailureKind === 'unknown-model' ||
    routeFailureKind === 'unsupported-provider'
  ) {
    return 'provider'
  }
  return COMPOSER_NOTICE_KIND_BY_ERROR[classification.kind] ?? null
}

export const presentStellaProviderError = (
  reason: string | null | undefined,
  options: StellaProviderErrorToastOptions & {
    conversationId?: string | null
  } = {},
): void => {
  const toast = resolveStellaProviderErrorToast(reason, options)
  const kind = resolveStellaProviderErrorNoticeKind(reason)
  const classification = classifyStellaProviderError(reason)
  if (!kind) {
    showToast(toast)
    return
  }
  presentComposerNotice(
    {
      conversationId: options.conversationId ?? null,
      kind,
      title: toast.title ?? '',
      description: toast.description,
      action: toast.action,
      secondaryAction: toast.secondaryAction,
      ...(classification.kind === 'claude-code-login'
        ? { claudeSignIn: { email: claudeLoginEmailOf(classification.message) } }
        : {}),
    },
    toast,
  )
}
