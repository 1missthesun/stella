// What a view can ask the browser for (`stella.*` in a view), as the desktop's capabilities
// (host/views/views-host.ts) do with the engine: the browser's fetch, clipboard, new tabs,
// notifications, downloads and file picker, the Web Share sheet and geolocation, and the chat.
import type { ViewCapabilities } from "@stella/views/session";
import { requireViewOpenableUrl } from "@stella/views/links";
import { mayBePublicHost } from "@stella/views/network";
import { STELLA_SEND_MESSAGE_EVENT, type StellaSendMessageDetail } from "@/shared/lib/stella-send-message";
import { VIEW_ASK_LIMITS, VIEW_SEND_TRIGGER } from "@stella/contracts/backend/views";

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

/** How often one view may ask, on top of the backend's hourly limit per account. */
const ASK_PER_VIEW_PER_MINUTE = 10;

export function browserCapabilities(notice: (viewId: string, kind: "copied") => void): ViewCapabilities {
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
      // The web has no model of its own: Stella's backend answers (owner-store `views.ask`).
      const { backendClient } = await import("@/platform/backend/backend-client");
      const reply = await backendClient.call("views.ask", { prompt: text, ...(system ? { system } : {}) }, { timeoutMs: VIEW_ASK_LIMITS.timeoutMs + 10_000 });
      return reply.text.trim();
    },
    fetch: async ([url, init]) => {
      const target = new URL(string(url));
      if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error(`fetch can reach only http(s) URLs, not ${target.protocol}`);
      // A page can't see where a name resolves: the browser's own private-network rules and CORS cover the rest.
      if (!mayBePublicHost(target.hostname)) throw new Error(`fetch can't reach ${target.hostname}: views reach only the public internet`);
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
      const target = requireViewOpenableUrl(url);
      if (!target.protocol.startsWith("http")) window.location.href = target.toString();
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
    share: async ([content], context) => {
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
      const text = [data.title, data.text, data.url].filter(Boolean).join("\n");
      if (!text) throw new Error("share needs text, a url or a title");
      await navigator.clipboard.writeText(text);
      notice(context.viewId, "copied");
    },
    send: async ([text], context) => {
      const message = string(text).trim();
      if (!message) return;
      const accepted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 10_000);
        window.dispatchEvent(
          new CustomEvent<StellaSendMessageDetail>(STELLA_SEND_MESSAGE_EVENT, {
            detail: {
              text: message,
              triggerKind: VIEW_SEND_TRIGGER,
              triggerSource: context.title,
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
