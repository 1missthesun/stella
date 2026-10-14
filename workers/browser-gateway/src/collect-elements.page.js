/** @type {import("./collect-elements.page.js").CollectElements} */
export const collectElements = (body, args) => {
  const doc = body.ownerDocument;
  const view = doc.defaultView;
  for (const stale of Array.from(doc.querySelectorAll("[" + args.attribute + "]"))) {
    stale.removeAttribute(args.attribute);
  }
  const roles = new Set([
    "button", "checkbox", "combobox", "heading", "img", "link", "listbox",
    "menuitem", "option", "radio", "searchbox", "switch", "tab", "textbox",
  ]);
  const sensitive = new RegExp(args.sensitive, "u");
  /** @param {string | null | undefined} value */
  const clean = (value) => (value || "").replace(/\s+/gu, " ").trim().slice(0, 120);
  /** @param {Element} element */
  const implicitRole = (element) => {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (tag === "a") return element.hasAttribute("href") ? "link" : "";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return element.hasAttribute("multiple") ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (/^h[1-3]$/u.test(tag)) return "heading";
    if (tag === "img") return element.getAttribute("alt") ? "img" : "";
    if (tag === "input") {
      if (type === "hidden") return "";
      if (["submit", "button", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      if (["file", "range", "color"].includes(type)) return "";
      return "textbox";
    }
    const editable = element.getAttribute("contenteditable");
    if (editable === "true" || editable === "") return "textbox";
    return "";
  };
  /** @param {Element} element */
  const textOf = (element) =>
    clean(("innerText" in element ? String(element.innerText) : "") || element.textContent);
  /**
   * @param {Element} element
   * @param {string} role
   */
  const nameOf = (element, role) => {
    const label = element.getAttribute("aria-label");
    if (label) return clean(label);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const joined = labelledBy
        .split(/\s+/u)
        .map((id) => doc.getElementById(id))
        .filter((node) => node !== null)
        .map((node) => textOf(node))
        .join(" ");
      if (joined) return clean(joined);
    }
    const tag = element.tagName.toLowerCase();
    if (tag === "img") return clean(element.getAttribute("alt"));
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (tag === "input" && ["submit", "button", "reset"].includes(type)) {
        return clean(element.getAttribute("value") || type);
      }
      if (
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement) &&
        element.labels &&
        element.labels.length > 0
      ) {
        return textOf(element.labels[0]);
      }
      return clean(element.getAttribute("placeholder") || element.getAttribute("title"));
    }
    if (role === "textbox") return clean(element.getAttribute("title"));
    return textOf(element) || clean(element.getAttribute("title"));
  };
  /** @param {Element} element */
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = view ? view.getComputedStyle(element) : null;
    if (style && (style.visibility === "hidden" || style.display === "none")) return false;
    return !element.closest('[aria-hidden="true"]');
  };
  /** @param {string} selector */
  const unique = (selector) => {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  /** @type {import("./collect-elements.page.js").RawElement[]} */
  const results = [];
  const candidates = doc.querySelectorAll(
    "a[href],button,input,select,textarea,summary,img[alt],h1,h2,h3,[role],[contenteditable]",
  );
  for (const element of Array.from(candidates)) {
    if (results.length >= args.max) break;
    const explicit = (element.getAttribute("role") || "").split(/\s+/u)[0] || "";
    const role = explicit || implicitRole(element);
    if (!roles.has(role) || !visible(element)) continue;
    const ref = "e" + (results.length + 1);
    element.setAttribute(args.attribute, ref);
    const tag = element.tagName.toLowerCase();
    const formControl =
      role === "textbox" || role === "searchbox" || role === "combobox" ||
      tag === "input" || tag === "textarea" || tag === "select";
    const descriptor = ["type", "autocomplete", "name", "id", "placeholder", "aria-label"]
      .map((attribute) => element.getAttribute(attribute) || "")
      .join(" ")
      .toLowerCase();
    const id = element.getAttribute("id") || "";
    const testId = element.getAttribute("data-testid") || "";
    /** @type {import("./collect-elements.page.js").RawElement} */
    const record = { ref, role, name: nameOf(element, role) };
    if (/^[A-Za-z][A-Za-z0-9_-]*$/u.test(id) && unique("#" + id)) record.id = id;
    if (/^[A-Za-z0-9_.:-]{1,96}$/u.test(testId) && unique('[data-testid="' + testId + '"]')) {
      record.testId = testId;
    }
    if (role === "link" && "href" in element && element.href) record.href = String(element.href);
    if (role === "checkbox" || role === "radio" || role === "switch") {
      record.checked =
        ("checked" in element && element.checked === true) ||
        element.getAttribute("aria-checked") === "true";
    }
    if (
      ("disabled" in element && element.disabled === true) ||
      element.getAttribute("aria-disabled") === "true"
    ) {
      record.disabled = true;
    }
    if (formControl && sensitive.test(descriptor)) record.sensitive = true;
    results.push(record);
  }
  return results;
};
