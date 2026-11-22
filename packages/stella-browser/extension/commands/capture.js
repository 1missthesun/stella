import { getActiveTab } from "./tabs.js";
import {
  setRefMap,
  resolveSelector,
  buildResolvedElementMatcherScript,
  buildTopLevelRectSource,
} from "../lib/selector.js";
import { captureFrameSnapshot } from "../lib/frame-snapshot.js";
import { callExactElement, exactElementPoint } from "../lib/frame-elements.js";
import { ensureDebugger, evaluateRuntime } from "../lib/debugger.js";
import { takeAnsweredDialogs } from "../lib/dialogs.js";

function buildElementExpression(selector, ownerId, tabId, onFoundSource) {
  const resolved = resolveSelector(selector, ownerId, tabId);
  const finder = buildResolvedElementMatcherScript(resolved);
  return `(() => { const el = ${finder.trim()}; ${onFoundSource} })()`;
}

async function getSelectorClip(tabId, selector, ownerId) {
  const resolved = resolveSelector(selector, ownerId, tabId);
  if (resolved.exactNode) {
    const box = await exactElementPoint(tabId, resolved, {
      boxOnly: true,
      scroll: true,
    });
    const scroll = await evaluateRuntime(tabId, "({x:scrollX,y:scrollY})");
    return {
      x: box.left + scroll.x,
      y: box.top + scroll.y,
      width: box.width,
      height: box.height,
      scale: 1,
    };
  }
  const clip = await evaluateRuntime(
    tabId,
    buildElementExpression(
      selector,
      ownerId,
      tabId,
      `
        if (!el) return null;
        const ancestorFrames = [];
        let ancestorWindow = el.ownerDocument?.defaultView;
        while (ancestorWindow && ancestorWindow !== ancestorWindow.top) {
          let frameElement;
          try { frameElement = ancestorWindow.frameElement; } catch (_) { frameElement = null; }
          if (!frameElement) return null;
          ancestorFrames.push(frameElement);
          ancestorWindow = frameElement.ownerDocument?.defaultView;
        }
        for (const frameElement of ancestorFrames.reverse()) {
          frameElement.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        ${buildTopLevelRectSource("el")}
        if (!localRect.width || !localRect.height) return null;
        const topWindow = currentWindow || window.top;
        return {
          x: topX + topWindow.scrollX,
          y: topY + topWindow.scrollY,
          width: localRect.width,
          height: localRect.height,
          scale: 1,
        };
      `,
    ),
  );

  if (!clip) {
    throw new Error(`Selector not found or not visible: ${selector}`);
  }

  return clip;
}

export async function handleScreenshot(command) {
  const tab = await getActiveTab(command);
  if (command.path) {
    throw new Error(
      "Custom screenshot paths are not supported in extension mode",
    );
  }

  const format = command.format || "jpeg";
  const quality = command.quality ?? (format === "jpeg" ? 60 : undefined);
  /** @type {Record<string, unknown>} */
  const params = {
    format,
    captureBeyondViewport: Boolean(command.fullPage || command.selector),
  };
  if (format === "jpeg") {
    params.quality = quality;
  }

  await ensureDebugger(tab.id);

  if (command.fullPage) {
    const metrics = await chrome.debugger.sendCommand(
      { tabId: tab.id },
      "Page.getLayoutMetrics",
    );
    const contentSize = metrics.contentSize;
    params.clip = {
      x: 0,
      y: 0,
      width: contentSize.width,
      height: contentSize.height,
      scale: 1,
    };
  } else if (command.selector) {
    params.clip = await getSelectorClip(
      tab.id,
      command.selector,
      command.ownerId,
    );
  }

  const result = await chrome.debugger.sendCommand(
    { tabId: tab.id },
    "Page.captureScreenshot",
    params,
  );
  const base64 = result.data;

  return {
    id: command.id,
    success: true,
    data: {
      base64,
      format,
    },
  };
}

export async function handleSnapshot(command) {
  const tab = await getActiveTab(command);
  const kind = command.format === "ax" ? "ax" : "dom";
  const options = {
    interactive: command.interactive ?? false,
    compact: command.compact ?? false,
    maxDepth: command.maxDepth,
    selector: command.selector,
  };
  if (kind === "dom") options.cursor = command.cursor ?? false;

  const snapshot = await captureFrameSnapshot(tab.id, options, kind);

  setRefMap(command.ownerId, tab.id, snapshot.refs || {});

  return { id: command.id, success: true, data: snapshot };
}

async function readElement(tabId, selector, ownerId, body) {
  const resolved = resolveSelector(selector, ownerId, tabId);
  if (resolved.exactNode) return callExactElement(tabId, resolved, body);
  return evaluateRuntime(
    tabId,
    buildElementExpression(selector, ownerId, tabId, body),
  );
}

