import { Icon, Icons } from "./icons";

export type StellaCharacterProps = { size: number; state?: string; eyeColor?: string; paused?: boolean };

export function StellaCharacter({ size }: StellaCharacterProps) {
  return <Icon icon={Icons.mark.stellaSmall} size={size} />;
}
