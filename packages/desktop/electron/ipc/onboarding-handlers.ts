import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type {
  OnboardingStarter,
  OnboardingSynthesisRequest,
  OnboardingSynthesisResponse,
} from "@stella/contracts/desktop/onboarding";
import type {
  RuntimeOneShotCompletionRequest,
  RuntimeOneShotCompletionResult,
} from "@stella/contracts/protocol";
import { STELLA_DEFAULT_MODEL } from "@stella/contracts/stella-api";
import { readRuntimePrompt } from "@stella/runtime/kernel/prompts/home-prompts";
import { IPC_ONBOARDING_SYNTHESIZE } from "@stella/contracts/desktop/ipc-channels";
import { handleIpc } from "./typed-ipc.js";

type OneShotRunner = {
  runOneShotCompletion(
    request: RuntimeOneShotCompletionRequest,
  ): Promise<RuntimeOneShotCompletionResult>;
};

type OnboardingHandlersOptions = {
  getStellaHostRunner: () => OneShotRunner | null;
  whenRuntimeAuthenticated: () => Promise<boolean>;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

const SECTION_LABELS: Record<string, string> = {
  apps_system: "Apps & system",
  messages_notes: "Messages & notes",
};

const DEFAULT_WELCOME_MESSAGE =
  "Hey! I'm Stella, your AI assistant. What can I help you with today?";
const MAX_PROFILE_LINES = 20;
const REPO_LINE = /^- (.+?) \((.+)\) \((?:today|yesterday|\d+d ago)\)$/;

const parseRepos = (section: string | undefined): { name: string; path: string }[] =>
  (section ?? "")
    .split("\n")
    .map((line) => REPO_LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ name: match[1], path: match[2] }));

const profileLines = (raw: string): string[] =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+\S/.test(line))
    .map((line) => `- ${line.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "")}`)
    .slice(0, MAX_PROFILE_LINES);
const MAX_PROFILE_HIGHLIGHTS = 5;
const MAX_STARTERS = 4;

const trimToLength = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
};

/**
 * The starters prompt asks for JSON only, but a code fence or a sentence of
 * preamble still slips through now and then; tolerate both and never throw.
 * A bad output means the finale falls back to its generic starters.
 */
const parseStarters = (
  raw: string,
): { profileHighlights: string[]; starters: OnboardingStarter[] } | null => {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const profileHighlights = Array.isArray(record.highlights)
    ? record.highlights
        .map((entry) => trimToLength(entry, 48))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, MAX_PROFILE_HIGHLIGHTS)
    : [];
  const starters = Array.isArray(record.starters)
    ? record.starters
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as Record<string, unknown>;
          const title = trimToLength(item.title, 60);
          const prompt = trimToLength(item.prompt, 280);
          return title && prompt ? { title, prompt } : null;
        })
        .filter((entry): entry is OnboardingStarter => Boolean(entry))
        .slice(0, MAX_STARTERS)
    : [];
  if (profileHighlights.length === 0 && starters.length === 0) return null;
  return { profileHighlights, starters };
};

const synthesize = async (
  runner: OneShotRunner,
  payload: OnboardingSynthesisRequest,
): Promise<OnboardingSynthesisResponse> => {
  const config = payload.promptConfig;
  const profileSystemPrompt = config?.profileSystemPrompt?.trim();
  const profileUserTemplate = config?.profileUserPromptTemplate?.trim();
  const welcomeTemplate = config?.welcomeMessagePromptTemplate?.trim();
  if (!profileSystemPrompt || !profileUserTemplate || !welcomeTemplate) {
    throw new Error("Missing synthesis prompt payload.");
  }
  const sections = Object.fromEntries(
    Object.entries(payload.formattedSections ?? {}).filter(
      ([, data]) => typeof data === "string" && data.trim().length > 0,
    ),
  );
  if (Object.keys(sections).length === 0) {
    throw new Error("formattedSections is required.");
  }

  const complete = async (
    agentType: string,
    userText: string,
    options: { systemPrompt?: string; maxOutputTokens?: number } = {},
  ): Promise<string> =>
    // Pinned to Stella's default so a per-agent model override can't
    // send the user's raw browsing data somewhere unexpected.
    (
      await runner.runOneShotCompletion({
        agentType,
        userText,
        model: STELLA_DEFAULT_MODEL,
        ...options,
      })
    ).text.trim();

  const repos = parseRepos(sections.dev_environment);
  const signalSections = Object.entries(sections)
    .filter(([category]) => category !== "dev_environment")
    .map(([category, data]) =>
      category === "browsing_bookmarks"
        ? data.trim()
        : `## ${SECTION_LABELS[category] ?? category}\n${data.trim()}`,
    );
  const learned =
    signalSections.length > 0
      ? profileLines(
          await complete(
            "synthesis",
            profileUserTemplate.replace(
              "{{signals}}",
              [
                ...signalSections,
                ...(repos.length > 0
                  ? [`## Recent repositories\n${repos.map((repo) => `- ${repo.name}`).join("\n")}`]
                  : []),
              ].join("\n\n"),
            ),
            { systemPrompt: profileSystemPrompt },
          ),
        )
      : [];
  const coreMemory = [
    ...learned,
    ...repos.map((repo) => `- Recent repo ${repo.name}: ${repo.path}`),
  ].join("\n");
  if (!coreMemory) throw new Error("Failed to synthesize core memory.");

  const startersPrompt = readRuntimePrompt("synthesis");
  const [welcomeMessage, finale] = await Promise.all([
    complete("welcome", welcomeTemplate.replace("{{coreMemory}}", coreMemory)),
    startersPrompt
      ? complete(
          "welcome",
          startersPrompt.replace("{{coreMemory}}", coreMemory),
        )
          .then(parseStarters)
          .catch((error: unknown) => {
            console.error("[onboarding] Synthesis starters failed.", error);
            return null;
          })
      : Promise.resolve(null),
  ]);

  return {
    coreMemory,
    welcomeMessage: welcomeMessage || DEFAULT_WELCOME_MESSAGE,
    ...(finale ?? {}),
  };
};

export const registerOnboardingHandlers = (
  options: OnboardingHandlersOptions,
) => {
  handleIpc(
    IPC_ONBOARDING_SYNTHESIZE,
    async (event, payload: OnboardingSynthesisRequest) => {
      if (!options.assertPrivilegedSender(event, IPC_ONBOARDING_SYNTHESIZE)) {
        throw new Error(
          "Blocked untrusted onboarding:synthesizeCoreMemory request.",
        );
      }
      if (!(await options.whenRuntimeAuthenticated())) {
        throw new Error("Sign in to Stella to finish setting up.");
      }
      const runner = options.getStellaHostRunner();
      if (!runner) throw new Error("Stella runtime is not ready.");
      return await synthesize(runner, payload);
    },
  );
};
