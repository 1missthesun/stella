/**
 * Settings' prompt presets, onboarding's prompts, resetting customizations
 * and reading a skill's frontmatter. They read the runtime's own prompt and
 * home files (and YAML), so they run here rather than in Electron main.
 */
import {
  getPromptPresetSelection,
  setPromptPresetSelection,
} from "@stella/node-shared/preferences/local-preferences.js";

const loadPresets = () => import("../../kernel/prompts/prompt-presets.js");

const presetAgentId = async (agentId: unknown): Promise<string> => {
  const { isCustomizablePromptAgentId } = await loadPresets();
  if (typeof agentId !== "string" || !isCustomizablePromptAgentId(agentId)) {
    throw new Error("Unknown prompt agent.");
  }
  return agentId;
};

type PresetRequest = { agentId?: unknown; presetId?: unknown } | null | undefined;

export const listPromptPresetsForApp = async (dir: string, request: PresetRequest) => {
  const agentId = await presetAgentId(request?.agentId);
  const { listPromptPresets } = await loadPresets();
  return {
    presets: await listPromptPresets(dir, agentId as never),
    selectedId: getPromptPresetSelection(dir, agentId),
  };
};

export const readPromptPresetForApp = async (dir: string, request: PresetRequest) => {
  const agentId = await presetAgentId(request?.agentId);
  const id = String(request?.presetId ?? "");
  if (id === "default") {
    const { loadAgentSystemPrompt } = await import("../../kernel/agents/home-agent-prompt.js");
    const content = (await loadAgentSystemPrompt(agentId as never)) ?? "";
    return { id: "default", name: "default", agentId, content };
  }
  const { readPromptPreset } = await loadPresets();
  return await readPromptPreset(dir, agentId as never, id);
};

export const savePromptPresetForApp = async (
  dir: string,
  request:
    | { agentId?: unknown; id?: unknown; name?: unknown; content?: unknown; select?: unknown }
    | null
    | undefined,
) => {
  const agentId = await presetAgentId(request?.agentId);
  const { savePromptPreset } = await loadPresets();
  const result = await savePromptPreset(dir, {
    agentId: agentId as never,
    id: typeof request?.id === "string" && request.id ? request.id : undefined,
    name: String(request?.name ?? ""),
    content: String(request?.content ?? ""),
  });
  if (result.ok && request?.select === true) {
    setPromptPresetSelection(dir, agentId, result.preset.id);
  }
  return result;
};

export const deletePromptPresetForApp = async (dir: string, request: PresetRequest) => {
  const agentId = await presetAgentId(request?.agentId);
  const id = String(request?.presetId ?? "");
  const { deletePromptPreset } = await loadPresets();
  const ok = await deletePromptPreset(dir, agentId as never, id);
  if (ok && getPromptPresetSelection(dir, agentId) === id) {
    setPromptPresetSelection(dir, agentId, "default");
  }
  return { ok, selectedId: getPromptPresetSelection(dir, agentId) };
};

export const selectPromptPresetForApp = async (dir: string, request: PresetRequest) => {
  const agentId = await presetAgentId(request?.agentId);
  const id = String(request?.presetId ?? "default");
  const { readPromptPreset } = await loadPresets();
  if (id !== "default" && !(await readPromptPreset(dir, agentId as never, id))) {
    return { ok: false, selectedId: getPromptPresetSelection(dir, agentId) };
  }
  setPromptPresetSelection(dir, agentId, id);
  return { ok: true, selectedId: getPromptPresetSelection(dir, agentId) };
};

export const readRuntimePromptForApp = async (
  request: { id?: unknown } | null | undefined,
): Promise<string | null> => {
  const { readRuntimePrompt } = await import("../../kernel/prompts/home-prompts.js");
  return readRuntimePrompt(typeof request?.id === "string" ? request.id : "") ?? null;
};

/** Seed the home folder from the app: outputs README, bundled skills, layout migrations. */
export const seedStellaDataDir = async (stellaAppDir: string, stellaDataDir: string) => {
  const { ensureStellaDataDirSeeded } = await import("../../kernel/home/stella-home.js");
  return await ensureStellaDataDirSeeded(stellaAppDir, stellaDataDir);
};

export const resetCustomizationsForApp = async (stellaAppDir: string, stellaDataDir: string) => {
  const { resetStellaCustomizations } = await import(
    "../../kernel/home/reset-customizations.js"
  );
  const path = await import("node:path");
  try {
    const result = await resetStellaCustomizations(stellaDataDir);
    if (result.movedEntries.some((entry) => entry.startsWith(`skills${path.sep}`))) {
      await seedStellaDataDir(stellaAppDir, stellaDataDir);
    }
    if (result.failed) {
      return {
        ok: false,
        movedEntries: result.movedEntries,
        trashDir: result.trashDir,
        error: `Couldn't move ${result.failed.entry} (${result.failed.message}); it and everything after it are unchanged. ${result.movedEntries.length} moved to ${result.trashDir}.`,
      };
    }
    return { ok: true, movedEntries: result.movedEntries, trashDir: result.trashDir };
  } catch (error) {
    return {
      ok: false,
      movedEntries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const readSkillFrontmatter = async (
  request: { markdown?: unknown } | null | undefined,
): Promise<Record<string, unknown>> => {
  const { extractFrontmatterAsync } = await import("../../kernel/frontmatter.js");
  return (await extractFrontmatterAsync(typeof request?.markdown === "string" ? request.markdown : ""))
    .metadata as Record<string, unknown>;
};
