import { sheet } from "../../theme";

export const useCompactConversation = sheet((c) => ({
  chatConversationSurface: { w: "full", minH: "full", justify: "end" },
  chatViewportRegion_chatConversationSurface: { grow: 1, shrink: true, minW: 0, minH: 0 },
  chatConversationSurface_eventListFallback: { gap: 8 },
  chatConversationSurface_eventItem: { radius: 0 },
  chatConversationSurface_eventItemUser: { fill: c.chatUserBubbleFill, radius: 14, maxW: "88%", w: "fit", color: c.chatUserBubbleText },
  chatConversationSurface_eventItemAssistant: { radius: 0, maxW: "full", w: "full" },
  chatConversationSurface_assistantMessageText: { fill: c.surfaceRaised, color: c.textStrong, border: c.border, radius: 14, maxW: "85%", w: "fit", shrink: true, minW: 0 },
  chatConversationSurface_eventItemAssistant_markdown_p: { mb: 8 },
  chatConversationSurface_eventItemAssistant_markdown_ul: { mt: 2.4, mb: 8 },
  chatConversationSurface_eventItemAssistant_markdown_ol: { mt: 2.4, mb: 8 },
  chatConversationSurface_eventItemAssistant_markdown_blockquote: { color: c.textBase },
}));
