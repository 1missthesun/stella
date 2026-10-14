"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronRight,
  Globe,
  KeyRound,
  Lock,
  Plus,
  Undo2,
  X,
} from "lucide-react";
import type { ReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import {
  SLACK_GITHUB_ERROR_PARAM,
  SLACK_GITHUB_RESULT_PARAM,
  SLACK_INSTALL_RESULT_PARAM,
  SLACK_ENV_NAME_MAX_CHARS,
  SLACK_ENV_VARS_MAX_CHARS,
  SLACK_MEMORY_MAX_CHARS,
  SLACK_PREVIEW_TTL_DAYS_CHOICES,
  SLACK_REPO_RULES_MAX_CHARS,
  SLACK_REPOS_MAX,
  SLACK_RULES_MAX_CHARS,
  SLACK_SETUP_SCRIPT_MAX_CHARS,
  type SlackNetworkLevel,
  type SlackNetworkSecretInput,
  type SlackWorkspaceEnvironment,
  type SlackWorkspaceEnvironmentUpdate,
  type SlackGithubInstallationChoice,
  type SlackPreviewAccess,
  type SlackRepoUpdate,
  type SlackWorkspaceGithub,
  type SlackWorkspacePreviews,
  type SlackWorkspaceRepo,
  type SlackGithubRepoOption,
  type SlackInstallResult,
  type SlackWorkspace,
  type SlackWorkspaceEngine,
  type SlackWorkspaceOptions,
  type SlackWorkspaceUpdate,
  type SlackWorkspacesResponse,
} from "@stella/contracts/slack-workspace";
import { openSignInDialog } from "@/components/auth/sign-in-dialog";
import { authClient } from "@/lib/auth-client";
import { isBackendConfigured } from "@/lib/backend-url";
import {
  addSlackRepo,
  connectGithub,
  disconnectGithub,
  finishGithub,
  listGithubBranches,
  listGithubRepos,
  listSlackWorkspaces,
  removeSlackRepo,
  startSlackInstall,
  updateSlackRepo,
  updateSlackWorkspace,
} from "./crew-api";
import { readMockMode, type SlackMockMode } from "./crew-mock";
import s from "./crew.module.css";


const EFFORT_LABELS: Record<ReasoningEffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const normalizeRepo = (value: string): string =>
  value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");

const installedDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const isInstallResult = (value: string | null): value is SlackInstallResult =>
  value === "installed" || value === "canceled" || value === "failed";

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";

/** What GitHub handed back after "Connect GitHub" for one workspace. */
type GithubReturn = { teamId: string; code: string | null; error: string | null };

type Boot = { mock: SlackMockMode | null; result: SlackInstallResult | null; github: GithubReturn | null };

let bootSnapshot: Boot | null = null;

const RETURN_PARAMS = [SLACK_INSTALL_RESULT_PARAM, SLACK_GITHUB_RESULT_PARAM, SLACK_GITHUB_ERROR_PARAM, "team"];

const readBoot = (): Boot => {
  if (!bootSnapshot) {
    const params = new URL(window.location.href).searchParams;
    const raw = params.get(SLACK_INSTALL_RESULT_PARAM);
    const code = params.get(SLACK_GITHUB_RESULT_PARAM);
    const error = params.get(SLACK_GITHUB_ERROR_PARAM);
    const teamId = params.get("team");
    bootSnapshot = {
      mock: readMockMode(),
      result: isInstallResult(raw) ? raw : null,
      github: teamId && (code || error) ? { teamId, code, error } : null,
    };
  }
  return bootSnapshot;
};

const subscribeNever = () => () => {};


export function CrewClient() {
  const boot = useSyncExternalStore(subscribeNever, readBoot, () => null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!RETURN_PARAMS.some((name) => url.searchParams.has(name))) return;
    for (const name of RETURN_PARAMS) url.searchParams.delete(name);
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (boot === null) return <Loading />;
  if (boot.mock) return <Account installResult={boot.result} githubReturn={boot.github} />;
  if (!isBackendConfigured()) {
    return (
      <Shell>
        <Notice title="Not available here">This build of the site isn&apos;t connected to Stella.</Notice>
      </Shell>
    );
  }
  return <SessionGate installResult={boot.result} githubReturn={boot.github} />;
}

/** The page frame: title row, then whatever the state calls for. */
function Shell({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={s.shell}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Crew</h1>
          <p className={s.pageLede}>Stella in your Slack workspace. Set how she works and what her agents run with.</p>
        </div>
        {action ? <div className={s.pageAction}>{action}</div> : null}
      </header>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <Shell>
      <div className={s.loading} aria-live="polite">
        <span className={s.spinner} aria-hidden="true" />
        Loading
      </div>
    </Shell>
  );
}

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={s.notice}>
      <h2 className={s.noticeTitle}>{title}</h2>
      <p className={s.noticeText}>{children}</p>
      {action ? <div className={s.noticeActions}>{action}</div> : null}
    </div>
  );
}

function SessionGate({
  installResult,
  githubReturn,
}: {
  installResult: SlackInstallResult | null;
  githubReturn: GithubReturn | null;
}) {
  const session = authClient.useSession();
  if (session.isPending) return <Loading />;
  const user = (session.data as { user?: { id?: string; isAnonymous?: boolean | null } } | null)?.user;
  if (!user || user.isAnonymous) return <SignedOut installResult={installResult} />;
  return <Account key={user.id ?? "user"} installResult={installResult} githubReturn={githubReturn} />;
}

function SignedOut({ installResult }: { installResult: SlackInstallResult | null }) {
  return (
    <Shell>
      {installResult ? <InstallBanner result={installResult} /> : null}
      <Notice
        title="Sign in to set up Crew"
        action={
          <button type="button" className={s.primary} onClick={() => openSignInDialog()}>
            Sign in
          </button>
        }
      >
        The Stella account that adds her to a workspace owns her there, and her work in Slack runs on that
        account&apos;s plan.
      </Notice>
    </Shell>
  );
}

const INSTALL_MESSAGES: Record<SlackInstallResult, { tone: "ok" | "warn" | "error"; text: string }> = {
  installed: {
    tone: "ok",
    text: "Stella is in your Slack workspace. Tag @Stella in any channel, or DM her, to start.",
  },
  canceled: { tone: "warn", text: "You canceled the Slack install. Nothing was added." },
  failed: { tone: "error", text: "Slack couldn't finish adding Stella. Try again." },
};

function InstallBanner({ result }: { result: SlackInstallResult }) {
  const message = INSTALL_MESSAGES[result];
  return (
    <p className={`${s.banner} ${s[`banner_${message.tone}`]}`} role="status">
      {message.text}
    </p>
  );
}

