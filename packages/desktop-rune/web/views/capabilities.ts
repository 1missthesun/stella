// What a view can ask the browser for (`stella.*` in a view), as the desktop's capabilities
// (host/views/views-host.ts) do with the engine: the browser's fetch, clipboard, new tabs,
// notifications, downloads and file picker, the Web Share sheet and geolocation, and the chat.
import type { ViewCapabilities } from "@stella/views/session";
import { STELLA_SEND_MESSAGE_EVENT, type StellaSendMessageDetail } from "@/shared/lib/stella-send-message";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|0\.0\.0\.0)/iu;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_PICKED = 4 * 1024 * 1024;

const string = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));

function pick(accept: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept.length) input.accept = accept.map((a) => (a.includes("/") || a.startsWith(".") ? a : `.${a}`)).join(",");
    input.style.display = "none";
    let settled = false;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.onchange = () => done(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export function browserCapabilities(): ViewCapabilities {
  return {
    fetch: async ([url, init]) => {
      const target = new URL(string(url));
      if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error(`fetch can reach only http(s) URLs, not ${target.protocol}`);
      if (PRIVATE_HOST.test(target.hostname)) throw new Error(`fetch can't reach ${target.hostname}: views reach only the public internet`);
      const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
      let response: Response;
      try {
        response = await fetch(target, {
          method: options.method ?? "GET",
          ...(options.headers ? { headers: options.headers } : {}),
          ...(typeof options.body === "string" ? { body: options.body } : {}),
          redirect: "follow",
          credentials: "omit",
          signal: AbortSignal.timeout(30_000),
        });
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "TimeoutError") throw new Error(`${target.host} didn't answer within 30 s`);
        // The browser hides why; almost always the site doesn't allow other sites' pages to read it (CORS).
        throw new Error(`The browser couldn't reach ${target.host}, or ${target.host} doesn't let web pages read it (CORS)`);
      }
      const body = await response.text();
      if (body.length > MAX_BODY) throw new Error("The response is bigger than 8 MB");
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: response.status, statusText: response.statusText, headers, url: response.url, body };
    },
    "clipboard.writeText": async ([text]) => {
      await navigator.clipboard.writeText(string(text));
    },
    "clipboard.readText": async () => navigator.clipboard.readText(),
    openUrl: async ([url]) => {
      const target = new URL(string(url));
      if (!/^(https?|mailto|tel):$/u.test(target.protocol)) throw new Error(`openUrl opens web, mail and phone links, not ${target.protocol}`);
      if (target.protocol === "mailto:" || target.protocol === "tel:") window.location.href = target.toString();
      else window.open(target.toString(), "_blank", "noopener,noreferrer");
    },
    notify: async ([title, options], context) => {
      if (typeof Notification === "undefined") throw new Error("This browser doesn't show notifications");
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission !== "granted") throw new Error("Notifications are off for Stella in this browser");
      const body = (options as { body?: string } | undefined)?.body;
      const note = new Notification(string(title) || context.title, { ...(body ? { body } : {}), tag: `view-${context.viewId}` });
      note.onclick = () => window.focus();
    },
    haptic: async () => {
      navigator.vibrate?.(10);
    },
    share: async ([content]) => {
      const c = (content ?? {}) as { text?: string; url?: string; title?: string };
      const data = { ...(c.title ? { title: string(c.title) } : {}), ...(c.text ? { text: string(c.text) } : {}), ...(c.url ? { url: string(c.url) } : {}) };
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        try {
          await navigator.share(data);
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          throw caught;
        }
        return;
      }
      // No share sheet (most desktop browsers): copy what would have been shared.
      await navigator.clipboard.writeText([data.title, data.text, data.url].filter(Boolean).join("\n"));
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
      const fileName = string(name).split(/[\\/]/u).pop() || "download";
      const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      // A download has no path the view could use; its name is what the user sees.
      return fileName;
    },
    pickFile: async ([options]) => {
      const accept = Array.isArray((options as { accept?: unknown } | undefined)?.accept) ? ((options as { accept: unknown[] }).accept.map(string)) : [];
      const file = await pick(accept);
      if (!file) return null;
      const text = await file.slice(0, MAX_PICKED).text();
      return { name: file.name, text };
    },
    location: async () => {
      if (!navigator.geolocation) return null;
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
          () => resolve(null),
          { timeout: 15_000, maximumAge: 60_000 },
        );
      });
    },
  };
}
