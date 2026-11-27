// The phone's stand-in for desktop-rune/ui/chat/ComputerLinkNotice.tsx: the same notice above the
// composer of a computer's chat (whose chat this is, and that it waits while that computer is
// away), at the phone's width, and its action leaves the computer for the phone's own Stella.
import { useT } from "@/shared/i18n";
import { useChatComputer } from "../../../../../desktop-rune/ui/global/devices/use-devices";
import { APP_TRACKING } from "../../../../../desktop-rune/ui/kit/compat";
import { Icon, Icons } from "../../../../../desktop-rune/ui/kit";
import { radius, useTokens } from "../../../../../desktop-rune/ui/theme";
import { computerMode } from "../../../../ui/computer/computer-mode";

export function ComputerLinkNotice({ conversationId }: { conversationId: string | null }) {
  const t = useT();
  const tokens = useTokens();
  const computer = useChatComputer(conversationId);
  if (!computer) return null;

  const state = computer.link.state;
  const away = state !== "online";
  const gone = state === "revoked" || state === "not_paired";
  const text = gone
    ? t("devices.chat.unpaired", { name: computer.name })
    : away
      ? state === "offline"
        ? t("devices.chat.offline", { name: computer.name })
        : t("devices.chat.connecting", { name: computer.name })
      : t("devices.computerChat", { name: computer.name });

  return (
    <row id="phone-computer-notice" w="full" justify="center" px={8} mb={8}>
      <row
        role="status"
        w="full"
        align="center"
        gap={10}
        py={away ? 10 : 7}
        pl={14}
        pr={6}
        radius={radius["2xl"]}
        border={tokens.c.border}
        fill={away ? tokens.c.surfaceInset : undefined}
      >
        <Icon icon={Icons.stella.Monitor} size={15} color={tokens.c.textWeak} />
        <text grow={1} shrink minW={0} size={13} lineHeight={18} tracking={APP_TRACKING} color={away ? tokens.c.textStrong : tokens.c.textWeak} maxLines={2} truncate>
          {text}
        </text>
        <box
          id="phone-computer-leave"
          role="button"
          focusable
          px={12}
          h={30}
          center
          radius={radius.full}
          pressFill={tokens.c.surfaceInset}
          label={t("mobile.p2p.leave")}
          onPress={() => void computerMode.leave()}
        >
          <text size={13} weight={500} tracking={APP_TRACKING} color={tokens.c.textBase} nowrap>
            {t("mobile.p2p.leave")}
          </text>
        </box>
      </row>
    </row>
  );
}
