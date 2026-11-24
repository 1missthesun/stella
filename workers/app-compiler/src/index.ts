import { WorkerEntrypoint } from "cloudflare:workers";
import { createApp } from "@cloudflare/worker-bundler";
import type {
  AppCompilerRpc,
  CompiledWorkspaceApp,
} from "../../shared/workspace-app-compiler.js";

const DEFAULT_SERVER = `import { DurableObject } from 'cloudflare:workers'; export class App extends DurableObject { fetch() { return new Response('Not found', {status:404}); } }`;

const compileWorkspaceAppFiles = async (
  files: Record<string, string>,
): Promise<CompiledWorkspaceApp> => {
  const assets: Record<string, string> = {};
  const source: Record<string, string> = {};
  for (const [filePath, text] of Object.entries(files)) {
    if (filePath.startsWith("public/")) assets["/" + filePath.slice(7)] = text;
    else if (filePath.startsWith("src/") || filePath === "package.json")
      source[filePath] = text;
  }
  if (!assets["/index.html"]) throw new Error("Missing public/index.html.");
  source["src/server.ts"] ??= DEFAULT_SERVER;

  const built = await createApp({
    files: source,
    server: "src/server.ts",
    ...(source["src/client.tsx"] ? { client: "src/client.tsx" } : {}),
    assets,
    jsx: "automatic",
    assetConfig: { not_found_handling: "none" },
  });

  return {
    mainModule: built.mainModule,
    modules: built.modules,
    assets: built.assets,
    assetManifest: Array.from(built.assetManifest.entries()),
    ...(built.assetConfig
      ? {
          assetConfig: {
            ...(built.assetConfig.html_handling
              ? { html_handling: built.assetConfig.html_handling }
              : {}),
            ...(built.assetConfig.not_found_handling
              ? { not_found_handling: built.assetConfig.not_found_handling }
              : {}),
          },
        }
      : {}),
  };
};

export class AppCompiler
  extends WorkerEntrypoint<Cloudflare.Env>
  implements AppCompilerRpc
{
  async compileWorkspaceApp(
    files: Record<string, string>,
  ): Promise<CompiledWorkspaceApp> {
    return await compileWorkspaceAppFiles(files);
  }
}

export default {
  fetch(): Response {
    // Private Service Binding RPC worker only; never publicly routable.
    return new Response("Not found.", { status: 404 });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
