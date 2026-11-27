import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import { attachPathsToContext } from "./attach-paths";

type UseFileDropOptions = {
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>;
  disabled?: boolean;
};

export type RuneDropHandlers = {
  onDropFiles: (paths: string[]) => void;
  onDropHover: (over: boolean) => void;
};

type UseFileDropReturn = {
  isDragOver: boolean;
  isWindowDragActive: boolean;
  dropHandlers: RuneDropHandlers;
};

export function useFileDrop({ setChatContext, disabled = false }: UseFileDropOptions): UseFileDropReturn {
  const [isDragOver, setIsDragOver] = useState(false);
  const onDropHover = useCallback((over: boolean) => setIsDragOver(!disabled && over), [disabled]);
  const onDropFiles = useCallback(
    (paths: string[]) => {
      setIsDragOver(false);
      if (disabled || paths.length === 0) return;
      void attachPathsToContext(paths, setChatContext);
    },
    [disabled, setChatContext],
  );
  return { isDragOver, isWindowDragActive: isDragOver, dropHandlers: { onDropFiles, onDropHover } };
}
