import { useMemo, useState } from "react";
import { appleMapsUrl, mapsEmbedUrl, type MapRouteArtifact as MapArtifact } from "@stella/contracts/map-artifact";
import { useT, useTPlural } from "@/shared/i18n";
import { useSelfHostedServer } from "@/platform/backend/server-discovery";
import { Icon, Icons } from "../../kit";
import { APP_TRACKING } from "../../kit/compat";
import { derive, mixOklch, radius, useTokens } from "../../theme";
import { rune } from "../engine";

type Translate = ReturnType<typeof useT>;
type TranslatePlural = ReturnType<typeof useTPlural>;

const MODE_LABEL_KEYS = {
  driving: "app.chat.mapCard.modeDriving",
  walking: "app.chat.mapCard.modeWalking",
  cycling: "app.chat.mapCard.modeCycling",
  transit: "app.chat.mapCard.modeTransit",
} as const;

const formatDistance = (meters: number) => {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
};

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`;
};

const cardTitle = (map: MapArtifact, tPlural: TranslatePlural) => {
  if (map.title) return map.title;
  if (map.route) {
    const origin = map.markers.find((m) => m.id === map.route?.originId);
    const destination = map.markers.find((m) => m.id === map.route?.destinationId);
    if (origin && destination) return `${origin.name} → ${destination.name}`;
  }
  if (map.markers.length === 1) return map.markers[0]!.name;
  return tPlural("app.chat.mapCard.placesCount", map.markers.length);
};

const cardSummary = (map: MapArtifact, t: Translate, tPlural: TranslatePlural) => {
  if (map.route) return [t(MODE_LABEL_KEYS[map.route.mode]), formatDistance(map.route.distanceMeters), formatDuration(map.route.durationSeconds)].filter(Boolean).join(" · ");
  return tPlural("app.chat.mapCard.placesCount", map.markers.length);
};

const MapCard = ({ map }: { map: MapArtifact }) => {
  const t = useT();
  const tPlural = useTPlural();
  const tokens = useTokens();
  const [frameFailed, setFrameFailed] = useState(false);
  const selfHosted = useSelfHostedServer();
  const mode = tokens.dark ? "dark" : "light";
  const embedUrl = useMemo(() => mapsEmbedUrl(map, { mode, siteBaseUrl: import.meta.env.VITE_STELLA_WEB_URL?.trim() || undefined }), [map, mode]);
  const handoffUrl = useMemo(() => appleMapsUrl(map), [map]);
  const title = cardTitle(map, tPlural);
  const summary = cardSummary(map, t, tPlural);
  const look = derive(tokens, "map-route-card", (k) => ({ frame: mixOklch(k.c.foreground, 6, "transparent"), hover: mixOklch(k.c.foreground, 5, "transparent") }));
  const offline = (children: React.ReactNode) => (
    <row absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} center gap={6} role="status">
      {children}
    </row>
  );
  return (
    <col w="full" maxW={560} radius={radius["2xl"]} clip={radius["2xl"]} fill={tokens.c.surfaceInset} border={tokens.c.border}>
      <box w="full" h={selfHosted ? 72 : 280} fill={look.frame} mt={1} mx={1}>
        {selfHosted ? (
          offline(
            <text size={12.5} color={tokens.c.textWeak}>
              {map.markers.map((marker) => marker.name).join(" · ")}
            </text>,
          )
        ) : frameFailed ? (
          offline(
            <>
              <Icon icon={Icons.stella.AlertCircle} size={15} color={tokens.c.textWeak} />
              <text size={12.5} color={tokens.c.textWeak}>
                {t("app.chat.mapCard.previewFailed")}
              </text>
            </>,
          )
        ) : (
          <webview absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} corners={[radius["2xl"] - 1, radius["2xl"] - 1, 0, 0]} url={embedUrl} label={t("app.chat.mapCard.frameTitle", { title })} onError={() => setFrameFailed(true)} />
        )}
      </box>
      <row align="center" justify="between" gap={12} py={9} px={12 + 1} pb={9 + 1} borderSides={[1, 0, 0, 0]} border={tokens.c.border}>
        <row align="end" gap={8} minW={0} shrink>
          <text size={13} weight={600} tracking={APP_TRACKING} color={tokens.c.textStrong} title={title} minW={0} nowrap truncate>
            {title}
          </text>
          <text size={12} tracking={APP_TRACKING} color={tokens.c.textWeak} nowrap shrink={false}>
            {summary}
          </text>
        </row>
        <row
          role="link"
          focusable
          title={t("app.chat.mapCard.appleMapsTitle")}
          shrink={false}
          align="center"
          gap={5}
          py={4 + 1}
          px={10 + 1}
          radius={radius.full}
          border={tokens.c.border}
          hoverBorder={tokens.c.borderStrong}
          hoverFill={look.hover}
          hoverGroup
          focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
          onPress={() => void rune().shell.openExternal(handoffUrl)}
        >
          <text size={12} weight={500} tracking={APP_TRACKING} color={tokens.c.textWeak} hoverColor={tokens.c.textStrong}>
            {t("app.chat.mapCard.appleMapsLabel")}
          </text>
          <box hoverColor={tokens.c.textStrong}>
            <Icon icon={Icons.stella.ExternalLink} size={13} color={tokens.c.textWeak} />
          </box>
        </row>
      </row>
    </col>
  );
};

export const MapRouteCards = ({ cards }: { cards: { id: string; map: MapArtifact }[] }) => {
  if (cards.length === 0) return null;
  return (
    <col w="full" maxW="full" gap={10} mt={12}>
      {cards.map((card) => (
        <MapCard key={card.id} map={card.map} />
      ))}
    </col>
  );
};
