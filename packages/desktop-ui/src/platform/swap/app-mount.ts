import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { captureDomStateNow, restoreDomState } from "@/platform/view-state/dom-state";
import type { SwapOutcome, SwapPayload } from "./swap-runtime";

const INPUT_EVENTS = ["keydown", "keyup", "pointerdown", "pointerup", "wheel", "compositionstart", "compositionend"];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });

/**
 * Renders the app and takes changed code without a page load: the new root
 * replaces the old one, the page is put back where the user was, and a root
 * that fails to render is replaced by the one that was showing.
 */
export const mountApp = (container: HTMLElement, initial: ComponentType) => {
  const runtime = globalThis.__stellaSwap;
  let shown = initial;
  let watching = false;
  const problems: string[] = [];
  const note = (error: unknown) => {
    if (watching) problems.push(messageOf(error));
  };
  const root = createRoot(container, {
    onCaughtError: (error, info) => {
      note(error);
      console.error(error, info.componentStack);
    },
    onUncaughtError: (error) => {
      note(error);
      reportError(error);
    },
  });
  root.render(createElement(initial));
  if (!runtime) return;

  const show = async (component: ComponentType, view: unknown): Promise<string | null> => {
    problems.length = 0;
    watching = true;
    try {
      flushSync(() => root.render(createElement(component)));
      await restoreDomState(view);
      await frames(2);
    } catch (error) {
      problems.push(messageOf(error));
    }
    watching = false;
    if (problems.length > 0) return problems[0]!;
    return document.querySelector(".error-boundary") ? "The app stopped with an error." : null;
  };

  let queue: Promise<unknown> = Promise.resolve();
  const apply = async (payload: SwapPayload): Promise<SwapOutcome> => {
    const before = payload.modules.map((url) => [url, runtime.versions.get(url)] as const);
    const restoreVersions = () => {
      for (const [url, version] of before) {
        if (version === undefined) runtime.versions.delete(url);
        else runtime.versions.set(url, version);
      }
    };
    for (const url of payload.modules) runtime.versions.set(url, payload.version);
    try {
      for (const url of payload.css) await import(/* @vite-ignore */ url);
      if (!payload.root) return { ok: true, swaps: runtime.swaps };
      const next = ((await import(/* @vite-ignore */ payload.root)) as { AppRoot?: unknown }).AppRoot;
      if (typeof next !== "function") throw new Error("The app root is missing.");
      const view = captureDomStateNow();
      const problem = await show(next as ComponentType, view);
      if (problem === null) {
        shown = next as ComponentType;
        runtime.swaps += 1;
        return { ok: true, swaps: runtime.swaps };
      }
      restoreVersions();
      await show(shown, view);
      return { ok: false, error: problem };
    } catch (error) {
      restoreVersions();
      return { ok: false, error: messageOf(error) };
    }
  };
  runtime.apply = (payload) => {
    const applied = queue.then(() => apply(payload));
    queue = applied;
    return applied;
  };

  let lastInput = performance.now();
  let held = 0;
  let composing = false;
  for (const name of INPUT_EVENTS) {
    window.addEventListener(
      name,
      (event) => {
        lastInput = performance.now();
        if (name === "pointerdown") held += 1;
        else if (name === "pointerup") held = Math.max(0, held - 1);
        else if (name === "compositionstart") composing = true;
        else if (name === "compositionend") composing = false;
        else if (name === "keyup" && !(event as KeyboardEvent).isComposing) composing = false;
      },
      { capture: true, passive: true },
    );
  }
  window.addEventListener("pointercancel", () => (held = 0), { capture: true, passive: true });
  window.addEventListener("blur", () => (held = 0));
  runtime.quietFor = () => (held > 0 || composing ? 0 : performance.now() - lastInput);
};
