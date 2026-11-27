import { StellaCharacter as DomStellaCharacter } from "../../../../../desktop-ui/src/ui/stella-character/StellaCharacter";
import type { StellaCharacterProps } from "../../../../ui/kit/StellaCharacter";

export type { StellaCharacterProps };

export function StellaCharacter(props: StellaCharacterProps) {
  const px = props.size ?? 22;
  return (
    <box w={px} h={px} shrink={false} inert>
      <DomStellaCharacter {...props} handleRef={props.handleRef as never} />
    </box>
  );
}
