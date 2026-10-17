// Runs in every document of an agent tab. Printing and the File System Access
// pickers open native dialogs parented to the tab's never-shown host window;
// on Wayland that is a protocol error that aborts the app. Pages fall back to
// <input type=file>, which the tab intercepts. A new about:blank frame never
// runs this script, so frame windows are guarded as the page reaches them.
const noPrint = function print(): void {};
const pickers = ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"];

const guardWindow = (target: Window | null | undefined) => {
  if (!target) return;
  try {
    Object.defineProperty(target, "print", {
      value: noPrint,
      writable: true,
      configurable: true,
    });
    for (const picker of pickers) Reflect.deleteProperty(target, picker);
  } catch {
    // Cross-origin frames run this script themselves.
  }
};

const guardFramesReachedThrough = (
  prototype: object,
  property: "contentWindow" | "contentDocument",
) => {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  const read = descriptor?.get;
  if (!descriptor || !read) return;
  Object.defineProperty(prototype, property, {
    ...descriptor,
    get(this: unknown) {
      const value: unknown = read.call(this);
      guardWindow(
        property === "contentWindow"
          ? (value as Window | null)
          : (value as Document | null)?.defaultView,
      );
      return value;
    },
  });
};

guardWindow(window);
for (const prototype of [
  HTMLIFrameElement.prototype,
  HTMLFrameElement.prototype,
  HTMLObjectElement.prototype,
]) {
  guardFramesReachedThrough(prototype, "contentWindow");
  guardFramesReachedThrough(prototype, "contentDocument");
}
