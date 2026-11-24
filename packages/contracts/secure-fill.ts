export type SecureFillMode = "fill" | "move" | "clear";

export const SECURE_FILL_MODES: readonly SecureFillMode[] = ["fill", "move", "clear"];

export type SecureFieldDescription = Readonly<{
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  autocomplete?: string;
  visible: boolean;
  focused: boolean;
}>;

export type SecureFillPageReport = Readonly<{
  landed: readonly SecureFieldDescription[];
  landedCount: number;
  selectorMatches?: number;
  target?: SecureFieldDescription & Readonly<{ holdsValue: boolean; length: number; editable: boolean }>;
  cleared: number;
}>;

export type SecureFillOutcome = Readonly<{
  tabId: number | string;
  cleared: number;
  clearedWrong?: number;
  report?: SecureFillPageReport | null;
}>;

export const secureFillHash = (value: string, seed: number): number => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

export const secureFieldScript = (input: {
  hash: number;
  seed: number;
  length: number;
  selector?: string;
  clear?: "all" | "visible-not-target";
}): string => `(() => {
  const HASH = ${JSON.stringify(input.hash)};
  const SEED = ${JSON.stringify(input.seed)};
  const LENGTH = ${JSON.stringify(input.length)};
  const SELECTOR = ${JSON.stringify(input.selector ?? null)};
  const CLEAR = ${JSON.stringify(input.clear ?? null)};
  const hash = (str) => {
    let h1 = 0xdeadbeef ^ SEED, h2 = 0x41c6ce57 ^ SEED;
    for (let i = 0; i < str.length; i += 1) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  const roots = [];
  const addRoot = (root) => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) addRoot(el.shadowRoot);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try { if (el.contentDocument) addRoot(el.contentDocument); } catch (_) {}
      }
    }
  };
  addRoot(document);
  const editables = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('input, textarea, [contenteditable]:not([contenteditable="false"])')) {
      editables.push(el);
    }
  }
  const valueOf = (el) => el.isContentEditable ? (el.textContent || '') : String(el.value ?? '');
  const holds = (el) => { const v = valueOf(el); return v.length === LENGTH && hash(v) === HASH; };
  const short = (text) => {
    const clean = String(text || '').replace(/\\s+/g, ' ').trim();
    return clean.length > 80 ? clean.slice(0, 79) + '…' : clean;
  };
  const labelOf = (el) => {
    const doc = el.ownerDocument || document;
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const text = labelled.split(/\\s+/).map((id) => doc.getElementById(id)?.innerText || '').join(' ');
      if (short(text)) return short(text);
    }
    if (el.getAttribute('aria-label')) return short(el.getAttribute('aria-label'));
    if (el.labels && el.labels[0]) return short(el.labels[0].innerText);
    const wrap = el.closest && el.closest('label');
    return wrap ? short(wrap.innerText) : '';
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0.05;
  };
  const focusedEl = () => {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    try {
      while (active && (active.tagName === 'IFRAME' || active.tagName === 'FRAME') && active.contentDocument) {
        active = active.contentDocument.activeElement;
      }
    } catch (_) {}
    return active;
  };
  const focused = focusedEl();
  const describe = (el) => {
    const tag = (el.tagName || '').toLowerCase();
    const out = { tag, visible: visible(el), focused: el === focused };
    if (tag === 'input') out.type = String(el.type || 'text').toLowerCase();
    if (el.id) out.id = short(el.id);
    if (el.getAttribute('name')) out.name = short(el.getAttribute('name'));
    const label = labelOf(el);
    if (label) out.label = label;
    if (el.getAttribute('placeholder')) out.placeholder = short(el.getAttribute('placeholder'));
    if (el.getAttribute('autocomplete')) out.autocomplete = short(el.getAttribute('autocomplete'));
    return out;
  };
  const empty = (el) => {
    try { el.focus(); } catch (_) {}
    const view = el.ownerDocument.defaultView || window;
    const tag = (el.tagName || '').toLowerCase();
    const proto = tag === 'input' ? view.HTMLInputElement.prototype : tag === 'textarea' ? view.HTMLTextAreaElement.prototype : null;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
    if (el.isContentEditable) el.textContent = '';
    else if (setter) setter.call(el, '');
    else el.value = '';
    try { el.dispatchEvent(new view.InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' })); }
    catch (_) { el.dispatchEvent(new view.Event('input', { bubbles: true, composed: true })); }
    el.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
    return valueOf(el).length === 0;
  };
  let target = null;
  let selectorMatches;
  if (SELECTOR) {
    try {
      const list = document.querySelectorAll(SELECTOR);
      selectorMatches = list.length;
      target = list[0] || null;
    } catch (_) {}
  }
  const landedEls = editables.filter(holds);
  let cleared = 0;
  if (CLEAR === 'all') {
    for (const el of landedEls) if (empty(el)) cleared += 1;
  } else if (CLEAR === 'visible-not-target' && target && !landedEls.includes(target)) {
    for (const el of landedEls) if (visible(el) && empty(el)) cleared += 1;
  }
  const report = {
    landed: landedEls.slice(0, 5).map(describe),
    landedCount: landedEls.length,
    cleared,
  };
  if (selectorMatches !== undefined) report.selectorMatches = selectorMatches;
  if (target) {
    const editable = target.isContentEditable || 'value' in target;
    report.target = Object.assign(describe(target), {
      holdsValue: landedEls.includes(target),
      length: editable ? valueOf(target).length : 0,
      editable,
    });
  }
  return report;
})()`;

