import { OVERDUE_TURN_MS } from "@stella/contracts/working-status";
import { useEffect, useState } from "react";

export function useOverdueStop({
  working,
  messageId,
  stop,
}: {
  working: boolean;
  messageId: string | undefined;
  stop: (() => void) | undefined;
}): (() => void) | undefined {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (!working) return;
    const timer = setTimeout(() => setOverdue(true), OVERDUE_TURN_MS);
    return () => {
      clearTimeout(timer);
      setOverdue(false);
    };
  }, [working, messageId]);
  return overdue ? stop : undefined;
}
