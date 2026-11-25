import type { WindowSnapshot } from "../../host/electron/browser-window";

/** An app window other than the full shell, by its mode (companion, overlay, detached viewer). */
export function AuxWindow({ snapshot }: { snapshot: WindowSnapshot }) {
  return <col w="full" h="full" fill={snapshot.transparent ? undefined : snapshot.backgroundColor} />;
}
