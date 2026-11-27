import { useCallback, useEffect, useRef } from 'react'
import type { MessageMetadata } from '@/features/chat/lib/event-transforms'
import type { ChatContext } from '@/shared/types/electron'
import type { SendMessageArgs } from '@/features/chat/streaming/chat-types'
import type { StellaSendMessageDetail } from '@/shared/lib/stella-send-message'

const NO_OP = () => {}

type UseAgentInputRoutingOptions = {
  activeConversationId: string | null
  sendMessage: (args: SendMessageArgs) => Promise<boolean>
}

type UseAgentInputRoutingResult = {
  sendContextlessMessage: (
    text: string,
    metadata?: MessageMetadata,
  ) => Promise<boolean>
  sendAgentInputMessage: (
    detail: StellaSendMessageDetail,
    metadata?: MessageMetadata,
  ) => void
  sendMessageWithContext: (
    text: string,
    chatCtx?: ChatContext | null,
    selectedTextCtx?: string | null,
    onOptimisticStart?: () => void,
    metadata?: MessageMetadata,
  ) => Promise<boolean>
}

export function useAgentInputRouting({
  activeConversationId,
  sendMessage,
}: UseAgentInputRoutingOptions): UseAgentInputRoutingResult {
  const sendMessageRef = useRef(sendMessage)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  const sendContextlessMessage = useCallback(
    async (text: string, metadata?: MessageMetadata) => {
      return await sendMessageRef.current({
        text,
        selectedText: null,
        chatContext: null,
        onClear: NO_OP,
        metadata,
      })
    },
    [],
  )

  const sendAgentInputMessage = useCallback(
    (detail: StellaSendMessageDetail, metadata?: MessageMetadata) => {
      const threadId = detail.targetAgentId?.trim()
      if (
        !threadId ||
        !activeConversationId ||
        !window.electronAPI?.agent?.sendInput
      ) {
        void sendContextlessMessage(detail.text, metadata)
        return
      }
      void window.electronAPI.agent
        .sendInput({
          conversationId: activeConversationId,
          threadId,
          message: detail.text,
          ...(metadata ? { metadata } : {}),
        })
        .catch((error) => {
          console.error(
            'Failed to send routed agent input:',
            (error as Error).message,
          )
          void sendContextlessMessage(detail.text, metadata)
        })
    },
    [activeConversationId, sendContextlessMessage],
  )

  const sendMessageWithContext = useCallback(
    async (
      text: string,
      chatCtx?: ChatContext | null,
      selectedTextCtx?: string | null,
      onOptimisticStart?: () => void,
      metadata?: MessageMetadata,
    ) => {
      return await sendMessageRef.current({
        text,
        selectedText: selectedTextCtx ?? null,
        chatContext: chatCtx ?? null,
        onClear: NO_OP,
        onOptimisticStart,
        metadata,
      })
    },
    [],
  )

  return {
    sendContextlessMessage,
    sendAgentInputMessage,
    sendMessageWithContext,
  }
}
