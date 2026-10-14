export function resolveComposerExpanded({
  expanded,
  dictationBelow,
  modelPickerPinned,
  hasAttachments = false,
  hasQuotes = false,
}: {
  expanded: boolean;
  dictationBelow: boolean;
  modelPickerPinned: boolean;
  hasAttachments?: boolean;
  hasQuotes?: boolean;
}): boolean {
  return (
    expanded ||
    dictationBelow ||
    hasAttachments ||
    hasQuotes ||
    modelPickerPinned
  );
}
