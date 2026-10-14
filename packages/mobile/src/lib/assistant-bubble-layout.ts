export function assistantBubbleNeedsBoundedWidth(text: string): boolean {
  return /^(?: {0,3}(?:[-+*]\s|\d+[.)]\s|`{3,}|~{3,}|#{1,6}\s|>|(?:[-*_][ \t]*){3,}$)| {4}\S|\t\S)/m.test(text)
    || /^.*\|.*\n[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*\|/m.test(text);
}
