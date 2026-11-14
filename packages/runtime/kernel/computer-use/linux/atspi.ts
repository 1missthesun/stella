import { DBusConnection, DBusError, variant } from "./dbus.js";

/**
 * AT-SPI over Stella's own D-Bus client: reads an app window's accessibility
 * tree and acts on its elements (actions, text, values, focus, scrolling).
 * Everything here works on a window in the background: nothing moves the
 * user's pointer or changes which window has focus.
 *
 * The approach (window-relative extents, pid-matched application roots,
 * semantic actions before any raw input) follows Cua's platform-linux
 * driver (MIT, trycua/cua); see LICENSE-cua beside this file.
 */

export type AtspiRef = Readonly<{ bus: string; path: string }>;

export type Rect = { x: number; y: number; width: number; height: number };

export type AtspiNode = {
  ref: AtspiRef;
  role: string;
  name: string;
  description: string;
  states: Set<string>;
  interfaces: Set<string>;
  /** Window-relative logical pixels; null when the app gave none or junk. */
  bounds: Rect | null;
  actions: string[];
  text?: string;
  textLength?: number;
  caretOffset?: number;
  value?: { current: number; min: number; max: number; step: number };
  children: AtspiNode[];
  childCount: number;
  /** Children not read because of the node budget. */
  omittedChildren: number;
};

export type AtspiApp = Readonly<{
  ref: AtspiRef;
  pid: number;
  name: string;
  childCount: number;
  /** "GTK", "Qt", "Chromium", … when the app says. */
  toolkit: string;
}>;

export const ATSPI_STATES = [
  "invalid",
  "active",
  "armed",
  "busy",
  "checked",
  "collapsed",
  "defunct",
  "editable",
  "enabled",
  "expandable",
  "expanded",
  "focusable",
  "focused",
  "has-tooltip",
  "horizontal",
  "iconified",
  "modal",
  "multi-line",
  "multiselectable",
  "opaque",
  "pressed",
  "resizable",
  "selectable",
  "selected",
  "sensitive",
  "showing",
  "single-line",
  "stale",
  "transient",
  "vertical",
  "visible",
  "manages-descendants",
  "indeterminate",
  "required",
  "truncated",
  "animated",
  "invalid-entry",
  "supports-autocompletion",
  "selectable-text",
  "is-default",
  "visited",
  "checkable",
  "has-popup",
  "read-only",
] as const;

export const ATSPI_SCROLL = {
  topLeft: 0,
  bottomRight: 1,
  topEdge: 2,
  bottomEdge: 3,
  leftEdge: 4,
  rightEdge: 5,
  anywhere: 6,
} as const;

const COORD_WINDOW = 1;
const REGISTRY = "org.a11y.atspi.Registry";
const ROOT_PATH = "/org/a11y/atspi/accessible/root";
const NULL_PATH = "/org/a11y/atspi/null";
const IFACE = "org.a11y.atspi";

/** Roles whose text content is worth reading beyond their name. */
const TEXT_ROLES = new Set([
  "text",
  "entry",
  "paragraph",
  "terminal",
  "editbar",
  "combo box",
  "spin button",
  "document text",
  "rich text",
]);

const decodeStates = (words: unknown): Set<string> => {
  const states = new Set<string>();
  const list = Array.isArray(words) ? (words as number[]) : [];
  list.forEach((word, wordIndex) => {
    for (let bit = 0; bit < 32; bit += 1) {
      if ((word >>> bit) & 1) {
        const name = ATSPI_STATES[wordIndex * 32 + bit];
        if (name) states.add(name);
      }
    }
  });
  return states;
};

