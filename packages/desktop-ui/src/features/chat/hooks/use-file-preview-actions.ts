import { useCallback, useState } from "react";
import { copyTextToClipboard } from "@/shared/lib/clipboard";

type UseFilePreviewActionsOptions = {
  sourcePath: string;
  suggestedName: string;
  copyText?: string;
};

export const useFilePreviewActions = ({
  sourcePath,
  suggestedName,
  copyText,
}: UseFilePreviewActionsOptions) => {
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    const result = await window.electronAPI?.system?.saveFileAs?.(
      sourcePath,
      suggestedName,
    );
    if (!result || result.canceled) return;
    setActionStatus(result.ok ? "Saved" : (result.error ?? "Could not save"));
  }, [sourcePath, suggestedName]);

  const handleCopy = useCallback(async () => {
    setActionStatus(
      (await copyTextToClipboard(copyText ?? sourcePath))
        ? "Copied"
        : "Could not copy",
    );
  }, [copyText, sourcePath]);

  return {
    actionStatus,
    handleSave,
    handleCopy,
  };
};