const describeFieldText = (field: SecureFieldDescription): string => {
  const where = `${field.tag}${field.id ? `#${field.id}` : ""}`;
  const facts = [
    field.type ? `type=${field.type}` : "",
    field.name ? `name "${field.name}"` : "",
    field.label ? `label "${field.label}"` : "",
    field.placeholder ? `placeholder "${field.placeholder}"` : "",
    field.autocomplete ? `autocomplete=${field.autocomplete}` : "",
    field.visible ? "" : "hidden",
  ].filter(Boolean);
  return facts.length > 0 ? `${where} (${facts.join(", ")})` : where;
};

export const secureFillReceipt = (input: {
  label: string;
  selector: string;
  mode: SecureFillMode;
  outcome: SecureFillOutcome;
  usableUntil?: string;
}): { ok: boolean; detail: string } => {
  const { outcome, mode } = input;
  const named = input.label ? `"${input.label}"` : "the value";
  const lines: string[] = [];
  if (mode === "clear") {
    return {
      ok: true,
      detail:
        outcome.cleared > 0
          ? `Cleared ${named} from ${outcome.cleared} field${outcome.cleared === 1 ? "" : "s"} in tab ${outcome.tabId}.`
          : `${named} wasn't in any field Stella can read in tab ${outcome.tabId}; nothing to clear.`,
    };
  }
  if (mode === "move" && outcome.cleared > 0) {
    lines.push(
      `Cleared ${named} from ${outcome.cleared} field${outcome.cleared === 1 ? "" : "s"} first.`,
    );
  }
  const report = outcome.report;
  const again = `The handle still works${input.usableUntil ? ` (until ${input.usableUntil})` : ""}: call use_secure_value again with a selector for the right field and into.mode "move"; never ask the user for it again.`;
  if (!report) {
    lines.push(
      `Filled ${named} into ${input.selector} in tab ${outcome.tabId}. Stella couldn't read the page to confirm where it landed; check the field with a screenshot.`,
    );
    return { ok: true, detail: lines.join(" ") };
  }
  const target = report.target;
  const several =
    report.selectorMatches !== undefined && report.selectorMatches > 1
      ? ` Your selector matched ${report.selectorMatches} elements; the value went to the first.`
      : "";
  if (target && !target.holdsValue && (outcome.clearedWrong ?? 0) > 0) {
    const wrong = report.landed.map(describeFieldText).join("; ");
    lines.push(
      `Wrong field: ${named} landed in ${wrong || "another field"}, not in the field your selector matched, ${describeFieldText(target)}. Stella cleared it from there, so it isn't left showing.${several} ${again}`,
    );
    return { ok: false, detail: lines.join(" ") };
  }
  if (target && !target.holdsValue && report.landedCount > 0) {
    lines.push(
      `${named} is in ${report.landed.map(describeFieldText).join("; ")}, not in the field your selector matched, ${describeFieldText(target)}.${several} If that's the wrong field, ${again.charAt(0).toLowerCase()}${again.slice(1)}`,
    );
    return { ok: false, detail: lines.join(" ") };
  }
  if (report.landedCount === 0) {
    const into = target
      ? ` ${describeFieldText(target)} now holds ${target.length} character${target.length === 1 ? "" : "s"}.`
      : "";
    lines.push(
      `Filled ${named} into ${input.selector} in tab ${outcome.tabId}, but no field holds it exactly now (the page may reformat it, split it across boxes, or keep it in a frame Stella can't read).${into}${several} Check with a screenshot; if it went to the wrong place, ${again.charAt(0).toLowerCase()}${again.slice(1)}`,
    );
    return { ok: true, detail: lines.join(" ") };
  }
  const where = report.landed.map(describeFieldText).join("; ");
  const extra = report.landedCount > report.landed.length ? ` and ${report.landedCount - report.landed.length} more` : "";
  lines.push(
    `Filled ${named} into tab ${outcome.tabId}. It is now in ${where}${extra}${target ? " — the field your selector matched" : ""}.${several} If that isn't the field you meant, ${again.charAt(0).toLowerCase()}${again.slice(1)}`,
  );
  return { ok: true, detail: lines.join(" ") };
};
