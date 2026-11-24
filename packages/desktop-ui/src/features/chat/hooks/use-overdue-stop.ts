import { useEffect, useState } from "react";
import { OVERDUE_TURN_MS } from "@stella/contracts/working-status";

export function useOverdueStop({
  working,
  messageId,
  stop,
}: {
  working: boolean;
  messageId: string | null;
  stop: () => void;
}): (() => void) | undefined {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (!working) return;
    const timer = window.setTimeout(() => setOverdue(true), OVERDUE_TURN_MS);
    return () => {
      window.clearTimeout(timer);
      setOverdue(false);
    };
  }, [working, messageId]);
  return overdue ? stop : undefined;
}