/** Apps report junk extents for unrealized widgets (huge or negative sizes). */
const sanitizeBounds = (raw: unknown): Rect | null => {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [x, y, width, height] = raw as number[];
  if (![x, y, width, height].every((value) => Number.isFinite(value)))
    return null;
  if (width! < 0 || height! < 0) return null;
  if (
    width! > 50_000 ||
    height! > 50_000 ||
    Math.abs(x!) > 50_000 ||
    Math.abs(y!) > 50_000
  ) {
    return null;
  }
  if (x === -1 && y === -1 && width === -1 && height === -1) return null;
  return { x: x!, y: y!, width: width!, height: height! };
};

export type ReadTreeOptions = Readonly<{
  maxNodes?: number;
  maxDepth?: number;
  maxChildren?: number;
  /** Skip subtrees the app reports as not showing. */
  showingOnly?: boolean;
  textLimit?: number;
  /** Stop descending after this long; unread children count as omitted. */
  budgetMs?: number;
}>;

export class AtspiClient {
  /** Apps that refuse Properties.GetAll on the Accessible interface (Qt). */
  private readonly noGetAll = new Set<string>();

  private constructor(private readonly bus: DBusConnection) {}

  static async connect(): Promise<AtspiClient> {
    const session = await DBusConnection.session();
    try {
      const [address] = await session.call({
        destination: "org.a11y.Bus",
        path: "/org/a11y/bus",
        interface: "org.a11y.Bus",
        member: "GetAddress",
      });
      const bus = await DBusConnection.connect(String(address));
      bus.unref();
      return new AtspiClient(bus);
    } finally {
      session.close();
    }
  }

  get closed() {
    return this.bus.closed;
  }

  close() {
    this.bus.close();
  }

  private call(
    ref: AtspiRef,
    iface: string,
    member: string,
    signature = "",
    body: unknown[] = [],
    timeoutMs = 2_000,
  ) {
    return this.bus.call({
      destination: ref.bus,
      path: ref.path,
      interface: iface,
      member,
      signature,
      body,
      timeoutMs,
    });
  }

  private async property(ref: AtspiRef, iface: string, name: string) {
    const [value] = await this.call(
      ref,
      "org.freedesktop.DBus.Properties",
      "Get",
      "ss",
      [iface, name],
    );
    return value;
  }

  async setProperty(
    ref: AtspiRef,
    iface: string,
    name: string,
    value: unknown,
    signature: string,
  ) {
    await this.call(ref, "org.freedesktop.DBus.Properties", "Set", "ssv", [
      iface,
      name,
      variant(signature, value),
    ]);
  }

  private async accessibleProps(ref: AtspiRef) {
    if (!this.noGetAll.has(ref.bus)) {
      try {
        const [props] = await this.call(
          ref,
          "org.freedesktop.DBus.Properties",
          "GetAll",
          "s",
          [`${IFACE}.Accessible`],
        );
        const record = props as Record<string, unknown>;
        if ("Name" in record) {
          return {
            name: String(record.Name ?? ""),
            description: String(record.Description ?? ""),
            childCount: Number(record.ChildCount ?? 0),
          };
        }
      } catch (error) {
        if (!(error instanceof DBusError)) throw error;
      }
      this.noGetAll.add(ref.bus);
    }
    const [name, description, childCount] = await Promise.all([
      this.property(ref, `${IFACE}.Accessible`, "Name").catch(() => ""),
      this.property(ref, `${IFACE}.Accessible`, "Description").catch(() => ""),
      this.property(ref, `${IFACE}.Accessible`, "ChildCount").catch(() => 0),
    ]);
    return {
      name: String(name ?? ""),
      description: String(description ?? ""),
      childCount: Number(childCount ?? 0),
    };
  }

  async children(ref: AtspiRef): Promise<AtspiRef[]> {
    const [list] = await this.call(ref, `${IFACE}.Accessible`, "GetChildren");
    return (list as [string, string][])
      .filter(([, path]) => path !== NULL_PATH)
      .map(([bus, path]) => ({ bus, path }));
  }

