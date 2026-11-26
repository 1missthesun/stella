declare global {
  interface Window {
    __stellaStaticGreeting?: { kind: "time" } | { kind: "fun"; text: string };
    __stellaStaticHomeKeepInput?: (event: FocusEvent) => void;
    __stellaStaticHandoff?: { at: number; target: "home" | "chat" | "none"; chars: number; dx: number; dy: number; dw: number; dh: number };
  }
}

const SHELL_ID = "stella-static-home";
const COMPOSER = '#root [data-rid^="composer-input:"] > textarea';
const HOME_COMPOSER = `#root [data-rid="home-content"] [data-rid^="composer-input:"] > textarea`;
const CHAT_FALLBACK_MS = 1500;
const GIVE_UP_MS = 20_000;
const GUARD_MS = 15_000;
const SETTLED_MS = 2000;
const LEAVE_MS = 200;

const setNativeValue = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

const usable = (field: HTMLTextAreaElement) =>
  !field.disabled && !field.closest("[inert]") && field.checkVisibility({ opacityProperty: true, visibilityProperty: true });

const first = (selector: string) => [...document.querySelectorAll<HTMLTextAreaElement>(selector)].find(usable) ?? null;

/** Hands the pre-rendered home's draft, caret and focus to the app's composer once it is on screen (web/static-home/shell.html). */
export function adoptStaticHome(): void {
  const shell = document.getElementById(SHELL_ID);
  const draft = shell?.querySelector("textarea");
  if (!shell || !draft) return;
  const startedAt = performance.now();
  let chatSince: number | null = null;
  let renderedSince: number | null = null;
  let lastRect = "";

  const stopKeepingInput = () => {
    const keepInput = window.__stellaStaticHomeKeepInput;
    if (keepInput) document.removeEventListener("focusin", keepInput, true);
    window.__stellaStaticHomeKeepInput = undefined;
  };

  const release = () => {
    stopKeepingInput();
    shell.dataset.leaving = "true";
    window.setTimeout(() => shell.remove(), LEAVE_MS);
  };

  const place = (field: HTMLTextAreaElement, text: string, focused: boolean, start: number, end: number) => {
    if (text && !field.value.startsWith(text)) setNativeValue(field, text + field.value);
    if (!focused) return;
    field.focus({ preventScroll: true });
    try {
      field.setSelectionRange(start, end);
    } catch {
      field.setSelectionRange(field.value.length, field.value.length);
    }
  };

  const guard = (text: string, focused: boolean) => {
    let shadow = text;
    let lastWipe = performance.now();
    const until = performance.now() + GUARD_MS;
    const isComposer = (target: EventTarget | null): target is HTMLTextAreaElement => target instanceof HTMLTextAreaElement && target.matches(COMPOSER);
    const restore = (field: HTMLTextAreaElement) => {
      setNativeValue(field, shadow);
      lastWipe = performance.now();
      if (focused) {
        field.focus({ preventScroll: true });
        field.setSelectionRange(shadow.length, shadow.length);
      }
    };
    const onBeforeInput = (event: Event) => {
      if (isComposer(event.target) && shadow && event.target.value === "") restore(event.target);
    };
    const onInput = (event: Event) => {
      if (event.isTrusted && isComposer(event.target)) shadow = event.target.value;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isComposer(event.target) && event.key === "Enter" && !event.shiftKey && !event.isComposing) shadow = "";
    };
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("keydown", onKeyDown, true);
    const check = () => {
      const field = first(COMPOSER);
      if (field && shadow && field.value === "") restore(field);
      const active = document.activeElement;
      if (field && focused && (!active || active === document.body || (active instanceof HTMLTextAreaElement && !usable(active)))) {
        field.focus({ preventScroll: true });
        field.setSelectionRange(field.value.length, field.value.length);
      }
      if (!shadow || performance.now() - lastWipe > SETTLED_MS || performance.now() > until) {
        document.removeEventListener("beforeinput", onBeforeInput, true);
        document.removeEventListener("input", onInput, true);
        document.removeEventListener("keydown", onKeyDown, true);
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  };

  const handOff = (field: HTMLTextAreaElement, target: "home" | "chat") => {
    stopKeepingInput();
    const text = draft.value;
    const focused = document.activeElement === draft || shell.dataset.appFocused === "true";
    const from = draft.getBoundingClientRect();
    const to = field.getBoundingClientRect();
    window.__stellaStaticHandoff = { at: performance.now(), target, chars: text.length, dx: to.x - from.x, dy: to.y - from.y, dw: to.width - from.width, dh: to.height - from.height };
    place(field, text, focused, draft.selectionStart, draft.selectionEnd);
    release();
    if (text) guard(text, focused);
  };

  const wait = () => {
    if (!shell.isConnected) return;
    const home = first(HOME_COMPOSER);
    if (home) {
      const r = home.getBoundingClientRect();
      const rect = `${r.x},${r.y},${r.width},${r.height}`;
      if (rect === lastRect && r.width > 0) return handOff(home, "home");
      lastRect = rect;
      return void requestAnimationFrame(wait);
    }
    const chat = first(COMPOSER);
    chatSince = chat ? (chatSince ?? performance.now()) : null;
    if (chat && chatSince !== null && performance.now() - chatSince > CHAT_FALLBACK_MS) return handOff(chat, "chat");
    renderedSince = chat || !document.querySelector("#root [data-rid]") ? null : (renderedSince ?? performance.now());
    const elsewhere = renderedSince !== null && performance.now() - renderedSince > CHAT_FALLBACK_MS;
    if (elsewhere || performance.now() - startedAt > GIVE_UP_MS) {
      window.__stellaStaticHandoff = { at: performance.now(), target: "none", chars: draft.value.length, dx: 0, dy: 0, dw: 0, dh: 0 };
      release();
      return;
    }
    requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}
