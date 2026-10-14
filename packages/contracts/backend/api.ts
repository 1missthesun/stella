import type { AgentEventViews } from "./agent-events.js";
import type { AgentReportCalls, AgentReportViews } from "./agent-reports.js";
import type { AgentThreadCalls, AgentThreadViews } from "./agent-threads.js";
import type { AppSourceCalls, AppSourceViews } from "./app-source.js";
import type { BillingCalls, BillingViews } from "./billing.js";
import type { DeviceCalls, DeviceViews } from "./devices.js";
import type { ConversationCalls, ConversationViews } from "./conversations.js";
import type { HomeCalls, HomeViews } from "./home.js";
import type { DriveCalls, DriveViews } from "./drive.js";
import type { ScheduleCalls, ScheduleViews } from "./schedules.js";
import type { PreferenceCalls, PreferenceViews } from "./preferences.js";
import type { AccountCalls } from "./account.js";
import type { ShareCalls, ShareViews } from "./shares.js";
import type { SearchCalls } from "./search.js";
import type { MediaCalls, MediaViews } from "./media.js";
import type { VoiceCalls } from "./voice.js";
import type { IntegrationCalls, IntegrationViews } from "./integrations.js";
import type { EngineCalls, EngineViews } from "./engines.js";
import type { ProviderCalls, ProviderViews } from "./providers.js";
import type { ProjectCalls, ProjectViews } from "./projects.js";
import type { BrowserCalls, BrowserViews } from "./browser.js";
import type { UserAskCalls, UserAskViews } from "./user-asks.js";
import type { ClaudeSessionCalls } from "./claude-sessions.js";
import type { AgentLogCalls } from "./agent-logs.js";
import type { EmailDigestCalls, EmailDigestViews } from "./email-digest.js";
import type { McpServerCalls } from "./mcp-servers.js";
import type { CatchUpCalls, CatchUpViews } from "./catch-ups.js";

type SystemCalls = {
  "system.ping": { args: Record<string, never>; result: { now: number } };
};

export type BackendCalls = SystemCalls &
  ConversationCalls &
  AgentThreadCalls &
  AgentReportCalls &
  BillingCalls &
  DeviceCalls &
  AppSourceCalls &
  HomeCalls &
  DriveCalls &
  ScheduleCalls &
  PreferenceCalls &
  AccountCalls &
  ShareCalls &
  SearchCalls &
  MediaCalls &
  VoiceCalls &
  IntegrationCalls &
  EngineCalls &
  ProviderCalls &
  ProjectCalls &
  BrowserCalls &
  UserAskCalls &
  ClaudeSessionCalls &
  AgentLogCalls &
  EmailDigestCalls &
  McpServerCalls &
  CatchUpCalls;
export type BackendViews = ConversationViews &
  AppSourceViews &
  AgentThreadViews &
  AgentEventViews &
  AgentReportViews &
  BillingViews &
  DeviceViews &
  HomeViews &
  DriveViews &
  ScheduleViews &
  PreferenceViews &
  ShareViews &
  MediaViews &
  IntegrationViews &
  EngineViews &
  ProviderViews &
  ProjectViews &
  BrowserViews &
  UserAskViews &
  EmailDigestViews &
  CatchUpViews;

export type CallName = keyof BackendCalls & string;
export type ViewName = keyof BackendViews & string;

type ArgsOf<T> = T extends { args: infer A } ? A : never;
type ResultOf<T> = T extends { result: infer R } ? R : never;

export type CallArgs<K extends CallName> = ArgsOf<BackendCalls[K]>;
export type CallResult<K extends CallName> = ResultOf<BackendCalls[K]>;
export type ViewArgs<K extends ViewName> = ArgsOf<BackendViews[K]>;
export type ViewResult<K extends ViewName> = ResultOf<BackendViews[K]>;