  /** Every application registered on the accessibility bus, with its pid. */
  async apps(): Promise<AtspiApp[]> {
    const roots = await this.children({ bus: REGISTRY, path: ROOT_PATH });
    const apps = await Promise.all(
      roots.map(async (ref) => {
        try {
          const [[pid], props, toolkit] = await Promise.all([
            this.bus.call({
              destination: "org.freedesktop.DBus",
              path: "/org/freedesktop/DBus",
              interface: "org.freedesktop.DBus",
              member: "GetConnectionUnixProcessID",
              signature: "s",
              body: [ref.bus],
              timeoutMs: 1_000,
            }),
            this.accessibleProps(ref),
            this.property(ref, `${IFACE}.Application`, "ToolkitName").catch(
              () => "",
            ),
          ]);
          return {
            ref,
            pid: Number(pid),
            name: props.name,
            childCount: props.childCount,
            toolkit: String(toolkit ?? ""),
          } satisfies AtspiApp;
        } catch {
          return null;
        }
      }),
    );
    return apps.filter((app): app is AtspiApp => app !== null);
  }

  async states(ref: AtspiRef): Promise<Set<string>> {
    const [words] = await this.call(ref, `${IFACE}.Accessible`, "GetState");
    return decodeStates(words);
  }

  async name(ref: AtspiRef): Promise<string> {
    return (await this.accessibleProps(ref)).name;
  }

  async extents(ref: AtspiRef): Promise<Rect | null> {
    const [raw] = await this.call(
      ref,
      `${IFACE}.Component`,
      "GetExtents",
      "u",
      [COORD_WINDOW],
    );
    return sanitizeBounds(raw);
  }

  async readTree(
    root: AtspiRef,
    options: ReadTreeOptions = {},
  ): Promise<AtspiNode> {
    const maxNodes = options.maxNodes ?? 2_500;
    const maxDepth = options.maxDepth ?? 64;
    const maxChildren = options.maxChildren ?? 400;
    const textLimit = options.textLimit ?? 4_000;
    const showingOnly = options.showingOnly ?? true;
    let budget = maxNodes;
    const deadline = performance.now() + (options.budgetMs ?? 5_000);
    const timeLeft = () => deadline - performance.now();
    const call = (
      ref: AtspiRef,
      iface: string,
      member: string,
      signature = "",
      body: unknown[] = [],
    ) =>
      this.call(
        ref,
        iface,
        member,
        signature,
        body,
        Math.max(250, Math.min(2_000, timeLeft())),
      );

    const readNode = async (
      ref: AtspiRef,
      depth: number,
    ): Promise<AtspiNode | null> => {
      const [props, role, stateWords, interfaces, childRefs, bounds, actions] =
        await Promise.all([
          this.accessibleProps(ref),
          call(ref, `${IFACE}.Accessible`, "GetRoleName").then(([value]) =>
            String(value),
          ),
          call(ref, `${IFACE}.Accessible`, "GetState").then(([value]) => value),
          call(ref, `${IFACE}.Accessible`, "GetInterfaces").then(
            ([value]) =>
              new Set(
                (value as string[]).map((name) =>
                  name.replace(`${IFACE}.`, ""),
                ),
              ),
          ),
          depth < maxDepth && timeLeft() > 0
            ? this.children(ref).catch(() => [] as AtspiRef[])
            : Promise.resolve([] as AtspiRef[]),
          call(ref, `${IFACE}.Component`, "GetExtents", "u", [COORD_WINDOW])
            .then(([value]) => sanitizeBounds(value))
            .catch(() => null),
          this.actionNames(ref).catch(() => [] as string[]),
        ]);
      const states = decodeStates(stateWords);
      if (states.has("defunct")) return null;
      if (depth > 0 && showingOnly && !states.has("showing")) return null;
      const node: AtspiNode = {
        ref,
        role,
        name: props.name,
        description: props.description,
        states,
        interfaces,
        bounds: interfaces.has("Component") ? bounds : null,
        actions,
        children: [],
        childCount: props.childCount,
        omittedChildren: 0,
      };
      const extras: Promise<unknown>[] = [];
      const readsText =
        interfaces.has("Text") &&
        role !== "password text" &&
        (states.has("editable") || TEXT_ROLES.has(role));
      if (readsText) {
        extras.push(
          (async () => {
            const count = Number(
              await this.property(ref, `${IFACE}.Text`, "CharacterCount").catch(
                () => 0,
              ),
            );
            node.textLength = count;
            if (count > 0) {
              const [text] = await this.call(
                ref,
                `${IFACE}.Text`,
                "GetText",
                "ii",
                [0, Math.min(count, textLimit)],
              );
              node.text = String(text);
            } else {
              node.text = "";
            }
            if (states.has("focused") || states.has("editable")) {
              node.caretOffset = Number(
                await this.property(ref, `${IFACE}.Text`, "CaretOffset").catch(
                  () => -1,
                ),
              );
            }
          })().catch(() => undefined),
        );
      }
      if (interfaces.has("Value")) {
        extras.push(
          Promise.all(
            [
              "CurrentValue",
              "MinimumValue",
              "MaximumValue",
              "MinimumIncrement",
            ].map((name) =>
              this.property(ref, `${IFACE}.Value`, name).catch(
                () => Number.NaN,
              ),
            ),
          ).then(([current, min, max, step]) => {
            if (Number.isFinite(Number(current))) {
              node.value = {
                current: Number(current),
                min: Number(min),
                max: Number(max),
                step: Number(step),
              };
            }
          }),
        );
      }
      const kept = childRefs.slice(0, maxChildren);
      node.omittedChildren = childRefs.length - kept.length;
      const children = await Promise.all(
        kept.map((child) => {
          if (budget <= 0 || timeLeft() <= 0) {
            node.omittedChildren += 1;
            return Promise.resolve(null);
          }
          budget -= 1;
          return readNode(child, depth + 1).catch(() => null);
        }),
      );
      node.children = children.filter(
        (child): child is AtspiNode => child !== null,
      );
      await Promise.all(extras);
      return node;
    };

    budget -= 1;
    const node = await readNode(root, 0);
    if (!node) throw new Error("The window's accessibility root is gone.");
    return node;
  }

