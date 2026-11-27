// What a view can ask the phone for (`stella.*` in a view), in place of the browser's
// (web/views/capabilities.ts), whose name the shared web views host imports: the app's own fetch
// (no CORS here), clipboard, links, share sheet and haptics through the engine's app commands, the
// photo/file picker where the app has one, Stella's backend for `ask`, and the chat for `send`.
import type { ViewCapabilities } from "@stella/views/session";
import { STELLA_SEND_MESSAGE_EVENT, type StellaSendMessageDetail } from "@/shared/lib/stella-send-message";
import { VIEW_ASK_LIMITS } from "@stella/contracts/backend/views";
import { command, engine } from "../../../../../desktop-rune/host/bridge";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|0\.0\.0\.0)/iu;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_PICKED = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
/** How often one view may ask, on top of the backend's hourly limit per account. */
const ASK_PER_VIEW_PER_MINUTE = 10;
/** Where the phone is, by its IP address, when there is no location service yet (city-level). */
const IP_ACCURACY_M = 25_000;
const LOCATION_TTL_MS = 5 * 60_000;

const string = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
const platform = () => __native.env.platform;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

let lastLocation: { at: number; value: { latitude: number; longitude: number; accuracy: number } } | null = null;

async function ipLocation(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  if (lastLocation && Date.now() - lastLocation.at < LOCATION_TTL_MS) return lastLocation.value;
  const sources: Array<[string, (j: Record<string, unknown>) => [unknown, unknown]]> = [
    ["https://ipapi.co/json/", (j) => [j.latitude, j.longitude]],
    ["https://ipwho.is/", (j) => [j.latitude, j.longitude]],
  ];
  for (const [url, pick] of sources) {
    try {
      const response = await withTimeout(fetch(url), 8_000, "timeout");
      if (!response.ok) continue;
      const [lat, lon] = pick((await response.json()) as Record<string, unknown>);
      if (typeof lat === "number" && typeof lon === "number") {
        const value = { latitude: lat, longitude: lon, accuracy: IP_ACCURACY_M };
        lastLocation = { at: Date.now(), value };
        return value;
      }
    } catch {
      // The next source.
    }
  }
  return null;
}

export function browserCapabilities(_notice: (viewId: string, kind: "copied") => void): ViewCapabilities {
  const asked = new Map<string, number[]>();
  return {
    ask: async ([prompt, options], context) => {
      const text = string(prompt).trim();
      const system = string((options as { system?: unknown } | undefined)?.system ?? "").trim();
      if (!text) throw new Error("ask needs a prompt");
      if (text.length > VIEW_ASK_LIMITS.maxPromptChars) throw new Error(`ask takes up to ${VIEW_ASK_LIMITS.maxPromptChars / 1000}k characters of prompt`);
      if (system.length > VIEW_ASK_LIMITS.maxSystemChars) throw new Error(`ask takes up to ${VIEW_ASK_LIMITS.maxSystemChars / 1000}k characters of system prompt`);
      const at = performance.now();
      const recent = (asked.get(context.viewId) ?? []).filter((t) => at - t < 60_000);
      if (recent.length >= ASK_PER_VIEW_PER_MINUTE) throw new Error(`ask is limited to ${ASK_PER_VIEW_PER_MINUTE} calls a minute per view`);
      asked.set(context.viewId, [...recent, at]);
      // The phone has no model of its own: Stella's backend answers (owner-store `views.ask`).
      const { backendClient } = await import("@/platform/backend/backend-client");
      const reply = await backendClient.call("views.ask", { prompt: text, ...(system ? { system } : {}) }, { timeoutMs: VIEW_ASK_LIMITS.timeoutMs + 10_000 });
      return reply.text.trim();
    },
    fetch: async ([url, init]) => {
      const target = new URL(string(url));
      if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error(`fetch can reach only http(s) URLs, not ${target.protocol}`);
      if (PRIVATE_HOST.test(target.hostname)) throw new Error(`fetch can't reach ${target.hostname}: views reach only the public internet`);
      const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
      const response = await withTimeout(
        fetch(target.toString(), {
          method: options.method ?? "GET",
          ...(options.headers ? { headers: options.headers } : {}),
          ...(typeof options.body === "string" ? { body: options.body } : {}),
          redirect: "follow",
        }),
        FETCH_TIMEOUT_MS,
        `${target.host} didn't answer within 30 s`,
      );
      const body = await response.text();
      if (body.length > MAX_BODY) throw new Error("The response is bigger than 8 MB");
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: response.status, statusText: response.statusText, headers, url: response.url || target.toString(), body };
    },
    "clipboard.writeText": async ([text]) => {
      await engine.clipboard.writeText(string(text));
    },
    "clipboard.readText": async () => engine.request<string>("clipboard.readText"),
    openUrl: async ([url]) => {
      const target = new URL(string(url));
      if (!/^(https?|mailto|tel):$/u.test(target.protocol)) throw new Error(`openUrl opens web, mail and phone links, not ${target.protocol}`);
      command({ cmd: "shell.openExternal", url: target.toString() });
    },
    notify: async () => {
      throw new Error("Notifications from views aren't on this phone yet");
    },
    haptic: async ([kind]) => {
      command({ cmd: "haptic", kind: string(kind) || "light" });
    },
    share: async ([content]) => {
      const c = (content ?? {}) as { text?: string; url?: string; title?: string };
      const text = [c.title, c.text].filter(Boolean).map(string).join("\n");
      if (!text && !c.url) throw new Error("share needs text, a url or a title");
      command({ cmd: "share", ...(text ? { text } : {}), ...(c.url ? { url: string(c.url) } : {}) });
    },
    send: async ([text]) => {
      const message = string(text).trim();
      if (!message) return;
      const accepted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 10_000);
        window.dispatchEvent(
          new CustomEvent<StellaSendMessageDetail>(STELLA_SEND_MESSAGE_EVENT, {
            detail: {
              text: message,
              onResult: (ok) => {
                clearTimeout(timer);
                resolve(ok);
              },
            },
          }),
        );
      });
      if (!accepted) throw new Error("The chat didn't take the message");
    },
    saveFile: async ([name, content]) => {
      const fileName = string(name).split(/[\\/]/u).pop() || "file.txt";
      const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      const path = `${__native.env.documents}/${fileName}`;
      if (!__native.writeFile(path, text)) throw new Error(`Couldn't save ${fileName}`);
      // The share sheet is how a phone puts a file somewhere: Files, Drive, a message.
      if (platform() === "ios") command({ cmd: "share", path });
      return fileName;
    },
    pickFile: async () => {
      if (platform() !== "ios") throw new Error("Picking a file isn't on Android yet");
      const picked = await engine.dialog.openFile({});
      const path = picked?.[0];
      if (!path) return null;
      const bytes = __native.readFile(path);
      if (!bytes) return null;
      const text = new TextDecoder().decode(bytes.subarray(0, MAX_PICKED));
      return { name: path.split("/").pop() ?? "file", text };
    },
    location: async () => ipLocation(),
  };
}
