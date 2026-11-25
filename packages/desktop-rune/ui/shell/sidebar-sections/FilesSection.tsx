import type { ReactNode } from "react";

export function WorkList({ idleContent }: { section: string; embedded?: boolean; onPick?: () => void; idleContent?: ReactNode }) {
  return <>{idleContent}</>;
}
