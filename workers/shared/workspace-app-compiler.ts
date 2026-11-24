export type CompiledWorkspaceModule = {
  js?: string;
  cjs?: string;
  text?: string;
  data?: ArrayBuffer;
  json?: object;
};

export type CompiledWorkspaceAssetMetadata = {
  contentType: string | undefined;
  etag: string;
};

export type CompiledWorkspaceAssetConfig = {
  html_handling?:
    | "auto-trailing-slash"
    | "force-trailing-slash"
    | "drop-trailing-slash"
    | "none";
  not_found_handling?: "single-page-application" | "404-page" | "none";
};

export type CompiledWorkspaceApp = {
  mainModule: string;
  modules: Record<string, string | CompiledWorkspaceModule>;
  assets: Record<string, string | ArrayBuffer>;
  assetManifest: Array<[string, CompiledWorkspaceAssetMetadata]>;
  assetConfig?: CompiledWorkspaceAssetConfig;
};

export type AppCompilerRpc = {
  compileWorkspaceApp(
    files: Record<string, string>,
  ): Promise<CompiledWorkspaceApp>;
};
