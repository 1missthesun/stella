import type { DisplayPayload } from "@stella/contracts/desktop/display-payload";
import type { MapRouteArtifact } from "@stella/contracts/map-artifact";
import type { OfficePreviewRef, OfficePreviewSnapshot } from "@stella/contracts/office-preview";
import type { DisplayFileSource } from "@/shared/hooks/display-file-source";
import type { ConnectorConnectCardRequest } from "@/features/chat/connector-connect-store";
import { CHAT_FIXTURE_START } from "./messages";

export const RESOURCES_FIXTURE_CONVERSATION = "fixture-resources";

export const RESOURCE_IMAGE_FILES = {
  "/fixture/reading-nook.jpg": "packages/mobile-screenshots/public/art/fox.jpg",
  "/fixture/tram-1.jpg": "packages/mobile-screenshots/public/art/tram.jpg",
  "/fixture/tram-2.jpg": "packages/mobile-screenshots/public/art/table.jpg",
} as const;

export const RESOURCE_PDF_PATH = "/fixture/lisbon-itinerary.pdf";

type MediaPayload = Extract<DisplayPayload, { kind: "media" }>;

const image = (filePaths: string[], extra: Partial<MediaPayload>): MediaPayload => ({
  kind: "media",
  asset: { kind: "image", filePaths },
  presentation: "inline-image",
  createdAt: CHAT_FIXTURE_START,
  ...extra,
});

export const RESOURCE_SINGLE_IMAGE: MediaPayload[] = [
  image(["/fixture/reading-nook.jpg"], { prompt: "A cozy reading nook by a rainy window", requestedSize: { width: 1024, height: 768 }, generationState: "completed" }),
];

export const RESOURCE_IMAGE_STRIP: MediaPayload[] = [
  image(["/fixture/tram-1.jpg", "/fixture/tram-2.jpg"], { prompt: "Lisbon tram at dusk", numImages: 2, generationState: "completed", createdAt: CHAT_FIXTURE_START + 1 }),
];

export const RESOURCE_PENDING_IMAGE: MediaPayload[] = [image([], { prompt: "A lighthouse in fog", aspectRatio: "16:9", generationState: "running", createdAt: CHAT_FIXTURE_START + 2 })];

const encodeValue = (value: number) => {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
};

const encodePolyline = (points: [number, number][]) => {
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const [pLat, pLng] of points) {
    const nLat = Math.round(pLat * 1e5);
    const nLng = Math.round(pLng * 1e5);
    out += encodeValue(nLat - lat) + encodeValue(nLng - lng);
    lat = nLat;
    lng = nLng;
  }
  return out;
};

export const RESOURCE_MAP: { id: string; map: MapRouteArtifact }[] = [
  {
    id: "fixture-map",
    map: {
      kind: "map-route",
      version: 1,
      markers: [
        { id: "rossio", name: "Rossio", lat: 38.7139, lng: -9.1394, role: "origin" },
        { id: "belem", name: "Belém Tower", lat: 38.6916, lng: -9.216, role: "destination" },
      ],
      route: {
        mode: "walking",
        originId: "rossio",
        destinationId: "belem",
        distanceMeters: 7400,
        durationSeconds: 5640,
        polyline: encodePolyline([
          [38.7139, -9.1394],
          [38.7075, -9.1365],
          [38.7051, -9.1445],
          [38.7038, -9.1612],
          [38.6995, -9.1802],
          [38.6967, -9.1989],
          [38.6916, -9.216],
        ]),
      },
    },
  },
];

export const RESOURCE_SOURCE_DIFF_ONE: DisplayPayload[] = [
  { kind: "source-diff", filePath: "/Users/fixture/projects/site/src/pages/index.tsx", patch: "@@ -1,3 +1,3 @@\n-old\n+new\n", createdAt: CHAT_FIXTURE_START },
];

