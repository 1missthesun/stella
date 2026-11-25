import { useCallback, useState, type ReactNode } from "react";
import { respondToConnectorConnect, useConnectorConnectRequest } from "@/features/chat/connector-connect-store";
import { useCloudConnectRequestActions, useCurrentConversationConnectRequest } from "@/features/cloud/use-cloud-connector-connect";
import { openExternalUrl } from "@/platform/electron/open-external";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { Button } from "../kit/compat";
import { Icon, Icons } from "../kit";
import { derive, mixOklch, radius, useTokens } from "../theme";

type Phase = "offer" | "connecting" | "connected" | "error";

const NARROW_W = 600;

/** `.connector-connect-card`: centred over the composer at min(50rem, 100% − 96px), or the full width when compact. */
export function ConnectorCardFrame({
  compact,
  phase,
  iconUrl,
  title,
  sub,
  actions,
  checkGlyph,
}: {
  compact: boolean;
  phase: Phase;
  checkGlyph?: boolean;
  iconUrl?: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  const t = useTokens();
  const tile = derive(t, "connector-card-tile", (k) => mixOklch(k.c.foreground, 5, "transparent"));
  const [narrow, setNarrow] = useState(false);
  const iconSize = compact ? 14 : 16;
  const tileSize = compact ? 28 : 34;
  const icon =
    phase === "connected" || (checkGlyph && phase !== "error") ? (
      <Icon icon={Icons.stella.Check} size={iconSize} color={phase === "connected" ? t.colors.success : t.c.textWeak} />
    ) : phase === "error" ? (
      <Icon icon={Icons.stella.AlertCircle} size={iconSize} color={t.c.danger} />
    ) : iconUrl ? (
      <image src={iconUrl} w={compact ? 16 : 20} h={compact ? 16 : 20} fit="contain" />
    ) : (
      <Icon icon={Icons.stella.Globe} size={iconSize} color={t.c.textWeak} />
    );
  const card = (
    <row
      role="status"
      label={title}
      w="full"
      maxW={compact ? undefined : 800}
      align="center"
      wrap={compact}
      gap={compact ? 9 : 12}
      py={(compact ? 9 : 12) + 1}
      px={(compact ? 10 : 14) + 1}
      border={t.c.border}
      radius={compact ? radius.xl : radius["2xl"]}
      fill={t.c.surfaceInset}
      enter={{ opacity: 0, y: 6, dur: 0.2, bounce: 0 }}
    >
      <box w={tileSize} h={tileSize} radius={compact ? 8 : 10} border={t.c.border} fill={tile} clip={compact ? 8 : 10} center shrink={false}>
        {icon}
      </box>
      <col grow={1} minW={0}>
        <text
          size={compact ? 12.5 : 13}
          weight={600}
          color={t.c.textStrong}
          loop={phase === "connecting" ? { kind: "sequence", period: 1.6, frames: [{ at: 0, opacity: 1 }, { at: 0.5, opacity: 0.55 }, { at: 1, opacity: 1 }] } : undefined}
        >
          {title}
        </text>
        {sub ? (
          <text mt={2} size={compact ? 11.5 : 12.5} lineHeight={(compact ? 11.5 : 12.5) * 1.35} color={t.c.textWeak} maxLines={2} truncate>
            {sub}
          </text>
        ) : null}
      </col>
      {actions ? (
        <row align="center" gap={8} shrink={false} w={compact ? "full" : undefined} justify={compact ? "end" : undefined}>
          {actions}
        </row>
      ) : null}
    </row>
  );
  if (compact) return <col w="full" mb={8}>{card}</col>;
  return (
    <row w="full" justify="center" px={narrow ? 8 : 48} mb={10} onLayout={(r) => setNarrow(r.w < NARROW_W)}>
      {card}
    </row>
  );
}

export const ConnectorConnectCard = ({ compact = false, conversationId }: { compact?: boolean; conversationId?: string | null }) => {
  const t = useT();
  const request = useConnectorConnectRequest(conversationId);
  if (!request) return null;

  const isBrowserExtension = request.kind === "browser-extension";
  const sub =
    request.phase === "connecting"
      ? isBrowserExtension
        ? t("app.chat.connectorConnect.connectingExtension")
        : t("app.chat.connectorConnect.connectingApp", { name: request.name })
      : request.phase === "connected"
        ? isBrowserExtension
          ? t("app.chat.connectorConnect.connectedExtension")
          : t("app.chat.connectorConnect.connectedApp")
        : request.phase === "error"
          ? (request.message ?? t("app.chat.connectorConnect.errorBody", { name: request.name }))
          : (request.reason ?? request.description ?? undefined);

  const title =
    request.phase === "connected"
      ? t("app.chat.connectorConnect.titleConnected", { name: request.name })
      : request.phase === "connecting"
        ? t("app.chat.connectorConnect.titleWaiting", { name: request.name })
        : request.phase === "error"
          ? t("app.chat.connectorConnect.titleError", { name: request.name })
          : isBrowserExtension
            ? t("app.chat.connectorConnect.titleOfferExtension", { name: request.name })
            : t("app.chat.connectorConnect.titleOffer", { name: request.name });

  const actions =
    request.phase === "offer" ? (
      <>
        <Button type="button" variant="ghost" className="pill-btn connector-connect-card__decline" onClick={() => respondToConnectorConnect(request.requestId, "decline")}>
          {t("app.chat.connectorConnect.notNow")}
        </Button>
        <Button type="button" variant="primary" className="pill-btn pill-btn--primary connector-connect-card__accept" onClick={() => respondToConnectorConnect(request.requestId, "accept")}>
          {isBrowserExtension ? t("app.chat.connectorConnect.install") : t("app.chat.connectorConnect.connect")}
        </Button>
      </>
    ) : request.phase === "connecting" ? (
      <Button type="button" variant="ghost" className="pill-btn connector-connect-card__decline" onClick={() => respondToConnectorConnect(request.requestId, "cancel")}>
        {t("app.chat.connectorConnect.cancel")}
      </Button>
    ) : null;

  return <ConnectorCardFrame key={request.requestId} compact={compact} phase={request.phase} iconUrl={request.iconUrl} title={title} sub={sub} actions={actions} />;
};

export const CloudConnectorConnectCard = ({ compact = false, conversationId }: { compact?: boolean; conversationId?: string | null }) => {
  const t = useT();
  const request = useCurrentConversationConnectRequest(conversationId);
  const { decide } = useCloudConnectRequestActions();
  const [busy, setBusy] = useState<"connect" | "decline" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const answer = useCallback(
    async (decision: "connect" | "decline") => {
      if (!request || busy) return;
      setBusy(decision);
      setFailed(null);
      try {
        const outcome = await decide({ requestId: request.requestId, expectedRevision: request.revision, decision });
        if (decision === "connect" && outcome.url) openExternalUrl(outcome.url);
      } catch (error) {
        const message = error instanceof Error && error.message.trim() ? error.message : t("app.chat.connectorConnect.errorBody", { name: request.name });
        setFailed(message);
        showToast({ title: message, variant: "error" });
      } finally {
        setBusy(null);
      }
    },
    [busy, decide, request, t],
  );

  if (!request) return null;

  const connecting = request.state === "connecting";
  const phase: Phase = failed ? "error" : connecting ? "connecting" : "offer";
  const title = failed
    ? t("app.chat.connectorConnect.titleError", { name: request.name })
    : connecting
      ? t("app.chat.connectorConnect.titleWaiting", { name: request.name })
      : t("app.chat.connectorConnect.titleOffer", { name: request.name });
  const sub = failed ? failed : connecting ? t("app.chat.connectorConnect.connectingApp", { name: request.name }) : (request.reason ?? request.description);

  return (
    <ConnectorCardFrame
      key={request.requestId}
      compact={compact}
      phase={phase}
      checkGlyph={connecting}
      iconUrl={request.iconUrl}
      title={title}
      sub={sub}
      actions={
        <>
          <Button type="button" variant="ghost" className="pill-btn connector-connect-card__decline" disabled={Boolean(busy)} onClick={() => void answer("decline")}>
            {connecting ? t("app.chat.connectorConnect.cancel") : t("app.chat.connectorConnect.notNow")}
          </Button>
          {!connecting || failed ? (
            <Button type="button" variant="primary" className="pill-btn pill-btn--primary connector-connect-card__accept" disabled={Boolean(busy)} onClick={() => void answer("connect")}>
              {t("app.chat.connectorConnect.connect")}
            </Button>
          ) : null}
        </>
      }
    />
  );
};
