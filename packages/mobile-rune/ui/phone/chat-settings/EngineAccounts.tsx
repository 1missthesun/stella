import type { EngineProvider } from "@stella/contracts/backend/engines";
import { useCloudEngines } from "@/features/cloud/cloud-engines-api";
import { ChatGptAccountsSection } from "../../../../desktop-rune/ui/global/chatgpt/ChatGptAccountsSection";
import { ClaudeAccountsSection } from "../../../../desktop-rune/ui/global/claude/ClaudeAccountsSection";

// packages/mobile's EngineAccountSection (embedded="panel"): the desktop's own Claude and ChatGPT
// account sections, which carry the cloud sign-ins, account choice and plan state as they are.

export function EngineAccountSection({ provider, inUse }: { provider: EngineProvider; inUse: boolean }) {
  const connections = useCloudEngines(true);
  const refreshing = connections === undefined;
  return provider === "anthropic" ? (
    <ClaudeAccountsSection settings={connections} refreshing={refreshing} cloudAvailable engineInUse={inUse} />
  ) : (
    <ChatGptAccountsSection settings={connections} refreshing={refreshing} cloudAvailable engineInUse={inUse} />
  );
}