export const RESOURCE_SOURCE_DIFF_MANY: DisplayPayload[] = [
  { kind: "source-diff", filePath: "/Users/fixture/projects/site/src/pages/index.tsx", patch: "@@ -1 +1 @@\n-a\n+b\n", createdAt: CHAT_FIXTURE_START },
  { kind: "source-diff", filePath: "/Users/fixture/projects/site/src/styles/theme.css", patch: "@@ -1 +1 @@\n-a\n+b\n", createdAt: CHAT_FIXTURE_START },
  { kind: "source-diff", filePath: "/Users/fixture/projects/site/README.md", patch: "@@ -1 +1 @@\n-a\n+b\n", createdAt: CHAT_FIXTURE_START },
];

export const RESOURCE_OFFICE_REF: OfficePreviewRef = { sessionId: "fixture-office", title: "Lisbon trip budget.docx", sourcePath: "/Users/fixture/Documents/Lisbon trip budget.docx" };

const OFFICE_HTML = `<!doctype html><html><head><style>
body{margin:0;padding:28px 36px;font:14px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#1f2328;background:#fff}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 12px;color:#444}
table{border-collapse:collapse;width:100%;margin-top:8px}td,th{border:1px solid #d0d7de;padding:6px 10px;text-align:left}th{background:#f6f8fa}
</style></head><body><h1>Lisbon trip budget</h1><p>Two people, four nights in late March.</p>
<table><tr><th>Item</th><th>Cost</th></tr><tr><td>Flights</td><td>€420</td></tr><tr><td>Hotel in Chiado</td><td>€560</td></tr><tr><td>Food and transport</td><td>€310</td></tr><tr><th>Total</th><th>€1,290</th></tr></table></body></html>`;

export const RESOURCE_OFFICE_SNAPSHOT: OfficePreviewSnapshot = {
  ...RESOURCE_OFFICE_REF,
  format: "docx",
  startedAt: CHAT_FIXTURE_START,
  updatedAt: CHAT_FIXTURE_START + 4 * 60_000,
  status: "ready",
  html: OFFICE_HTML,
};

export const RESOURCE_CONNECT_REQUEST: ConnectorConnectCardRequest = {
  requestId: "fixture-connect",
  id: "notion",
  name: "Notion",
  reason: "Stella needs Notion to read your trip notes.",
  conversationId: RESOURCES_FIXTURE_CONVERSATION,
  phase: "offer",
};

const pdfBytes = (lines: string[]) => {
  const text = lines.map((line, index) => `BT /F1 ${index === 0 ? 20 : 12} Tf 56 ${740 - index * 26} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

const RESOURCE_PDF = pdfBytes(["Lisbon itinerary", "Day 1: Alfama, Sao Jorge Castle, fado dinner", "Day 2: Belem Tower, pasteis de nata, MAAT", "Day 3: Sintra day trip, Pena Palace", "Day 4: LX Factory, sunset at Miradouro"]);

/** `readRepoFile` takes a path relative to the repo root. */
export const resourceFileSource = (readRepoFile: (repoPath: string) => Promise<Uint8Array>): DisplayFileSource => ({
  key: RESOURCES_FIXTURE_CONVERSATION,
  read: async (path) => {
    if (path === RESOURCE_PDF_PATH) return { bytes: RESOURCE_PDF, mimeType: "application/pdf" };
    const repoPath = RESOURCE_IMAGE_FILES[path as keyof typeof RESOURCE_IMAGE_FILES];
    if (!repoPath) throw new Error(`No fixture file at ${path}`);
    return { bytes: await readRepoFile(repoPath), mimeType: "image/jpeg" };
  },
});

/** Stands in for the main-process events the connector and office preview stores read. */
export function installResourceStubs() {
  const target = window as unknown as { electronAPI?: Record<string, unknown> };
  const api = (target.electronAPI ??= {});
  api.theme ??= {};
  const system = (api.system ??= {}) as Record<string, unknown>;
  system.onConnectorConnectRequest = (listener: (event: unknown, data: Omit<ConnectorConnectCardRequest, "phase">) => void) => {
    const { phase: _phase, ...request } = RESOURCE_CONNECT_REQUEST;
    listener(null, request);
    return () => {};
  };
  system.onConnectorConnectUpdate = () => () => {};
  system.respondConnectorConnect = async () => {};
  api.officePreview = { list: async () => [RESOURCE_OFFICE_SNAPSHOT], onUpdate: () => () => {} };
}
