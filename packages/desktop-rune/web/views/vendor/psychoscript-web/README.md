# psychoscript-web (vendored)

PsychoScript compiled to WebAssembly, the language Stella Views run in on the web (`../view-worker.ts`).

- Source: [anomalyco/psychoscript](https://github.com/anomalyco/psychoscript) branch `web`, commit
  `e16ce7e65168f94e47efd092a61eb8b46e40e530`.
- `psychoscript_web_bg.wasm`: `web/dist/psychoscript_web_bg.wasm` at that commit, unchanged
  (sha256 `f19513b74603601eb8b637e78e5bb64469a4f7c508abaf7beaafc92a6d603601`).
- `psychoscript_web.js`: its wasm-bindgen 0.2.130 glue (`web/wasm/psychoscript_web.js`), unchanged
  but for the header; dist bundles it into `worker.js`, so it is taken from `web/dist/worker.js.map`.
- `psychoscript_web.d.ts`: types for the parts the worker uses.

The language crate there is the one the desktop engine pins (`psychoscript-mobile` at e289f8ba,
`engine/Cargo.toml`) plus only the browser's clocks and yielding (`rust/crates/psychoscript-web/README.md`,
"Changes in the language crate"), so a view runs the same on both.

To update: check out the new commit of `web`, copy `web/dist/psychoscript_web_bg.wasm`, and take the
glue from `web/dist/worker.js.map` (`sourcesContent` of `../wasm/psychoscript_web.js`), or build it
with `web/scripts/build-wasm.sh`. Replace both together: the glue's imports are tied to the module.
