export const MAP_TOOL_NAME = "map";

export const MAP_TOOL_DESCRIPTION =
  "Show an interactive map card in the chat: pinned places and/or a route, for where something is, places to go, or how to get somewhere. Geocoding, ratings and route times are resolved for you and come back as a summary to answer with; the card opens in Apple Maps.";


export const MAP_TOOL_WORKING_TEXT = "Mapping";

export const MAP_TOOL_SEARCH_TERMS = [
  "interactive map",
  "places and locations",
  "directions and routes",
  "restaurants coffee sights",
] as const;

export const MAP_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  description:
    "Show an interactive map card inline in the chat. Provide places to pin and/or origin+destination for a route.",
  properties: {
    places: {
      type: "array",
      items: { type: "string" },
      description:
        "Up to 8 places to pin, as natural queries — place names, addresses, or 'lat,lng' (e.g. 'Tartine Bakery San Francisco', '1 Ferry Building, SF'). Include the city/area when it isn't obvious from context.",
    },
    origin: {
      type: "string",
      description:
        "Route start, as a natural query. Requires destination. Combine with places to also pin stops along the way.",
    },
    destination: {
      type: "string",
      description: "Route end, as a natural query. Requires origin.",
    },
    mode: {
      type: "string",
      enum: ["driving", "walking", "cycling", "transit"],
      description: "Travel mode for the route. Defaults to driving.",
    },
    title: {
      type: "string",
      description:
        "Optional short card title (e.g. 'Coffee near the Ferry Building').",
    },
  },
};

export const MAP_TOOL_REPLAY = "safe" as const;
