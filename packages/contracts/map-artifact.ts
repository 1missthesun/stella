import {
  hasFields,
  isArrayOf,
  isFiniteNumber,
  isNonEmptyString,
  isOptional,
  isString,
  type UnknownRecord,
} from "./value-guards.js";

export type MapTravelMode = "driving" | "walking" | "cycling" | "transit";

export type MapArtifactMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  placeId?: string;
  rating?: number;
  ratingCount?: number;
  role?: "origin" | "destination" | "place";
};

export type MapArtifactRouteStep = {
  instruction: string;
  distanceMeters: number;
};

export type MapArtifactRoute = {
  mode: MapTravelMode;
  originId: string;
  destinationId: string;
  distanceMeters: number;
  durationSeconds: number;
  summary?: string;
  polyline: string;
  steps?: MapArtifactRouteStep[];
};

export type MapRouteArtifact = {
  kind: "map-route";
  version: 1;
  title?: string;
  markers: MapArtifactMarker[];
  route?: MapArtifactRoute;
};

export const MAPS_SITE_BASE_URL = "https://stella.sh";
export const MAPS_RESOLVE_PATH = "/api/maps/resolve";
export const MAPS_EMBED_PATH = "/maps/embed";

const isMarker = (value: unknown): value is UnknownRecord =>
  hasFields(value, {
    id: isString,
    name: isString,
    lat: isFiniteNumber,
    lng: isFiniteNumber,
  });

const isRoute = (value: unknown): value is UnknownRecord =>
  hasFields(value, {
    polyline: isNonEmptyString,
    distanceMeters: isFiniteNumber,
    durationSeconds: isFiniteNumber,
  });

export const isMapRouteArtifact = (
  value: unknown,
): value is MapRouteArtifact =>
  hasFields(value, {
    kind: (kind) => kind === "map-route",
    markers: isArrayOf(isMarker, 1),
    route: isOptional(isRoute),
  });

const toBase64Url = (json: string): string => {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const decodeMapArtifactParam = (
  param: string | null | undefined,
): MapRouteArtifact | null => {
  if (!param) return null;
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isMapRouteArtifact(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const mapsEmbedUrl = (
  artifact: MapRouteArtifact,
  options?: { mode?: "light" | "dark"; siteBaseUrl?: string },
): string => {
  const base = (options?.siteBaseUrl ?? MAPS_SITE_BASE_URL).replace(/\/+$/, "");
  let slim: MapRouteArtifact = artifact;
  if (artifact.route?.steps) {
    const { steps: _steps, ...route } = artifact.route;
    slim = { ...artifact, route };
  }
  const params = new URLSearchParams({ d: toBase64Url(JSON.stringify(slim)) });
  if (options?.mode) params.set("mode", options.mode);
  params.set("embedded", "1");
  return `${base}${MAPS_EMBED_PATH}?${params.toString()}`;
};

const APPLE_MAPS_DIRFLG: Record<MapTravelMode, string> = {
  driving: "d",
  walking: "w",
  cycling: "c",
  transit: "r",
};

export const appleMapsUrl = (artifact: MapRouteArtifact): string => {
  const params = new URLSearchParams();
  if (artifact.route) {
    const origin = artifact.markers.find(
      (marker) => marker.id === artifact.route?.originId,
    );
    const destination = artifact.markers.find(
      (marker) => marker.id === artifact.route?.destinationId,
    );
    if (origin && destination) {
      params.set("saddr", `${origin.lat},${origin.lng}`);
      params.set("daddr", `${destination.lat},${destination.lng}`);
      params.set("dirflg", APPLE_MAPS_DIRFLG[artifact.route.mode]);
      return `https://maps.apple.com/?${params.toString()}`;
    }
  }
  const first = artifact.markers[0];
  params.set("q", first?.name ?? "Location");
  if (first) params.set("ll", `${first.lat},${first.lng}`);
  return `https://maps.apple.com/?${params.toString()}`;
};