  async actionNames(ref: AtspiRef): Promise<string[]> {
    const [value] = await this.call(ref, `${IFACE}.Action`, "GetActions");
    const names = (value as [string, string, string][]).map(([name]) => name);
    // Chromium answers GetActions with empty names; GetName has them.
    if (names.length > 0 && names.some((name) => name === "")) {
      return await Promise.all(
        names.map((name, index) =>
          name
            ? name
            : this.call(ref, `${IFACE}.Action`, "GetName", "i", [index])
                .then(([named]) => String(named))
                .catch(() => ""),
        ),
      );
    }
    return names;
  }

  async doAction(ref: AtspiRef, index: number): Promise<boolean> {
    const [ok] = await this.call(
      ref,
      `${IFACE}.Action`,
      "DoAction",
      "i",
      [index],
      5_000,
    );
    return Boolean(ok);
  }

  async grabFocus(ref: AtspiRef): Promise<boolean> {
    const [ok] = await this.call(ref, `${IFACE}.Component`, "GrabFocus");
    return Boolean(ok);
  }

  async scrollTo(ref: AtspiRef, type: number): Promise<boolean> {
    const [ok] = await this.call(ref, `${IFACE}.Component`, "ScrollTo", "u", [
      type,
    ]);
    return Boolean(ok);
  }

  /** Scrolls the element's ancestors so its top-left lands at a window point. */
  async scrollToPoint(ref: AtspiRef, x: number, y: number): Promise<boolean> {
    const [ok] = await this.call(
      ref,
      `${IFACE}.Component`,
      "ScrollToPoint",
      "uii",
      [COORD_WINDOW, Math.round(x), Math.round(y)],
    );
    return Boolean(ok);
  }

