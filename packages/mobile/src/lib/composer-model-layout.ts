export function resolveComposerExpanded({
  expanded,
  dictationBelow,
  modelPickerPinned,
  hasAttachments = false,
  hasQuotes = false,
}: {
  expanded: boolean;
  /**
   * Dictation running: the waveform row sits under the text area, so the
   * shell needs the expanded (rounded rectangle) shape rather than a pill
   * that would stretch to fit both.
   */
  dictationBelow: boolean;
  modelPickerPinned: boolean;
  /**
   * Attachments render inside the composer above the text, so the shell
   * takes its expanded (toolbar) shape whenever any are pending.
   */
  hasAttachments?: boolean;
  /**
   * A pending reply quote sits inside the composer above the text, and the
   * expanded toolbar keeps the mic beside send while it is there.
   */
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
