import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ANTIGRAVITY_GATED_TOOLS } from "./antigravity-native-tools.js";

/**
 * Stella's own Antigravity profile (an `agy --gemini-dir`), set up only
 * through files Antigravity documents: a custom agent that replaces Google's
 * prompt and picks its tools, an MCP server entry whose tools load up front
 * under their own names, and a hook that refuses the tools an agent wasn't
 * given. All are shared by every session of the profile; what differs per
 * session reaches the MCP bridge and the hook through `agy`'s environment.
 */
export const ANTIGRAVITY_MCP_SERVER_NAME = "stella";
export const ANTIGRAVITY_MCP_SOCKET_ENV = "STELLA_AGY_MCP_SOCKET";
export const ANTIGRAVITY_MCP_TOKEN_ENV = "STELLA_AGY_MCP_TOKEN";
export const ANTIGRAVITY_ALLOWED_TOOLS_ENV = "STELLA_AGY_ALLOWED_TOOLS";

const BRIDGE_SCRIPT = `import net from "node:net";
const socket = net.createConnection(process.env.${ANTIGRAVITY_MCP_SOCKET_ENV} ?? "", () => {
  socket.write(process.env.${ANTIGRAVITY_MCP_TOKEN_ENV} + "\\n");
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.on("close", () => process.exit(0));
socket.on("error", () => process.exit(1));
process.stdin.on("end", () => socket.end());
`;

const HOOK_SCRIPT = `let input = "";
for await (const chunk of process.stdin) input += chunk;
const allowed = (process.env.${ANTIGRAVITY_ALLOWED_TOOLS_ENV} ?? "").split(",");
let name = "";
try { name = String(JSON.parse(input).toolCall?.name ?? ""); } catch {}
process.stdout.write(JSON.stringify(
  allowed.includes(name)
    ? { decision: "allow" }
    : { decision: "deny", reason: "Stella doesn't offer " + (name || "this tool") + " here. Use your other tools." },
));
`;

const writeIfChanged = async (target: string, contents: string): Promise<void> => {
  if ((await readFile(target, "utf8").catch(() => undefined)) === contents) return;
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

const quoted = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;

const agentFile = (name: string, nativeTools: readonly string[]): string => `---
name: ${name}
description: Stella
mainAgent: true
subagent: false
excludeDefaultComponents: true
inheritMcp: true
tools: ${nativeTools.length === 0 ? "[]" : `\n${nativeTools.map((tool) => `  - ${tool}`).join("\n")}`}
---
# Stella

Your instructions follow.
`;

const knownToolNames = (config: string | undefined): string[] => {
  try {
    const tools = (JSON.parse(config ?? "") as { mcpServers?: Record<string, { tools?: Record<string, unknown> }> })
      .mcpServers?.[ANTIGRAVITY_MCP_SERVER_NAME]?.tools;
    return Object.keys(tools ?? {});
  } catch {
    return [];
  }
};

export const createAntigravityProfile = (home: () => string) => {
  let queue: Promise<unknown> = Promise.resolve();

  const prepare = async (nativeTools: readonly string[], stellaTools: readonly string[]): Promise<string> => {
    const directory = home();
    const config = path.join(directory, "config");
    const bridge = path.join(directory, "stella", "mcp-bridge.mjs");
    const hook = path.join(directory, "stella", "pre-tool-hook.mjs");
    const agent = `stella-${crypto.createHash("sha256").update(nativeTools.join(",")).digest("hex").slice(0, 8)}`;
    const mcpConfig = path.join(config, "mcp_config.json");
    const names = [...new Set([...knownToolNames(await readFile(mcpConfig, "utf8").catch(() => undefined)), ...stellaTools])].sort();
    const bunEnv = process.versions.bun ? {} : { ELECTRON_RUN_AS_NODE: "1" };
    await Promise.all([
      writeIfChanged(bridge, BRIDGE_SCRIPT),
      writeIfChanged(hook, HOOK_SCRIPT),
      writeIfChanged(path.join(config, "agents", `${agent}.md`), agentFile(agent, nativeTools)),
      writeIfChanged(
        mcpConfig,
        `${JSON.stringify(
          {
            mcpServers: {
              [ANTIGRAVITY_MCP_SERVER_NAME]: {
                command: process.execPath,
                args: [bridge],
                env: bunEnv,
                timeoutSeconds: -1,
                tools: Object.fromEntries(names.map((name) => [name, { eager: true, background: "off" }])),
              },
            },
          },
          null,
          2,
        )}\n`,
      ),
      writeIfChanged(
        path.join(config, "hooks.json"),
        `${JSON.stringify(
          {
            stella: {
              PreToolUse: [
                {
                  matcher: ANTIGRAVITY_GATED_TOOLS.join("|"),
                  hooks: [{ type: "command", command: `${quoted(process.execPath)} ${quoted(hook)}`, timeout: 20 }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      ),
    ]);
    return agent;
  };

  return {
    /** Writes the profile's files for this tool set and names the custom agent to launch `agy` with. */
    prepare: (nativeTools: readonly string[], stellaTools: readonly string[]): Promise<string> => {
      const next = queue.catch(() => undefined).then(() => prepare(nativeTools, stellaTools));
      queue = next;
      return next;
    },
  };
};
