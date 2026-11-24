// The contract between cloud-builder and the private app-compiler Worker. The
// two deploy separately, so change it only in ways both versions can read.

type CompiledWorkspaceModule = {
  js?: string;
  cjs?: string;
  text?: string;
  data?: ArrayBuffer;
  json?: object;
};

export type CompiledWorkspaceApp = {
  mainModule: string;
  modules: Record<string, string | CompiledWorkspaceModule>;
  /** Static files by absolute path, with the content type to serve. */
  assets: Record<string, { body: string | ArrayBuffer; contentType?: string }>;
};

/**
 * `ok: false` is the app's own problem (a build error to show its author).
 * Anything else (the compiler is missing, out of memory, or took too long)
 * rejects, and the same files may build later.
 */
export type CompileWorkspaceAppResult =
  | { ok: true; app: CompiledWorkspaceApp }
  | { ok: false; error: string };

export type AppCompilerRpc = {
  compileWorkspaceApp(
    files: Record<string, string>,
  ): Promise<CompileWorkspaceAppResult>;
};
