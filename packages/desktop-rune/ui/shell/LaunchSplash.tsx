import { useState } from "react";
import { Icon, Icons } from "../kit";
import { font, look, useTokens } from "../theme";
import { useLaunchSplashPhase } from "./launch-splash";

const COLORS = {
  light: { bg: "#fdfdfb", fg: "#141413", btnBorder: "#0000002e", btnFill: "#0000000a", btnHover: "#00000014" },
  dark: { bg: "#0f0f0d", fg: "#f4f3ee", btnBorder: "#ffffff2e", btnFill: "#ffffff0f", btnHover: "#ffffff1f" },
};

const DOT_LOOP = (delay: number) => ({
  kind: "sequence" as const,
  period: 1.2,
  delay,
  frames: [
    { at: 0, opacity: 0.2, y: 0 },
    { at: 0.4, opacity: 1, y: -2 },
    { at: 0.8, opacity: 0.2, y: 0 },
    { at: 1, opacity: 0.2, y: 0 },
  ],
});

/** index.html's `#stella-launch`: the mark, the name and three dots, a restart after 8 s, faded out when the shell is live. */
export function LaunchSplash() {
  const t = useTokens();
  const phase = useLaunchSplashPhase();
  const [restarting, setRestarting] = useState(false);
  if (phase === "gone") return null;
  const c = t.dark ? COLORS.dark : COLORS.light;
  const name = look(26, 600, { em: -0.03, family: font.display });
  const hint = look(13, 400, { em: -0.03, family: font.sans });
  return (
    <col
      id="stella-launch"
      fixed
      absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
      center
      fill={c.bg}
      opacity={phase === "exiting" ? 0 : 1}
      motion={{ dur: 0.22 }}
      inert={phase !== "rescue"}
      label="Stella"
    >
      <col align="center" gap={10}>
        <box shadow={[14, 24, "#0000001a"]} radius={36}>
          <Icon icon={Icons.mark.stella} size={72} />
        </box>
        <text {...name} color={c.fg}>Stella</text>
        <row gap={4} mt={2} h={6} opacity={0.55} align="center">
          {[0, 0.18, 0.36].map((delay) => (
            <box key={delay} w={4} h={4} radius={2} fill={c.fg} loop={DOT_LOOP(delay)} />
          ))}
        </row>
        <col mt={28} align="center" gap={10} opacity={phase === "rescue" ? 1 : 0} motion={{ dur: 0.26 }}>
          <text {...hint} color={c.fg} opacity={0.6}>Taking longer than usual</text>
          <row gap={8}>
            <box
              id="stella-launch-restart"
              role="button"
              px={14}
              h={29}
              radius={999}
              center
              border={c.btnBorder}
              fill={c.btnFill}
              hover={c.btnHover}
              opacity={restarting ? 0.5 : 1}
              onPress={restarting ? undefined : () => {
                setRestarting(true);
                window.electronAPI?.ui.relaunch?.();
              }}
            >
              <text {...look(13, 500, { em: -0.03, family: font.sans })} color={c.fg}>Restart app</text>
            </box>
          </row>
        </col>
      </col>
    </col>
  );
}
