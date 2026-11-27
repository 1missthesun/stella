import { useNavigate } from "@tanstack/react-router";
import { useT } from "@/shared/i18n";
import { useChatComputer } from "../global/devices/use-devices";
import { APP_TRACKING } from "../kit/compat";
import { Icon, Icons } from "../kit";
import { radius, useTokens } from "../theme";

/** Above the composer of another computer's chat: whose chat this is, and that it waits while that computer is away. */
export function ComputerLinkNotice({ conversationId }: { conversationId: string | null }) {
  const t = useT();
  const tokens = useTokens();
  const navigate = useNavigate();
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
    <row w="full" justify="center" px={48} mb={10}>
      <row
        role="status"
        w="full"
        maxW={800}
        align="center"
        gap={10}
        py={away ? 10 : 7}
        pl={14}
        pr={8}
        radius={radius["2xl"]}
        border={tokens.c.border}
        fill={away ? tokens.c.surfaceInset : undefined}
      >
        <Icon icon={Icons.stella.Monitor} size={15} color={tokens.c.textWeak} />
        <text grow={1} shrink minW={0} size={12.5} lineHeight={18} tracking={APP_TRACKING} color={away ? tokens.c.textStrong : tokens.c.textWeak} maxLines={2} truncate>
          {text}
        </text>
        <box
          role="button"
          focusable
          cursor="pointer"
          px={10}
          h={26}
          center
          radius={radius.full}
          hoverFill={tokens.c.surfaceInset}
          label={t("devices.chat.back")}
          onPress={() => void navigate({ to: "/chat" as never, search: {} as never })}
        >
          <text size={12} weight={500} tracking={APP_TRACKING} color={tokens.c.textBase} nowrap>
            {t("devices.chat.back")}
          </text>
        </box>
      </row>
    </row>
  );
}