  async textLength(ref: AtspiRef): Promise<number> {
    return Number(await this.property(ref, `${IFACE}.Text`, "CharacterCount"));
  }

  async text(ref: AtspiRef, start = 0, end = -1): Promise<string> {
    const length = end < 0 ? await this.textLength(ref) : end;
    const [text] = await this.call(ref, `${IFACE}.Text`, "GetText", "ii", [
      start,
      length,
    ]);
    return String(text);
  }

  async caretOffset(ref: AtspiRef): Promise<number> {
    return Number(await this.property(ref, `${IFACE}.Text`, "CaretOffset"));
  }

  async setCaretOffset(ref: AtspiRef, offset: number): Promise<boolean> {
    const [ok] = await this.call(ref, `${IFACE}.Text`, "SetCaretOffset", "i", [
      offset,
    ]);
    return Boolean(ok);
  }

  async selection(
    ref: AtspiRef,
  ): Promise<{ start: number; end: number } | null> {
    const [count] = await this.call(ref, `${IFACE}.Text`, "GetNSelections");
    if (Number(count) <= 0) return null;
    const [start, end] = await this.call(
      ref,
      `${IFACE}.Text`,
      "GetSelection",
      "i",
      [0],
    );
    return { start: Number(start), end: Number(end) };
  }

  async setSelection(
    ref: AtspiRef,
    start: number,
    end: number,
  ): Promise<boolean> {
    const [count] = await this.call(ref, `${IFACE}.Text`, "GetNSelections");
    const [ok] =
      Number(count) > 0
        ? await this.call(ref, `${IFACE}.Text`, "SetSelection", "iii", [
            0,
            start,
            end,
          ])
        : await this.call(ref, `${IFACE}.Text`, "AddSelection", "ii", [
            start,
            end,
          ]);
    return Boolean(ok);
  }

  async setTextContents(ref: AtspiRef, text: string): Promise<boolean> {
    const [ok] = await this.call(
      ref,
      `${IFACE}.EditableText`,
      "SetTextContents",
      "s",
      [text],
    );
    return Boolean(ok);
  }

  async insertText(
    ref: AtspiRef,
    position: number,
    text: string,
  ): Promise<boolean> {
    const [ok] = await this.call(
      ref,
      `${IFACE}.EditableText`,
      "InsertText",
      "isi",
      [position, text, [...text].length],
    );
    return Boolean(ok);
  }

  async deleteText(
    ref: AtspiRef,
    start: number,
    end: number,
  ): Promise<boolean> {
    const [ok] = await this.call(
      ref,
      `${IFACE}.EditableText`,
      "DeleteText",
      "ii",
      [start, end],
    );
    return Boolean(ok);
  }

  async setValue(ref: AtspiRef, value: number): Promise<void> {
    await this.setProperty(ref, `${IFACE}.Value`, "CurrentValue", value, "d");
  }

  async value(ref: AtspiRef): Promise<number> {
    return Number(await this.property(ref, `${IFACE}.Value`, "CurrentValue"));
  }

  async selectChild(ref: AtspiRef, index: number): Promise<boolean> {
    const [ok] = await this.call(
      ref,
      `${IFACE}.Selection`,
      "SelectChild",
      "i",
      [index],
    );
    return Boolean(ok);
  }

  async indexInParent(ref: AtspiRef): Promise<number> {
    const [index] = await this.call(
      ref,
      `${IFACE}.Accessible`,
      "GetIndexInParent",
    );
    return Number(index);
  }

  async parent(ref: AtspiRef): Promise<AtspiRef | null> {
    const value = (await this.property(
      ref,
      `${IFACE}.Accessible`,
      "Parent",
    )) as [string, string];
    if (!value || value[1] === NULL_PATH) return null;
    return { bus: value[0], path: value[1] };
  }

  async role(ref: AtspiRef): Promise<string> {
    const [value] = await this.call(ref, `${IFACE}.Accessible`, "GetRoleName");
    return String(value);
  }
}
