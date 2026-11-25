// First in tsconfig `files`, so Vite's `import.meta.hot` type (which desktop-ui's modules use)
// wins over bun-types' declaration of the same property.
/// <reference types="vite/client" />
