// web/build.ts loads .wasm as a file: the import is its emitted path, relative to the importing chunk.
declare module "*.wasm" {
  const path: string;
  export default path;
}