export async function handleContent(command) {
  const tab = await getActiveTab(command);
  let html = "";

  if (command.selector) {
    html =
      (await readElement(
        tab.id,
        command.selector,
        command.ownerId,
        "return el ? el.innerHTML : null;",
      )) || "";
  } else {
    html =
      (await evaluateRuntime(
        tab.id,
        'document.documentElement ? document.documentElement.outerHTML : ""',
      )) || "";
  }

  return {
    id: command.id,
    success: true,
    data: { html },
  };
}

const PAGE_STATE_HINT = /__react|_reactRootContainer|__vue|__ngContext__|__svelte|\$\$typeof/;
const GLOBAL_WRITE =
  /\b(?:window|globalThis|self)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)/;
const GLOBAL_READ =
  /\b(?:window|globalThis|self)\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)|\b(?:window|globalThis|self)\s*\[\s*["'`]([^"'`]+)["'`]\s*\]/g;

/**
 * Agent scripts run in Stella's isolated world, which sees the same DOM but
 * none of the page's JavaScript, so the page can't observe them. A script
 * that reads the page's own state (framework internals on elements, or
 * globals the page defined) or sets a global for the page (such as replacing
 * `window.confirm`) runs in the page's world instead: it asked for it, and
 * would get nothing, or change nothing, in the isolated one.
 */
async function evaluationWorld(tabId, expression, requested) {
  if (requested === "main" || requested === "isolated") return requested;
  if (PAGE_STATE_HINT.test(expression) || GLOBAL_WRITE.test(expression))
    return "main";
  const names = [
    ...new Set(
      [...expression.matchAll(GLOBAL_READ)].map((m) => m[1] || m[2]),
    ),
  ].slice(0, 40);
  if (names.length === 0) return "isolated";
  const list = JSON.stringify(names);
  const missing = await evaluateRuntime(
    tabId,
    `${list}.filter((name) => !(name in globalThis))`,
    { timeoutMs: 2_000 },
  ).catch(() => []);
  if (!Array.isArray(missing) || missing.length === 0) return "isolated";
  const pageDefined = await evaluateRuntime(
    tabId,
    `${JSON.stringify(missing)}.some((name) => name in globalThis)`,
    { timeoutMs: 2_000, world: "main" },
  ).catch(() => false);
  return pageDefined === true ? "main" : "isolated";
}

/**
 * The bridge asks before and after each interaction for dialogs the page
 * opened (`<id>#guard`, `<id>#dialogs`). Dialogs are answered by the debugger,
 * so its page script is not run.
 */
function dialogProbe(command) {
  const id = String(command.id ?? "");
  if (id.endsWith("#guard")) return "guard";
  if (id.endsWith("#dialogs")) return "dialogs";
  return null;
}

export async function handleEvaluate(command) {
  const tab = await getActiveTab(command);
  const expression = command.expression || command.script;

  if (!expression) throw new Error("Expression is required for evaluate");

  const probe = dialogProbe(command);
  if (probe) {
    await ensureDebugger(tab.id);
    const dialogs = probe === "dialogs" ? takeAnsweredDialogs(tab.id) : [];
    return { id: command.id, success: true, data: { result: dialogs } };
  }

  const timeoutMs = Math.min(command.timeout ?? 30_000, 30_000);
  const world = await evaluationWorld(tab.id, expression, command.world);
  let value;
  try {
    value = await evaluateRuntime(tab.id, expression, { timeoutMs, world });
  } catch (error) {
    if (world !== "isolated" || command.world === "isolated") throw error;
    if (!/^ReferenceError\b/.test(String(error?.message || ""))) throw error;
    value = await evaluateRuntime(tab.id, expression, {
      timeoutMs,
      world: "main",
    });
  }
  return {
    id: command.id,
    success: true,
    data: { result: value },
  };
}

export async function handleGetText(command) {
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  if (!selector) throw new Error("Selector is required for gettext");

  return {
    id: command.id,
    success: true,
    data: {
      text:
        (await readElement(
          tab.id,
          selector,
          command.ownerId,
          "return el ? el.textContent.trim() : null;",
        )) ?? "",
    },
  };
}

export async function handleGetAttribute(command) {
  const tab = await getActiveTab(command);
  const selector = command.selector || command.ref;
  const attribute = command.attribute || command.name;
  if (!selector) throw new Error("Selector is required");
  if (!attribute) throw new Error("Attribute name is required");

  return {
    id: command.id,
    success: true,
    data: {
      value: await readElement(
        tab.id,
        selector,
        command.ownerId,
        `return el ? el.getAttribute(${JSON.stringify(attribute)}) : null;`,
      ),
    },
  };
}

export async function handlePdf(command) {
  const tab = await getActiveTab(command);
  await ensureDebugger(tab.id);

  const result = await chrome.debugger.sendCommand(
    { tabId: tab.id },
    "Page.printToPDF",
    {
      landscape: command.landscape || false,
      printBackground: command.printBackground ?? true,
      paperWidth: command.paperWidth,
      paperHeight: command.paperHeight,
    },
  );

  return {
    id: command.id,
    success: true,
    data: { base64: result.data, format: "pdf" },
  };
}