function Account({
  installResult,
  githubReturn,
}: {
  installResult: SlackInstallResult | null;
  githubReturn: GithubReturn | null;
}) {
  const [data, setData] = useState<SlackWorkspacesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(githubReturn?.teamId ?? null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await listSlackWorkspaces());
    } catch (error) {
      setLoadError(errorText(error));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSlackWorkspaces().then(
      (value) => {
        if (!cancelled) setData(value);
      },
      (error) => {
        if (!cancelled) setLoadError(errorText(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    setInstalling(true);
    setInstallError(null);
    try {
      const returnTo = new URL(window.location.pathname, window.location.origin);
      const mock = new URL(window.location.href).searchParams.get("mock");
      if (mock) returnTo.searchParams.set("mock", mock);
      const { url } = await startSlackInstall(returnTo.toString());
      window.location.assign(url);
    } catch (error) {
      setInstallError(errorText(error));
      setInstalling(false);
    }
  }, []);

  const replaceWorkspace = useCallback((next: SlackWorkspace) => {
    setData((current) =>
      current
        ? {
            ...current,
            workspaces: current.workspaces.map((w) => (w.teamId === next.teamId ? next : w)),
          }
        : current,
    );
  }, []);

  const banner = installResult ? <InstallBanner result={installResult} /> : null;

  if (loadError) {
    return (
      <Shell>
        {banner}
        <Notice
          title="Couldn't load your workspaces"
          action={
            <button type="button" className={s.secondary} onClick={() => void load()}>
              Try again
            </button>
          }
        >
          <span className={s.errorText}>{loadError}</span>
        </Notice>
      </Shell>
    );
  }
  if (!data) return <Loading />;
  if (!data.available) {
    return (
      <Shell>
        {banner}
        <Notice title="Not available yet">Stella Crew isn&apos;t switched on for this server yet.</Notice>
      </Shell>
    );
  }

  if (data.workspaces.length === 0) {
    return (
      <Shell>
        {banner}
        <div className={s.empty}>
          <SlackLogo />
          <h2 className={s.noticeTitle}>Add Stella to a Slack workspace</h2>
          <ol className={s.steps}>
            <li>Pick a workspace in Slack and approve Stella.</li>
            <li>Anyone there can tag @Stella in a channel or DM her.</li>
            <li>Her work runs on this Stella account, and you set how she works here.</li>
          </ol>
          <button type="button" className={s.slackButton} onClick={() => void install()} disabled={installing}>
            <SlackLogo />
            {installing ? "Opening Slack…" : "Add to Slack"}
          </button>
          {installError ? <p className={s.errorText}>{installError}</p> : null}
        </div>
      </Shell>
    );
  }

  const current =
    data.workspaces.find((workspace) => workspace.teamId === selected) ?? data.workspaces[0]!;

  return (
    <Shell
      action={
        <button type="button" className={s.secondary} onClick={() => void install()} disabled={installing}>
          <Plus size={15} aria-hidden="true" />
          {installing ? "Opening Slack…" : "Add workspace"}
        </button>
      }
    >
      {banner}
      {installError ? <p className={`${s.banner} ${s.banner_error}`}>{installError}</p> : null}
      <WorkspaceBar workspaces={data.workspaces} current={current} onSelect={setSelected} />
      {data.workspaces.map((workspace) => (
        <WorkspaceSettings
          key={workspace.teamId}
          active={workspace.teamId === current.teamId}
          workspace={workspace}
          options={data.options}
          githubAvailable={data.githubAvailable}
          githubReturn={githubReturn?.teamId === workspace.teamId ? githubReturn : null}
          onUpdated={replaceWorkspace}
        />
      ))}
    </Shell>
  );
}

function WorkspaceBar({
  workspaces,
  current,
  onSelect,
}: {
  workspaces: SlackWorkspace[];
  current: SlackWorkspace;
  onSelect: (teamId: string) => void;
}) {
  const initial = (workspace: SlackWorkspace) => workspace.teamName.trim().charAt(0).toUpperCase() || "#";
  return (
    <div className={s.workspaceBar}>
      {workspaces.length > 1 ? (
        <div className={s.workspaceTabs} role="tablist" aria-label="Workspaces">
          {workspaces.map((workspace) => (
            <button
              key={workspace.teamId}
              type="button"
              role="tab"
              aria-selected={workspace.teamId === current.teamId}
              className={s.workspaceTab}
              onClick={() => onSelect(workspace.teamId)}
            >
              <span className={s.workspaceAvatar} aria-hidden="true">
                {initial(workspace)}
              </span>
              {workspace.teamName}
            </button>
          ))}
        </div>
      ) : (
        <div className={s.workspaceIdentity}>
          <span className={s.workspaceAvatar} aria-hidden="true">
            {initial(current)}
          </span>
          <span className={s.workspaceName}>{current.teamName}</span>
        </div>
      )}
      <div className={s.workspaceMeta}>
        <span>Connected {installedDate.format(new Date(current.installedAt))}</span>
        <a className={s.textLink} href={current.slackUrl} target="_blank" rel="noopener noreferrer">
          Open in Slack
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

/** What can be edited for a repository, or for work without one (`key` ""). */
type TargetDraft = {
  branch: string;
  rules: string;
  removeChannels: string[];
  previewAccess: SlackPreviewAccess;
  previewTtlDays: number;
  envName: string;
  network: SlackNetworkLevel;
  allowedHosts: string;
  setupScript: string;
  envVars: string;
  secretsAdd: SlackNetworkSecretInput[];
  secretsRemove: string[];
};

type Draft = {
  engine: SlackWorkspaceEngine;
  model: string;
  effort: ReasoningEffortLevel;
  slackCommands: boolean;
  rules: string;
  memory: string;
  targets: Record<string, TargetDraft>;
};

/** A repository, or (`repo` null, `key` "") work that isn't about one. */
type Target = {
  key: string;
  repo: SlackWorkspaceRepo | null;
  environment: SlackWorkspaceEnvironment | null;
  previews: SlackWorkspacePreviews;
};

const NO_REPO = "";

const targetsOf = (w: SlackWorkspace): Target[] => [
  ...w.repos.map((repo) => ({ key: repo.id, repo, environment: repo.environment, previews: repo.previews })),
  { key: NO_REPO, repo: null, environment: w.environment, previews: w.previews },
];

const targetLabel = (target: Target): string => target.repo?.fullName ?? "Without a repository";

const hostsText = (hosts: string[]): string => hosts.join("\n");
const hostsList = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((host) => host.trim())
    .filter(Boolean);

const targetDraftFrom = (t: Target): TargetDraft => ({
  branch: t.repo?.branch ?? "",
  rules: t.repo?.rules ?? "",
  removeChannels: [],
  previewAccess: t.previews.access,
  previewTtlDays: t.previews.ttlDays,
  envName: t.environment?.name ?? "",
  network: t.environment?.network ?? "full",
  allowedHosts: hostsText(t.environment?.allowedHosts ?? []),
  setupScript: t.environment?.setupScript ?? "",
  envVars: t.environment?.envVars ?? "",
  secretsAdd: [],
  secretsRemove: [],
});

const draftFrom = (w: SlackWorkspace): Draft => ({
  engine: w.engine,
  model: w.model,
  effort: w.effort,
  slackCommands: w.slackCommands,
  rules: w.rules,
  memory: w.memory,
  targets: Object.fromEntries(targetsOf(w).map((target) => [target.key, targetDraftFrom(target)])),
});

const environmentDiff = (
  e: SlackWorkspaceEnvironment | null,
  d: TargetDraft,
): SlackWorkspaceEnvironmentUpdate | null => {
  if (!e) return null;
  const update: SlackWorkspaceEnvironmentUpdate = {};
  if (d.envName.trim() !== e.name) update.name = d.envName.trim();
  if (d.network !== e.network) update.network = d.network;
  if (hostsList(d.allowedHosts).join("\n") !== e.allowedHosts.join("\n")) update.allowedHosts = hostsList(d.allowedHosts);
  if (d.setupScript !== e.setupScript) update.setupScript = d.setupScript;
  if (d.envVars !== e.envVars) update.envVars = d.envVars;
  if (d.secretsAdd.length || d.secretsRemove.length) {
    update.secrets = {
      ...(d.secretsAdd.length ? { add: d.secretsAdd } : {}),
      ...(d.secretsRemove.length ? { remove: d.secretsRemove } : {}),
    };
  }
  return Object.keys(update).length ? update : null;
};

const previewsDiff = (p: SlackWorkspacePreviews, d: TargetDraft): SlackWorkspaceUpdate["previews"] | null =>
  d.previewAccess !== p.access || d.previewTtlDays !== p.ttlDays
    ? {
        ...(d.previewAccess !== p.access ? { access: d.previewAccess } : {}),
        ...(d.previewTtlDays !== p.ttlDays ? { ttlDays: d.previewTtlDays } : {}),
      }
    : null;

const workspaceDiff = (w: SlackWorkspace, d: Draft): SlackWorkspaceUpdate => {
  const update: SlackWorkspaceUpdate = {};
  if (d.engine !== w.engine) update.engine = d.engine;
  if (d.model !== w.model) update.model = d.model;
  if (d.effort !== w.effort) update.effort = d.effort;
  if (d.slackCommands !== w.slackCommands) update.slackCommands = d.slackCommands;
  if (d.rules !== w.rules) update.rules = d.rules;
  if (d.memory !== w.memory) update.memory = d.memory;
  const own = d.targets[NO_REPO];
  if (own) {
    const previews = previewsDiff(w.previews, own);
    if (previews) update.previews = previews;
    const environment = environmentDiff(w.environment, own);
    if (environment) update.environment = environment;
  }
  return update;
};

const repoDiff = (repo: SlackWorkspaceRepo, d: TargetDraft | undefined): SlackRepoUpdate => {
  const update: SlackRepoUpdate = {};
  if (!d) return update;
  if (d.branch.trim() !== repo.branch) update.branch = d.branch.trim();
  if (d.rules !== repo.rules) update.rules = d.rules;
  if (d.removeChannels.length) update.removeChannels = d.removeChannels;
  const previews = previewsDiff(repo.previews, d);
  if (previews) update.previews = previews;
  const environment = environmentDiff(repo.environment, d);
  if (environment) update.environment = environment;
  return update;
};

const targetInvalid = (t: Target, d: TargetDraft | undefined): boolean =>
  Boolean(
    d &&
      ((t.environment !== null && !d.envName.trim()) ||
        d.envName.length > SLACK_ENV_NAME_MAX_CHARS ||
        d.setupScript.length > SLACK_SETUP_SCRIPT_MAX_CHARS ||
        d.envVars.length > SLACK_ENV_VARS_MAX_CHARS ||
        d.rules.length > SLACK_REPO_RULES_MAX_CHARS),
  );

type NavChild = { id: string; label: string; onSelect?: () => void; current?: boolean };
type NavItem = { id: string; label: string; children?: NavChild[] };

/** The id of the last section whose top has scrolled past the header. */
function useActiveSection(ids: string[], enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join(" ");
  useEffect(() => {
    if (!enabled) return;
    const list = key.split(" ");
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = list[0] ?? null;
      for (const id of list) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= 140) current = id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atEnd ? (list[list.length - 1] ?? current) : current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [key, enabled]);
  return active;
}

const scrollToId = (id: string) =>
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));

function SectionNav({ items, active }: { items: NavItem[]; active: string | null }) {
  const go = (event: React.MouseEvent<HTMLAnchorElement>, id: string, onSelect?: () => void) => {
    if (!document.getElementById(id)) return;
    event.preventDefault();
    onSelect?.();
    scrollToId(id);
  };
  return (
    <nav className={s.sectionNav} aria-label="Settings sections">
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? "true" : undefined}
              data-within={item.children?.some((child) => child.id === active) ? "" : undefined}
              onClick={(event) => go(event, item.id)}
            >
              {item.label}
            </a>
            {item.children ? (
              <ul className={s.sectionNavSub}>
                {item.children.map((child) => (
                  <li key={`${child.id}-${child.label}`}>
                    <a
                      href={`#${child.id}`}
                      className={child.onSelect ? s.navRepo : undefined}
                      aria-current={(child.onSelect ? child.current : active === child.id) ? "true" : undefined}
                      onClick={(event) => go(event, child.id, child.onSelect)}
                    >
                      {child.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({
  id,
  title,
  eyebrow,
  description,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={s.section} id={id} aria-labelledby={`${id}-title`}>
      <header className={s.sectionHead}>
        {eyebrow ? <p className={s.sectionEyebrow}>{eyebrow}</p> : null}
        <h2 className={s.sectionTitle} id={`${id}-title`}>
          {title}
        </h2>
        {description ? <p className={s.sectionLede}>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Group({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={s.group} id={id}>
      <div className={s.groupHead}>
        <h3 className={s.groupTitle}>{title}</h3>
        {description ? <p className={s.groupLede}>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** One setting: its name and explanation on the left, the control on the right. */
function Row({
  label,
  hint,
  htmlFor,
  stack = false,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  stack?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={s.row} data-stack={stack ? "" : undefined}>
      <div className={s.rowText}>
        {htmlFor ? (
          <label className={s.rowLabel} htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className={s.rowLabel}>{label}</span>
        )}
        {hint ? <p className={s.rowHint}>{hint}</p> : null}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  );
}

type Choice<T extends string> = { id: T; label: string; detail: string; icon?: React.ReactNode };

function RadioList<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: Array<Choice<T>>;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <div className={s.radioList} role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <label key={choice.id} className={s.radio} data-checked={value === choice.id ? "" : undefined}>
          <input
            type="radio"
            name={name}
            value={choice.id}
            checked={value === choice.id}
            onChange={() => onChange(choice.id)}
          />
          <span className={s.radioDot} aria-hidden="true" />
          <span className={s.radioText}>
            <span className={s.radioLabel}>
              {choice.icon}
              {choice.label}
            </span>
            <span className={s.radioDetail}>{choice.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={s.switch}
      data-on={checked ? "" : undefined}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

type Loaded<T> = { key: string } & ({ value: T } | { message: string });

/** The result for `key`, or loading while the latest result is for another key. */
const loadable = <T,>(key: string | null, loaded: Loaded<T> | null) =>
  !key
    ? ({ state: "idle" } as const)
    : !loaded || loaded.key !== key
      ? ({ state: "loading" } as const)
      : "value" in loaded
        ? ({ state: "ready", value: loaded.value } as const)
        : ({ state: "error", message: loaded.message } as const);

/** Repositories the workspace's GitHub connections can see. */
function useGithubRepos(teamId: string, connected: boolean, refresh: number) {
  const [loaded, setLoaded] = useState<Loaded<SlackGithubRepoOption[]> | null>(null);
  const key = connected ? `${teamId}:${refresh}` : null;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    listGithubRepos(teamId).then(
      ({ repos }) => {
        if (!cancelled) setLoaded({ key, value: repos });
      },
      (failure) => {
        if (!cancelled) setLoaded({ key, message: errorText(failure) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, teamId]);
  return loadable(key, loaded);
}

function WorkspaceSettings({
  active,
  workspace,
  options,
  githubAvailable,
  githubReturn,
  onUpdated,
}: {
  active: boolean;
  workspace: SlackWorkspace;
  options: SlackWorkspaceOptions;
  githubAvailable: boolean;
  githubReturn: GithubReturn | null;
  onUpdated: (workspace: SlackWorkspace) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(workspace));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string>(() => workspace.repos[0]?.id ?? NO_REPO);
  const [reposRefresh, setReposRefresh] = useState(0);

  const targets = useMemo(() => targetsOf(workspace), [workspace]);
  const target = targets.find((t) => t.key === selected) ?? targets[0]!;
  const targetDraft = draft.targets[target.key] ?? targetDraftFrom(target);

  const workspaceUpdate = useMemo(() => workspaceDiff(workspace, draft), [workspace, draft]);
  const repoUpdates = useMemo(
    () =>
      workspace.repos
        .map((repo) => ({ repo, update: repoDiff(repo, draft.targets[repo.id]) }))
        .filter((entry) => Object.keys(entry.update).length > 0),
    [workspace, draft],
  );
  const dirty = Object.keys(workspaceUpdate).length > 0 || repoUpdates.length > 0;
  const dirtyKeys = new Set([
    ...repoUpdates.map((entry) => entry.repo.id),
    ...(workspaceUpdate.environment || workspaceUpdate.previews ? [NO_REPO] : []),
  ]);

  const connectedAccounts = workspace.githubAccounts.filter((account) => account.status === "active");
  const githubRepos = useGithubRepos(workspace.teamId, connectedAccounts.length > 0, reposRefresh);

  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), 2400);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSavedAt(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const setTarget = <K extends keyof TargetDraft>(key: K, value: TargetDraft[K]) => {
    setSavedAt(null);
    setDraft((current) => ({
      ...current,
      targets: {
        ...current.targets,
        [target.key]: { ...(current.targets[target.key] ?? targetDraftFrom(target)), [key]: value },
      },
    }));
  };

  /** The page after a change saved elsewhere (GitHub, add, remove): unsaved edits stay. */
  const rebase = useCallback(
    (next: SlackWorkspace) => {
      onUpdated(next);
      setDraft((current) => {
        const fresh = draftFrom(next);
        const kept: Record<string, TargetDraft> = {};
        for (const key of Object.keys(fresh.targets)) kept[key] = current.targets[key] ?? fresh.targets[key]!;
        return { ...current, targets: kept };
      });
    },
    [onUpdated],
  );

  const models = options.models[draft.engine] ?? [];
  const modelKnown = models.some((m) => m.id === draft.model);

  const chooseEngine = (engine: SlackWorkspaceEngine) => {
    setSavedAt(null);
    setDraft((current) => {
      if (current.engine === engine) return current;
      const list = options.models[engine] ?? [];
      const model = list.some((m) => m.id === current.model) ? current.model : (list[0]?.id ?? "");
      return { ...current, engine, model };
    });
  };

  const rulesOver = draft.rules.length > SLACK_RULES_MAX_CHARS;
  const memoryOver = draft.memory.length > SLACK_MEMORY_MAX_CHARS;
  const invalid =
    rulesOver || memoryOver || !draft.model || targets.some((t) => targetInvalid(t, draft.targets[t.key]));

  const save = async () => {
    if (!dirty || invalid || saving) return;
    setSaving(true);
    setSaveError(null);
    let latest: SlackWorkspace | null = null;
    const saved = new Set<string>();
    try {
      if (Object.keys(workspaceUpdate).length) {
        latest = (await updateSlackWorkspace(workspace.teamId, workspaceUpdate)).workspace;
        saved.add(NO_REPO);
      }
      for (const { repo, update } of repoUpdates) {
        latest = (await updateSlackRepo(workspace.teamId, repo.id, update)).workspace;
        saved.add(repo.id);
      }
      setSavedAt(Date.now());
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      if (latest) {
        const next = latest;
        onUpdated(next);
        setDraft((current) => {
          const fresh = draftFrom(next);
          if (saved.has(NO_REPO)) {
            for (const field of ["engine", "model", "effort", "slackCommands", "rules", "memory"] as const) {
              (current as Record<string, unknown>)[field] = fresh[field];
            }
          }
          const nextTargets: Record<string, TargetDraft> = {};
          for (const key of Object.keys(fresh.targets)) {
            nextTargets[key] = saved.has(key) ? fresh.targets[key]! : (current.targets[key] ?? fresh.targets[key]!);
          }
          return { ...current, targets: nextTargets };
        });
      }
      setSaving(false);
    }
  };

  const discard = () => {
    setSaveError(null);
    setDraft(draftFrom(workspace));
  };

  const id = (name: string) => `${workspace.teamId}-${name}`;

  const selectTarget = (key: string) => setSelected(key);

  const added = (next: SlackWorkspace, repoId: string) => {
    rebase(next);
    setSelected(repoId);
    scrollToId(id("repo"));
  };

  const removeSelected = async () => {
    const repo = target.repo;
    if (!repo) return;
    const message = `Remove ${repo.fullName} from ${workspace.teamName}? Its environment, secrets and rules are deleted, and new agents can't work in it.`;
    if (!window.confirm(message)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { workspace: next } = await removeSlackRepo(workspace.teamId, repo.id);
      rebase(next);
      setSelected(next.repos[0]?.id ?? NO_REPO);
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const label = targetLabel(target);
  const nav: NavItem[] = [
    { id: id("general"), label: "General" },
    ...(githubAvailable ? [{ id: id("github"), label: "GitHub" }] : []),
    {
      id: id("repos"),
      label: "Repositories",
      children: targets.map((t) => ({
        id: id("repo"),
        label: t.repo ? (t.repo.fullName.split("/")[1] ?? t.repo.fullName) : "Without a repository",
        current: t.key === target.key,
        onSelect: () => selectTarget(t.key),
      })),
    },
    ...(target.environment
      ? [
          {
            id: id("environment"),
            label: "Environment",
            children: [
              { id: id("network"), label: "Network" },
              { id: id("secrets"), label: "Secrets" },
              { id: id("setup"), label: "Setup script" },
              { id: id("variables"), label: "Variables" },
            ],
          },
        ]
      : []),
    { id: id("previews"), label: "Previews" },
    { id: id("rules"), label: "Workspace rules" },
    { id: id("memory"), label: "Memory" },
  ];
  const activeSection = useActiveSection(
    nav.flatMap((item) => [item.id, ...(item.children ?? []).filter((child) => !child.onSelect).map((child) => child.id)]),
    active,
  );

  const showBar = dirty || saving || saveError !== null || savedAt !== null;

  return (
    <div className={s.layout} hidden={!active}>
      <SectionNav items={nav} active={activeSection} />

      <div className={s.sections}>
        <Section
          id={id("general")}
          title="General"
          description="How Stella works when someone tags her in this workspace."
        >
          <Row label="Engine" hint="What runs her agents.">
            <RadioList
              label="Engine"
              value={draft.engine}
              choices={options.engines.map((engine) => ({ id: engine.id, label: engine.label, detail: engine.detail }))}
              onChange={chooseEngine}
            />
          </Row>
          <Row label="Model" htmlFor={id("model")}>
            <select
              id={id("model")}
              className={s.select}
              value={draft.model}
              onChange={(event) => set("model", event.target.value)}
            >
              {!modelKnown && draft.model ? <option value={draft.model}>{draft.model}</option> : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Reasoning effort" hint="Higher is slower and more thorough.">
            <div className={s.segmented} role="radiogroup" aria-label="Reasoning effort">
              {options.efforts.map((effort) => (
                <button
                  key={effort}
                  type="button"
                  role="radio"
                  aria-checked={draft.effort === effort}
                  data-active={draft.effort === effort ? "" : undefined}
                  onClick={() => set("effort", effort)}
                >
                  {EFFORT_LABELS[effort] ?? effort}
                </button>
              ))}
            </div>
          </Row>
          <Row
            label="Changes from Slack"
            hint="Let anyone in the workspace switch the engine, model or effort with /stella. Off keeps them as set here."
          >
            <Switch
              checked={draft.slackCommands}
              label="Let people change these from Slack with /stella"
              onChange={(next) => set("slackCommands", next)}
            />
          </Row>
        </Section>

        {githubAvailable ? (
          <GithubSection
            id={id("github")}
            workspace={workspace}
            githubReturn={githubReturn}
            dirty={dirty}
            onWorkspace={(next) => {
              rebase(next);
              setReposRefresh((key) => key + 1);
            }}
            onRefresh={() => setReposRefresh((key) => key + 1)}
          />
        ) : null}

        <ReposSection
          id={id("repos")}
          workspace={workspace}
          targets={targets}
          selected={target.key}
          dirtyKeys={dirtyKeys}
          githubRepos={githubRepos}
          connected={connectedAccounts.length > 0}
          onSelect={(key) => {
            selectTarget(key);
            scrollToId(id("repo"));
          }}
          onAdded={added}
        />

        <Section
          id={id("repo")}
          eyebrow={target.repo ? "Repository" : undefined}
          title={label}
          description={
            target.repo
              ? accessHint(target.repo, githubAvailable)
              : "Requests that aren't about any of the repositories, like research or writing, run here."
          }
        >
          {target.repo ? (
            <>
              <Row label="Branch" hint="Where agents start and push their work, unless someone names another branch.">
                <BranchPicker
                  teamId={workspace.teamId}
                  repo={target.repo.fullName}
                  defaultHint=""
                  value={targetDraft.branch}
                  onChange={(branch) => setTarget("branch", branch)}
                />
              </Row>
              <Row
                label="Default in channels"
                hint="Threads in these channels use this repository unless the request is about another. Ask @Stella in a channel to use it by default there."
              >
                {target.repo.channels.length ? (
                  <div className={s.chips}>
                    {target.repo.channels.map((channel) => {
                      const removed = targetDraft.removeChannels.includes(channel.id);
                      return (
                        <span key={channel.id} className={s.chip} data-removed={removed ? "" : undefined}>
                          {channel.name}
                          <button
                            type="button"
                            className={s.chipButton}
                            aria-label={removed ? `Keep ${channel.name}` : `Remove ${channel.name}`}
                            title={removed ? "Keep" : "Remove"}
                            onClick={() =>
                              setTarget(
                                "removeChannels",
                                removed
                                  ? targetDraft.removeChannels.filter((channelId) => channelId !== channel.id)
                                  : [...targetDraft.removeChannels, channel.id],
                              )
                            }
                          >
                            {removed ? <Undo2 size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className={s.muted}>None yet</span>
                )}
              </Row>
              <Row label="Rules" hint="Followed for all work in this repository, on top of the workspace rules." stack>
                <TextArea
                  value={targetDraft.rules}
                  max={SLACK_REPO_RULES_MAX_CHARS}
                  placeholder={"Open a pull request for every change; never push to main.\nRun bun test before pushing."}
                  onChange={(value) => setTarget("rules", value)}
                  label={`Rules for ${target.repo.fullName}`}
                />
              </Row>
              <Row label="Remove" hint="Deletes its environment, secrets and rules here. Nothing changes on GitHub.">
                <button type="button" className={s.dangerLink} onClick={() => void removeSelected()} disabled={saving}>
                  Remove {target.repo.fullName}
                </button>
              </Row>
            </>
          ) : null}
        </Section>

        {target.environment ? (
          <EnvironmentSection
            key={target.key}
            id={id}
            eyebrow={label}
            hasRepo={target.repo !== null}
            environment={target.environment}
            options={options}
            draft={targetDraft}
            set={setTarget}
          />
        ) : null}

        <PreviewsSection
          id={id("previews")}
          eyebrow={label}
          teamName={workspace.teamName}
          previews={target.previews}
          access={targetDraft.previewAccess}
          ttlDays={targetDraft.previewTtlDays}
          onAccess={(access) => setTarget("previewAccess", access)}
          onTtlDays={(days) => setTarget("previewTtlDays", days)}
        />

        <Section
          id={id("rules")}
          title="Workspace rules"
          description="Plain-language rules Stella follows for everyone in this workspace, in every repository."
        >
          <TextArea
            value={draft.rules}
            max={SLACK_RULES_MAX_CHARS}
            placeholder={"Only Priya can ask for deploys.\nAnswer in the thread, not the channel."}
            onChange={(value) => set("rules", value)}
            label="Rules"
          />
        </Section>

        <Section
          id={id("memory")}
          title="Memory"
          description="Stella's notes about this workspace: people, projects, how things are done. She keeps them up to date as she works, and you can edit them."
        >
          <TextArea
            value={draft.memory}
            max={SLACK_MEMORY_MAX_CHARS}
            placeholder="Nothing yet. Stella adds notes here as she learns about the workspace."
            onChange={(value) => set("memory", value)}
            label="Workspace memory"
            tall
          />
        </Section>

        {showBar ? (
          <div className={s.saveBar} data-dirty={dirty ? "" : undefined}>
            <span className={s.saveStatus} role="status">
              {saveError ? (
                <span className={s.errorText}>{saveError}</span>
              ) : saving ? (
                "Saving…"
              ) : dirty ? (
                invalid ? (
                  "Fix the highlighted fields to save"
                ) : (
                  <>
                    Unsaved<span className={s.wideOnly}> changes</span>
                    {dirtyKeys.size > 1 || (dirtyKeys.size === 1 && !dirtyKeys.has(target.key)) ? (
                      <span className={s.wideOnly}> in {dirtyKeys.size === 1 ? "another repository" : `${dirtyKeys.size} places`}</span>
                    ) : null}
                  </>
                )
              ) : (
                <span className={s.savedText}>
                  <Check size={15} aria-hidden="true" /> Saved
                </span>
              )}
            </span>
            {dirty || saveError ? (
              <div className={s.saveActions}>
                <button type="button" className={s.ghost} disabled={!dirty || saving} onClick={discard}>
                  Discard
                </button>
                <button
                  type="button"
                  className={s.primary}
                  disabled={!dirty || invalid || saving}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const accessHint = (repo: SlackWorkspaceRepo, githubAvailable: boolean): string =>
  repo.access === "github"
    ? "Agents get it cloned, work on its branch and push through GitHub, each in this repository's environment."
    : repo.access === "token"
      ? `Cloned with an access token saved earlier; agents can't push.${githubAvailable ? " Connect the GitHub account that owns it to replace the token." : ""}`
      : `Cloned as a public repository; agents can't push.${githubAvailable ? " Connect the GitHub account that owns it to let them." : ""}`;

const ACCESS_LABEL: Record<SlackWorkspaceRepo["access"], string> = {
  github: "Push",
  public: "Read-only",
  token: "Token",
};

function ReposSection({
  id,
  workspace,
  targets,
  selected,
  dirtyKeys,
  githubRepos,
  connected,
  onSelect,
  onAdded,
}: {
  id: string;
  workspace: SlackWorkspace;
  targets: Target[];
  selected: string;
  dirtyKeys: Set<string>;
  githubRepos: ReturnType<typeof useGithubRepos>;
  connected: boolean;
  onSelect: (key: string) => void;
  onAdded: (workspace: SlackWorkspace, repoId: string) => void;
}) {
  const [adding, setAdding] = useState<{ fullName: string; branch: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoOptions = githubRepos.state === "ready" ? githubRepos.value : [];
  const taken = new Set(workspace.repos.map((repo) => repo.fullName.toLowerCase()));
  const available = repoOptions.filter((repo) => !taken.has(repo.fullName.toLowerCase()));
  const name = adding ? normalizeRepo(adding.fullName) : "";
  const valid = REPO_PATTERN.test(name) && !taken.has(name.toLowerCase());
  const chosen = repoOptions.find((repo) => repo.fullName.toLowerCase() === name.toLowerCase());
  const maxed = workspace.repos.length >= SLACK_REPOS_MAX;

  const add = async () => {
    if (!adding || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { workspace: next, repoId } = await addSlackRepo(workspace.teamId, {
        fullName: name,
        branch: adding.branch,
      });
      setAdding(null);
      onAdded(next, repoId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id={id}
      title="Repositories"
      description="Stella works out which repository a request is about from the message, the thread and the channel, and asks in the thread when she can't tell. Each repository has its own environment, previews and rules."
    >
      <div className={s.table} role="listbox" aria-label="Repositories">
        {targets.map((target) => (
          <button
            key={target.key}
            type="button"
            role="option"
            aria-selected={target.key === selected}
            className={s.repoItem}
            data-selected={target.key === selected ? "" : undefined}
            onClick={() => onSelect(target.key)}
          >
            <span className={s.repoMark}>
              {target.repo ? <GithubMark /> : <Globe size={15} aria-hidden="true" />}
            </span>
            <span className={s.repoText}>
              <span className={s.repoName}>{targetLabel(target)}</span>
              <span className={s.repoDetail}>
                {target.repo
                  ? [
                      target.repo.branch || "default branch",
                      target.environment ? `${NETWORK_LABEL[target.environment.network]} network` : null,
                      target.repo.channels.length
                        ? target.repo.channels.length === 1
                          ? `default in ${target.repo.channels[0]!.name}`
                          : `default in ${target.repo.channels.length} channels`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Requests that aren't about a repository"}
              </span>
            </span>
            <span className={s.repoMeta}>
              {dirtyKeys.has(target.key) ? <span className={s.badge}>Edited</span> : null}
              {target.repo ? <span className={s.repoAccess}>{ACCESS_LABEL[target.repo.access]}</span> : null}
              <ChevronRight size={15} aria-hidden="true" />
            </span>
          </button>
        ))}
        {adding ? (
          <div className={s.secretForm}>
            <div className={s.formGrid}>
              <div className={s.field}>
                <span className={s.fieldLabel}>Repository</span>
                <RepoPicker
                  value={adding.fullName}
                  repos={available}
                  loading={githubRepos.state === "loading"}
                  connected={connected}
                  onChange={(fullName) => setAdding({ fullName, branch: "" })}
                />
                {githubRepos.state === "error" ? <span className={s.fieldError}>{githubRepos.message}</span> : null}
              </div>
              <div className={s.field}>
                <span className={s.fieldLabel}>Branch</span>
                <BranchPicker
                  teamId={workspace.teamId}
                  repo={REPO_PATTERN.test(name) ? name : ""}
                  defaultHint={chosen?.defaultBranch ?? ""}
                  value={adding.branch}
                  onChange={(branch) => setAdding({ ...adding, branch })}
                />
              </div>
            </div>
            {name && taken.has(name.toLowerCase()) ? (
              <span className={s.fieldError}>{name} is already in this workspace.</span>
            ) : null}
            {error ? <span className={s.fieldError}>{error}</span> : null}
            <div className={s.formActions}>
              <button type="button" className={s.ghost} onClick={() => setAdding(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={s.primary} disabled={!valid || busy} onClick={() => void add()}>
                {busy ? "Adding…" : "Add repository"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={s.tableAdd}
            disabled={maxed}
            onClick={() => {
              setError(null);
              setAdding({ fullName: "", branch: "" });
            }}
          >
            <Plus size={15} aria-hidden="true" />
            {maxed ? `Up to ${SLACK_REPOS_MAX} repositories` : "Add repository"}
          </button>
        )}
      </div>
    </Section>
  );
}

const NETWORK_LABEL: Record<SlackNetworkLevel, string> = { none: "No", limited: "Limited", full: "Full" };

const NETWORK_CHOICES: Array<Choice<SlackNetworkLevel>> = [
  {
    id: "none",
    label: "None",
    detail: "Only Stella, the model and this repository on GitHub.",
  },
  {
    id: "limited",
    label: "Limited",
    detail: "Package registries, GitHub and common build hosts, plus the domains you add.",
  },
  {
    id: "full",
    label: "Full",
    detail: "Any site on the Internet.",
  },
];

const relativeTime = (at: number): string => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return installedDate.format(new Date(at));
};

const EMPTY_SECRET: SlackNetworkSecretInput = { name: "", host: "", header: "Authorization", value: "" };

function EnvironmentSection({
  id,
  eyebrow,
  hasRepo,
  environment,
  options,
  draft,
  set,
}: {
  id: (name: string) => string;
  eyebrow: string;
  hasRepo: boolean;
  environment: SlackWorkspaceEnvironment;
  options: SlackWorkspaceOptions;
  draft: TargetDraft;
  set: <K extends keyof TargetDraft>(key: K, value: TargetDraft[K]) => void;
}) {
  const [adding, setAdding] = useState<SlackNetworkSecretInput | null>(null);
  const [logOpen, setLogOpen] = useState(environment.lastSetup?.status === "failed");
  const lastSetup = environment.lastSetup;
  const addingValid = Boolean(
    adding && /^[A-Za-z_][A-Za-z0-9_]*$/.test(adding.name.trim()) && adding.host.trim() && adding.value.trim(),
  );
  const addSecret = () => {
    if (!adding || !addingValid) return;
    set("secretsAdd", [
      ...draft.secretsAdd,
      {
        name: adding.name.trim(),
        host: adding.host.trim(),
        header: adding.header?.trim() || "Authorization",
        value: adding.value,
      },
    ]);
    setAdding(null);
  };
  const noSecrets = environment.secrets.length === 0 && draft.secretsAdd.length === 0;
  const secretField = (key: keyof SlackNetworkSecretInput) => `${id("secret")}-${key}`;
  return (
    <Section
      id={id("environment")}
      eyebrow={eyebrow}
      title="Environment"
      description={
        hasRepo
          ? "What every agent Stella starts for this repository runs with."
          : "What agents run with when the request isn't about a repository."
      }
    >
      <Row label="Name" htmlFor={id("env-name")} hint="Shown in Slack when an agent starts.">
        <input
          id={id("env-name")}
          className={s.input}
          value={draft.envName}
          maxLength={SLACK_ENV_NAME_MAX_CHARS}
          aria-invalid={!draft.envName.trim() || undefined}
          onChange={(event) => set("envName", event.target.value)}
        />
      </Row>

      <Group
        id={id("network")}
        title="Network access"
        description="Enforced by the agent's container network, not by asking the agent. Blocked requests fail with a message that names the host."
      >
        <RadioList
          label="Network access"
          value={draft.network}
          choices={
            hasRepo
              ? NETWORK_CHOICES
              : NETWORK_CHOICES.map((choice) =>
                  choice.id === "none" ? { ...choice, detail: "Only Stella and the model." } : choice,
                )
          }
          onChange={(network) => set("network", network)}
        />
        {draft.network === "limited" ? (
          <div className={s.field}>
            <label className={s.fieldLabel} htmlFor={id("hosts")}>
              Also allow these domains
            </label>
            <textarea
              id={id("hosts")}
              className={`${s.textarea} ${s.code} ${s.textareaShort}`}
              value={draft.allowedHosts}
              placeholder={"api.example.com\n*.internal.example.com"}
              spellCheck={false}
              rows={3}
              onChange={(event) => set("allowedHosts", event.target.value)}
            />
            <details className={s.details}>
              <summary>
                <ChevronRight size={14} aria-hidden="true" />
                Allowed by default ({options.limitedHosts.length} domains)
              </summary>
              <p className={s.hostList}>{options.limitedHosts.join(", ")}</p>
            </details>
          </div>
        ) : null}
      </Group>

      <Group
        id={id("secrets")}
        title="Network secrets"
        description="Let agents call APIs without seeing the secrets. Requests to the secret's host get its header set on the way out; agents only see a placeholder. Values can't be viewed after saving."
      >
        <div className={s.table}>
          {noSecrets && !adding ? <p className={s.tableEmpty}>No secrets yet.</p> : null}
          {environment.secrets.map((secret) => {
            const removed = draft.secretsRemove.includes(secret.id);
            return (
              <div key={secret.id} className={s.secret} data-removed={removed ? "" : undefined}>
                <KeyRound size={15} aria-hidden="true" className={s.secretIcon} />
                <span className={s.secretName}>{secret.name}</span>
                <span className={s.secretWhere}>
                  {removed ? "Removed when you save" : `${secret.header} → ${secret.host}`}
                </span>
                <button
                  type="button"
                  className={s.iconButton}
                  aria-label={removed ? `Keep ${secret.name}` : `Remove ${secret.name}`}
                  title={removed ? "Keep" : "Remove"}
                  onClick={() =>
                    set(
                      "secretsRemove",
                      removed
                        ? draft.secretsRemove.filter((secretId) => secretId !== secret.id)
                        : [...draft.secretsRemove, secret.id],
                    )
                  }
                >
                  {removed ? <Undo2 size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                </button>
              </div>
            );
          })}
          {draft.secretsAdd.map((secret, index) => (
            <div key={`new-${secret.name}`} className={s.secret} data-new="">
              <KeyRound size={15} aria-hidden="true" className={s.secretIcon} />
              <span className={s.secretName}>{secret.name}</span>
              <span className={s.secretWhere}>
                {secret.header} → {secret.host}
                <span className={s.badge}>New</span>
              </span>
              <button
                type="button"
                className={s.iconButton}
                aria-label={`Don't add ${secret.name}`}
                title="Don't add"
                onClick={() => set("secretsAdd", draft.secretsAdd.filter((_, i) => i !== index))}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          ))}
          {adding ? (
            <div className={s.secretForm}>
              <div className={s.formGrid}>
                <div className={s.field}>
                  <label className={s.fieldLabel} htmlFor={secretField("name")}>
                    Name
                  </label>
                  <input
                    id={secretField("name")}
                    className={`${s.input} ${s.code}`}
                    value={adding.name}
                    placeholder="OPENAI_API_KEY"
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => setAdding({ ...adding, name: event.target.value.toUpperCase() })}
                  />
                </div>
                <div className={s.field}>
                  <label className={s.fieldLabel} htmlFor={secretField("host")}>
                    Host
                  </label>
                  <input
                    id={secretField("host")}
                    className={`${s.input} ${s.code}`}
                    value={adding.host}
                    placeholder="api.openai.com"
                    autoComplete="off"
                    onChange={(event) => setAdding({ ...adding, host: event.target.value })}
                  />
                </div>
                <div className={s.field}>
                  <label className={s.fieldLabel} htmlFor={secretField("header")}>
                    Header
                  </label>
                  <input
                    id={secretField("header")}
                    className={`${s.input} ${s.code}`}
                    value={adding.header}
                    placeholder="Authorization"
                    autoComplete="off"
                    onChange={(event) => setAdding({ ...adding, header: event.target.value })}
                  />
                </div>
                <div className={s.field}>
                  <label className={s.fieldLabel} htmlFor={secretField("value")}>
                    Header value
                  </label>
                  <input
                    id={secretField("value")}
                    className={`${s.input} ${s.code}`}
                    type="password"
                    value={adding.value}
                    placeholder="Bearer sk-…"
                    autoComplete="new-password"
                    onChange={(event) => setAdding({ ...adding, value: event.target.value })}
                  />
                </div>
              </div>
              <div className={s.formActions}>
                <button type="button" className={s.ghost} onClick={() => setAdding(null)}>
                  Cancel
                </button>
                <button type="button" className={s.primary} disabled={!addingValid} onClick={addSecret}>
                  Add secret
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={s.tableAdd} onClick={() => setAdding({ ...EMPTY_SECRET })}>
              <Plus size={15} aria-hidden="true" />
              Add secret
            </button>
          )}
        </div>
      </Group>

      <Group
        id={id("setup")}
        title="Setup script"
        description="Bash that runs when an agent's container starts, before the agent, in the repository's checkout (or the home folder without one), as the agent's user (not root) and under the network access above. Make it safe to run again. Variables it exports, PATH included, carry over to the agent."
      >
        <div className={s.editor}>
          <textarea
            className={`${s.editorInput} ${s.code}`}
            wrap="off"
            value={draft.setupScript}
            spellCheck={false}
            placeholder={
              'set -euo pipefail\n\nif ! command -v bun >/dev/null || [ "$(bun --version)" != "1.4.2" ]; then\n  curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"\nfi\nexport PATH="$HOME/.bun/bin:$PATH"\nbun install'
            }
            aria-label="Setup script"
            aria-invalid={draft.setupScript.length > SLACK_SETUP_SCRIPT_MAX_CHARS || undefined}
            onChange={(event) => set("setupScript", event.target.value)}
          />
          {lastSetup ? (
            <div className={s.run} data-status={lastSetup.status}>
              <div className={s.runHead}>
                <span className={s.runStatus}>
                  {lastSetup.status === "succeeded" ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={14} aria-hidden="true" />
                  )}
                  {lastSetup.status === "succeeded" ? "Last run succeeded" : "Last run failed"}
                  {lastSetup.status === "failed" && lastSetup.exitCode !== null ? ` (exit ${lastSetup.exitCode})` : ""}
                </span>
                <span className={s.runMeta}>
                  {relativeTime(lastSetup.at)} · {Math.max(1, Math.round(lastSetup.ms / 1000))} s
                </span>
                {lastSetup.log ? (
                  <button
                    type="button"
                    className={s.runToggle}
                    aria-expanded={logOpen}
                    onClick={() => setLogOpen((open) => !open)}
                  >
                    {logOpen ? "Hide log" : "Show log"}
                  </button>
                ) : null}
              </div>
              {lastSetup.log && logOpen ? <pre className={s.log}>{lastSetup.log}</pre> : null}
            </div>
          ) : null}
        </div>
      </Group>

      <Group
        id={id("variables")}
        title="Environment variables"
        description="In .env format, one KEY=value per line. Not secret: anyone using this environment can read them, including people who ask Stella in Slack. Put credentials in network secrets instead."
      >
        <textarea
          className={`${s.textarea} ${s.code}`}
          wrap="off"
          value={draft.envVars}
          spellCheck={false}
          placeholder={"NODE_ENV=development\nAPI_BASE_URL=https://staging.example.com"}
          aria-label="Environment variables"
          rows={5}
          aria-invalid={draft.envVars.length > SLACK_ENV_VARS_MAX_CHARS || undefined}
          onChange={(event) => set("envVars", event.target.value)}
        />
      </Group>
    </Section>
  );
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round((bytes / 1024 ** 2) * 10) / 10} MB`;
  if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return "0 MB";
};

const ttlLabel = (days: number): string => (days === 1 ? "1 day" : `${days} days`);

function PreviewsSection({
  id,
  eyebrow,
  teamName,
  previews,
  access,
  ttlDays,
  onAccess,
  onTtlDays,
}: {
  id: string;
  eyebrow: string;
  teamName: string;
  previews: SlackWorkspacePreviews;
  access: SlackPreviewAccess;
  ttlDays: number;
  onAccess: (access: SlackPreviewAccess) => void;
  onTtlDays: (days: number) => void;
}) {
  const share = previews.quotaBytes > 0 ? Math.min(1, previews.usedBytes / previews.quotaBytes) : 0;
  const choices: Array<Choice<SlackPreviewAccess>> = [
    {
      id: "members",
      label: "Workspace members",
      detail: `Visitors sign in with Slack and must be in ${teamName}.`,
      icon: <Lock size={14} aria-hidden="true" />,
    },
    {
      id: "public",
      label: "Anyone with the link",
      detail: "Links can't be guessed, but anyone they're shared with can open them.",
      icon: <Globe size={14} aria-hidden="true" />,
    },
  ];
  return (
    <Section
      id={id}
      eyebrow={eyebrow}
      title="Previews"
      description="When an agent changes a website, Stella posts a preview link in the thread: the repository's own preview when it has one, otherwise a build Stella hosts for you."
    >
      <Row label="Who can open links">
        <RadioList label="Who can open preview links" value={access} choices={choices} onChange={onAccess} />
      </Row>
      <Row
        label="Links expire after"
        htmlFor={`${id}-ttl`}
        hint="Counted from when each link was made, including links already posted."
      >
        <select
          id={`${id}-ttl`}
          className={s.select}
          value={ttlDays}
          onChange={(event) => onTtlDays(Number(event.target.value))}
        >
          {!(SLACK_PREVIEW_TTL_DAYS_CHOICES as readonly number[]).includes(ttlDays) ? (
            <option value={ttlDays}>{ttlLabel(ttlDays)}</option>
          ) : null}
          {SLACK_PREVIEW_TTL_DAYS_CHOICES.map((days) => (
            <option key={days} value={days}>
              {ttlLabel(days)}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Storage" hint={`Shared by the whole workspace. Up to ${formatBytes(previews.maxPreviewBytes)} per preview.`}>
        <div className={s.usage}>
          <div className={s.usageText}>
            <span>
              <strong>{formatBytes(previews.usedBytes)}</strong> of {formatBytes(previews.quotaBytes)}
            </span>
            <span>{previews.live === 1 ? "1 live link" : `${previews.live} live links`}</span>
          </div>
          <div
            className={s.meter}
            role="meter"
            aria-label="Preview space used"
            aria-valuemin={0}
            aria-valuemax={previews.quotaBytes}
            aria-valuenow={previews.usedBytes}
          >
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        </div>
      </Row>
    </Section>
  );
}

function GithubSection({
  id,
  workspace,
  githubReturn,
  dirty,
  onWorkspace,
  onRefresh,
}: {
  id: string;
  workspace: SlackWorkspace;
  githubReturn: GithubReturn | null;
  dirty: boolean;
  onWorkspace: (workspace: SlackWorkspace) => void;
  onRefresh: () => void;
}) {
  const teamId = workspace.teamId;
  const accounts = workspace.githubAccounts;
  const [busy, setBusy] = useState<string | null>(githubReturn?.code ? "finish" : null);
  const [error, setError] = useState<string | null>(githubReturn?.error ?? null);
  const [choices, setChoices] = useState<SlackGithubInstallationChoice[] | null>(null);
  const finishing = useRef(false);

  const finish = useCallback(
    async (installationId?: string) => {
      if (!githubReturn?.code) return;
      setBusy("finish");
      setError(null);
      try {
        const result = await finishGithub(teamId, githubReturn.code, installationId);
        if ("choices" in result) setChoices(result.choices);
        else {
          setChoices(null);
          onWorkspace(result.workspace);
        }
      } catch (failure) {
        setError(errorText(failure));
      } finally {
        setBusy(null);
      }
    },
    [githubReturn, onWorkspace, teamId],
  );

  useEffect(() => {
    if (!githubReturn?.code || finishing.current) return;
    finishing.current = true;
    void finish();
  }, [finish, githubReturn]);

  const connect = async () => {
    if (dirty && !window.confirm("Connecting GitHub leaves this page. Discard your unsaved changes?")) return;
    setBusy("connect");
    setError(null);
    try {
      const returnTo = new URL(window.location.pathname, window.location.origin);
      const mock = new URL(window.location.href).searchParams.get("mock");
      if (mock) returnTo.searchParams.set("mock", mock);
      const { url } = await connectGithub(teamId, returnTo.toString());
      window.location.assign(url);
    } catch (failure) {
      setError(errorText(failure));
      setBusy(null);
    }
  };

  const disconnect = async (account: SlackWorkspaceGithub) => {
    const owned = workspace.repos.filter((repo) =>
      repo.fullName.toLowerCase().startsWith(`${account.account.toLowerCase()}/`),
    );
    const message = owned.length
      ? `Disconnect GitHub (${account.account})? ${owned.map((repo) => repo.fullName).join(", ")} stay${owned.length === 1 ? "s" : ""}, but agents can only read ${owned.length === 1 ? "it" : "them"} if public, and can't push.`
      : `Disconnect GitHub (${account.account})?`;
    if (!window.confirm(message)) return;
    setBusy(`disconnect:${account.installationId}`);
    setError(null);
    try {
      onWorkspace((await disconnectGithub(teamId, account.installationId)).workspace);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      id={id}
      title="GitHub"
      description="Connect the GitHub accounts and organizations that own your repositories, so agents can clone private ones, push their work and share previews. Public repositories work without connecting, read-only."
    >
      {accounts.length ? (
        <div className={s.table}>
          {accounts.map((account) => (
            <div key={account.installationId} className={s.account} data-status={account.status}>
              <span className={s.connectionMark}>
                <GithubMark />
              </span>
              <span className={s.connectionText}>
                <span className={s.connectionTitle}>{account.account}</span>
                <span className={s.connectionDetail}>
                  {account.status === "active"
                    ? account.accountType === "Organization"
                      ? "Organization"
                      : "Personal account"
                    : account.status === "suspended"
                      ? "Suspended on GitHub. Unsuspend Stella Crew there, or reconnect."
                      : "Stella lost access: the app was uninstalled or its access removed. Reconnect."}
                </span>
              </span>
              <span className={s.connectionActions}>
                {account.status === "active" ? (
                  <a className={s.textLink} href={account.manageUrl} target="_blank" rel="noopener noreferrer">
                    Choose repositories
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                ) : (
                  <button type="button" className={s.textLink} onClick={() => void connect()} disabled={busy !== null}>
                    Reconnect
                  </button>
                )}
                <button
                  type="button"
                  className={s.textLink}
                  onClick={() => void disconnect(account)}
                  disabled={busy !== null}
                >
                  {busy === `disconnect:${account.installationId}` ? "Disconnecting…" : "Disconnect"}
                </button>
              </span>
            </div>
          ))}
          <div className={s.accountFoot}>
            <button type="button" className={s.tableAdd} onClick={() => void connect()} disabled={busy !== null}>
              <Plus size={15} aria-hidden="true" />
              {busy === "connect" ? "Opening GitHub…" : busy === "finish" ? "Connecting…" : "Connect another account"}
            </button>
            <button type="button" className={s.textLink} onClick={onRefresh} disabled={busy !== null}>
              Refresh repositories
            </button>
          </div>
        </div>
      ) : (
        <div className={s.connection}>
          <span className={s.connectionMark}>
            <GithubMark />
          </span>
          <span className={s.connectionText}>
            <span className={s.connectionTitle}>Connect GitHub so agents can push and share previews</span>
            <span className={s.connectionDetail}>
              You choose which repositories Stella can see, and you never paste a token. Connect each account or
              organization that owns a repository you add.
            </span>
          </span>
          <button type="button" className={s.primary} onClick={() => void connect()} disabled={busy !== null}>
            {busy === "connect" ? "Opening GitHub…" : busy === "finish" ? "Connecting…" : "Connect GitHub"}
          </button>
        </div>
      )}

      {choices ? (
        <div className={`${s.table} ${s.choices}`} role="group" aria-label="Choose a GitHub account">
          <p className={s.tableCaption}>Which GitHub account should Stella connect?</p>
          {choices.map((choice) => (
            <button
              key={choice.installationId}
              type="button"
              className={s.choice}
              onClick={() => void finish(choice.installationId)}
              disabled={busy !== null}
            >
              <GithubMark />
              <span className={s.choiceName}>{choice.account || `Installation ${choice.installationId}`}</span>
              <span className={s.choiceType}>
                {accounts.some((account) => account.installationId === choice.installationId)
                  ? "Connected"
                  : choice.accountType === "Organization"
                    ? "Organization"
                    : "Personal"}
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className={`${s.banner} ${s.banner_error}`}>{error}</p> : null}
    </Section>
  );
}

function TextArea({
  value,
  max,
  placeholder,
  onChange,
  label,
  tall = false,
}: {
  value: string;
  max: number;
  placeholder: string;
  onChange: (value: string) => void;
  label: string;
  tall?: boolean;
}) {
  const over = value.length > max;
  return (
    <div className={s.field}>
      <textarea
        className={`${s.textarea} ${tall ? s.textareaTall : ""}`}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={over || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className={`${s.counter} ${over ? s.counterOver : ""}`}>
        {value.length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
      </span>
    </div>
  );
}

function SlackLogo() {
  return (
    <svg className={s.slackLogo} viewBox="0 0 122.8 122.8" aria-hidden="true">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a" />
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0" />
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d" />
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e" />
    </svg>
  );
}

const MAX_SHOWN = 60;

function RepoPicker({
  value,
  repos,
  loading,
  connected,
  onChange,
}: {
  value: string;
  repos: SlackGithubRepoOption[];
  loading: boolean;
  connected: boolean;
  onChange: (fullName: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const typed = normalizeRepo(query);
  const needle = typed.toLowerCase();
  const matches = needle ? repos.filter((repo) => repo.fullName.toLowerCase().includes(needle)) : repos;
  const shown = matches.slice(0, MAX_SHOWN);
  const publicOption =
    REPO_PATTERN.test(typed) && !repos.some((repo) => repo.fullName.toLowerCase() === needle) ? typed : null;
  const items: Array<{ fullName: string; repo?: SlackGithubRepoOption }> = [
    ...shown.map((repo) => ({ fullName: repo.fullName, repo })),
    ...(publicOption ? [{ fullName: publicOption }] : []),
  ];

  const pick = (fullName: string) => {
    onChange(fullName);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setCursor((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[cursor];
      if (open && item) pick(item.fullName);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  const placeholder = connected
    ? loading
      ? "Loading repositories…"
      : "Search repositories, or type owner/name"
    : "owner/name of a public repository";

  return (
    <div className={s.combo}>
      <input
        ref={inputRef}
        className={`${s.input} ${s.comboInput}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[cursor] ? `${listId}-${cursor}` : undefined}
        value={open ? query : value}
        placeholder={value || placeholder}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setCursor(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className={s.comboList} id={listId} role="listbox">
          {items.map((item, index) => (
            <li
              key={item.fullName}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === cursor}
              className={s.comboOption}
              data-active={index === cursor ? "" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item.fullName);
              }}
              onMouseEnter={() => setCursor(index)}
            >
              {item.repo ? (
                <>
                  {item.repo.private ? <Lock size={13} aria-hidden="true" /> : <Globe size={13} aria-hidden="true" />}
                  <span className={s.comboName}>{item.repo.fullName}</span>
                  {item.repo.fullName === value ? <Check size={14} aria-hidden="true" className={s.comboCheck} /> : null}
                </>
              ) : (
                <>
                  <Globe size={13} aria-hidden="true" />
                  <span className={s.comboName}>
                    Use public repository <strong>{item.fullName}</strong>
                  </span>
                </>
              )}
            </li>
          ))}
          {items.length === 0 ? (
            <li className={s.comboEmpty}>
              {connected
                ? loading
                  ? "Loading repositories…"
                  : needle
                    ? "No repository Stella can see matches. Type owner/name for a public one."
                    : "Stella can't see any repositories yet. Choose some on GitHub."
                : "Type owner/name, like vercel/next.js."}
            </li>
          ) : matches.length > MAX_SHOWN ? (
            <li className={s.comboEmpty}>Type to see the other {matches.length - MAX_SHOWN}.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function BranchPicker({
  teamId,
  repo,
  defaultHint,
  value,
  onChange,
}: {
  teamId: string;
  repo: string;
  defaultHint: string;
  value: string;
  onChange: (branch: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded<{ branches: string[]; defaultBranch: string }> | null>(null);
  const branches = loadable(repo || null, loaded);

  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    listGithubBranches(teamId, repo).then(
      (value) => {
        if (!cancelled) setLoaded({ key: repo, value });
      },
      (failure) => {
        if (!cancelled) setLoaded({ key: repo, message: errorText(failure) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo, teamId]);

  const ready = branches.state === "ready" ? branches.value : null;
  const defaultBranch = ready?.defaultBranch || defaultHint;
  const others = (ready?.branches ?? []).filter((branch) => branch !== defaultBranch);

  return (
    <>
      <select
        className={s.select}
        value={value}
        disabled={!repo || branches.state === "loading"}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {!repo
            ? "Pick a repository first"
            : branches.state === "loading"
              ? "Loading branches…"
              : defaultBranch
                ? `${defaultBranch} (default)`
                : "Default branch"}
        </option>
        {value && !others.includes(value) ? <option value={value}>{value}</option> : null}
        {others.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
      {branches.state === "error" ? <span className={s.fieldError}>{branches.message}</span> : null}
    </>
  );
}

function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

