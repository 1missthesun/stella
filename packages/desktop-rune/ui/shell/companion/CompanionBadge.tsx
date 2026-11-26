import { useTokens } from "../../theme";

/** `.companion-badge`: the running-agent count on the mark's top-right. */
export function CompanionBadge({ count, label }: { count: number; label: string }) {
  const tokens = useTokens();
  return (
    <box
      absolute={{ top: 2, right: 0 }}
      minW={20}
      h={20}
      px={6}
      radius={10}
      center
      fill={tokens.c.primary}
      border={tokens.c.card}
      borderWidth={1.5}
      shadows={[{ x: 0, y: 1, blur: 4, color: "#00000040" }]}
      title={label}
      label={label}
      inert
      enter={{ opacity: 0, scale: 0.4, dur: 0.32, bounce: 0.35 }}
    >
      <text size={11} weight={650} lineHeight={11} features="'tnum' 1" color={tokens.c.primaryForeground}>
        {count > 99 ? "99+" : String(count)}
      </text>
    </box>
  );
}
