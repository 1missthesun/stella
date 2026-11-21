// Electron main's entry. Only what must run before anything else is imported
// here: the Windows hidden-spawn patch (before any module that spawns) and the
// environment proxy for fetch. The rest is in its own chunk, so the order holds
// however the bundler groups shared modules into chunks. Electron holds `ready`
// until this module, top-level await included, has finished evaluating, so
// main-process still runs entirely before `ready`.
import "./bootstrap/windows-hidden-spawns.js";
import "@stella/runtime/kernel/shared/http-proxy.js";

await import("./main-process.js");
