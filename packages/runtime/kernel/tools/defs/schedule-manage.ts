import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import {
  handleScheduleAdd,
  handleScheduleList,
  handleScheduleRemove,
  handleScheduleUpdate,
} from "../schedule.js";
import type { ScheduleToolApi, ToolDefinition } from "../types.js";
import {
  SCHEDULE_ADD_TOOL_DESCRIPTOR,
  SCHEDULE_LIST_TOOL_DESCRIPTOR,
  SCHEDULE_REMOVE_TOOL_DESCRIPTOR,
  SCHEDULE_SEARCH_TERMS,
  SCHEDULE_UPDATE_TOOL_DESCRIPTOR,
} from "./schedule-manage-def.js";

export type ScheduleManageOptions = {
  scheduleApi?: ScheduleToolApi;
};

const SCHEDULE_AGENT_TYPES = [
  AGENT_IDS.ORCHESTRATOR,
  AGENT_IDS.GENERAL,
] as const;

export const createScheduleManageTools = (
  options: ScheduleManageOptions,
): ToolDefinition[] => [
  {
    ...SCHEDULE_ADD_TOOL_DESCRIPTOR,
    replay: "unsafe",
    agentTypes: SCHEDULE_AGENT_TYPES,
    demoted: { searchTerms: SCHEDULE_SEARCH_TERMS },
    execute: async (args, context) => {
      try {
        return await handleScheduleAdd(options.scheduleApi, args, context);
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
  },
  {
    ...SCHEDULE_LIST_TOOL_DESCRIPTOR,
    replay: "safe",
    agentTypes: SCHEDULE_AGENT_TYPES,
    demoted: { searchTerms: SCHEDULE_SEARCH_TERMS },
    execute: async (_args, context) => {
      try {
        return await handleScheduleList(options.scheduleApi, context);
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
  },
  {
    ...SCHEDULE_UPDATE_TOOL_DESCRIPTOR,
    replay: "unsafe",
    agentTypes: SCHEDULE_AGENT_TYPES,
    demoted: { searchTerms: SCHEDULE_SEARCH_TERMS },
    execute: async (args) => {
      try {
        return await handleScheduleUpdate(options.scheduleApi, args);
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
  },
  {
    ...SCHEDULE_REMOVE_TOOL_DESCRIPTOR,
    replay: "unsafe",
    agentTypes: SCHEDULE_AGENT_TYPES,
    demoted: { searchTerms: SCHEDULE_SEARCH_TERMS },
    execute: async (args) => {
      try {
        return await handleScheduleRemove(options.scheduleApi, args);
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
  },
];
