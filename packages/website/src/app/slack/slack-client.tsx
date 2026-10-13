"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ArrowUpRight, Check, GitBranch, Globe, Lock, Plus } from "lucide-react";
import type { ReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import {
  SLACK_GITHUB_ERROR_PARAM,
  SLACK_GITHUB_RESULT_PARAM,
  SLACK_INSTALL_RESULT_PARAM,
  SLACK_MEMORY_MAX_CHARS,
  SLACK_RULES_MAX_CHARS,
  type SlackGithubInstallationChoice,
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
  connectGithub,
  disconnectGithub,
  finishGithub,
  listGithubBranches,
  listGithubRepos,
  listSlackWorkspaces,
  startSlackInstall,
  updateSlackWorkspace,
} from "./slack-api";
import { readMockMode, type SlackMockMode } from "./slack-mock";
import s from "./slack.module.css";

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

export function SlackClient() {
  const boot = useSyncExternalStore(subscribeNever, readBoot, () => null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!RETURN_PARAMS.some((name) => url.searchParams.has(name))) return;
    for (const name of RETURN_PARAMS) url.searchParams.delete(name);
    window.history.replaceState(null, "", url.toString());
  }, []);

  let body;
  if (boot === null) body = <Loading />;
  else if (boot.mock) body = <Account installResult={boot.result} githubReturn={boot.github} />;
  else if (!isBackendConfigured())
    body = <Notice title="Not available here">This build of the site isn&apos;t connected to Stella.</Notice>;
  else body = <SessionGate installResult={boot.result} githubReturn={boot.github} />;

  return (
    <>
      <Hero />
      <div className={s.content}>{body}</div>
    </>
  );
}

function Hero() {
  return (
    <section className={s.hero}>
      <p className={s.eyebrow}>Stella for Slack</p>
      <h1 className={s.title}>
        Stella, in your <em>Slack.</em>
      </h1>
      <p className={s.lede}>
        Tag @Stella in any channel or send her a DM. She works for everyone in the workspace, and you
        decide how.
      </p>
    </section>
  );
}

function Loading() {
  return (
    <div className={s.loading} aria-live="polite">
      <span className={s.spinner} aria-hidden="true" />
      Loading
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.card}>
      <h2 className={s.cardTitle}>{title}</h2>
      <p className={s.muted}>{children}</p>
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
    <>
      {installResult ? <InstallBanner result={installResult} /> : null}
      <div className={`${s.card} ${s.centerCard}`}>
        <p className={s.cardEyebrow}>Step one</p>
        <h2 className={s.cardTitle}>Sign in to set up Stella for Slack</h2>
        <p className={s.muted}>
          The Stella account that adds her to a workspace owns her there. Her work in Slack runs on
          that account&apos;s plan.
        </p>
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={() => openSignInDialog()}>
            Sign in
          </button>
        </div>
      </div>
    </>
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
      <>
        {banner}
        <div className={s.card}>
          <h2 className={s.cardTitle}>Couldn&apos;t load your workspaces</h2>
          <p className={s.errorText}>{loadError}</p>
          <div className={s.actions}>
            <button type="button" className={s.secondary} onClick={() => void load()}>
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }
  if (!data) return <>{banner}<Loading /></>;
  if (!data.available) {
    return (
      <>
        {banner}
        <Notice title="Not available yet">Stella for Slack isn&apos;t switched on for this server yet.</Notice>
      </>
    );
  }

  const addButton = (label: string, big: boolean) => (
    <button
      type="button"
      className={big ? s.slackButton : s.secondary}
      onClick={() => void install()}
      disabled={installing}
    >
      {big ? <SlackLogo /> : <Plus size={16} aria-hidden="true" />}
      {installing ? "Opening Slack…" : label}
    </button>
  );

  return (
    <>
      {banner}
      {data.workspaces.length === 0 ? (
        <div className={`${s.card} ${s.centerCard}`}>
          <p className={s.cardEyebrow}>Connect Slack</p>
          <h2 className={s.cardTitle}>Add Stella to your workspace</h2>
          <p className={s.muted}>
            Slack asks you to pick a workspace and approve Stella. Then anyone there can tag @Stella
            in a channel or DM her. This Stella account owns her in that workspace and pays for her
            work.
          </p>
          <div className={s.actions}>{addButton("Add to Slack", true)}</div>
          {installError ? <p className={s.errorText}>{installError}</p> : null}
        </div>
      ) : (
        <>
          {data.workspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.teamId}
              workspace={workspace}
              options={data.options}
              githubAvailable={data.githubAvailable}
              githubReturn={githubReturn?.teamId === workspace.teamId ? githubReturn : null}
              onUpdated={replaceWorkspace}
            />
          ))}
          <div className={s.addAnother}>
            {addButton("Add another workspace", false)}
            {installError ? <p className={s.errorText}>{installError}</p> : null}
          </div>
        </>
      )}
    </>
  );
}

type Draft = {
  engine: SlackWorkspaceEngine;
  model: string;
  effort: ReasoningEffortLevel;
  slackCommands: boolean;
  repoName: string;
  repoBranch: string;
  rules: string;
  memory: string;
};

const draftFrom = (w: SlackWorkspace): Draft => ({
  engine: w.engine,
  model: w.model,
  effort: w.effort,
  slackCommands: w.slackCommands,
  repoName: w.repo?.fullName ?? "",
  repoBranch: w.repo?.branch ?? "",
  rules: w.rules,
  memory: w.memory,
});

const diff = (w: SlackWorkspace, d: Draft): SlackWorkspaceUpdate => {
  const update: SlackWorkspaceUpdate = {};
  if (d.engine !== w.engine) update.engine = d.engine;
  if (d.model !== w.model) update.model = d.model;
  if (d.effort !== w.effort) update.effort = d.effort;
  if (d.slackCommands !== w.slackCommands) update.slackCommands = d.slackCommands;
  if (d.rules !== w.rules) update.rules = d.rules;
  if (d.memory !== w.memory) update.memory = d.memory;
  const name = d.repoName.trim();
  const branch = d.repoBranch.trim();
  if (name) {
    if (!w.repo || name !== w.repo.fullName || branch !== w.repo.branch) update.repo = { fullName: name, branch };
  } else if (w.repo) {
    update.repo = null;
  }
  return update;
};

function WorkspaceCard({
  workspace,
  options,
  githubAvailable,
  githubReturn,
  onUpdated,
}: {
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

  const update = useMemo(() => diff(workspace, draft), [workspace, draft]);
  const dirty = Object.keys(update).length > 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSavedAt(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

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

  const repoName = draft.repoName.trim();
  const repoInvalid = repoName !== "" && !REPO_PATTERN.test(repoName);
  const rulesOver = draft.rules.length > SLACK_RULES_MAX_CHARS;
  const memoryOver = draft.memory.length > SLACK_MEMORY_MAX_CHARS;
  const invalid = repoInvalid || rulesOver || memoryOver || !draft.model;

  const commit = async (patch: SlackWorkspaceUpdate) => {
    setSaving(true);
    setSaveError(null);
    try {
      const { workspace: next } = await updateSlackWorkspace(workspace.teamId, patch);
      onUpdated(next);
      setDraft(draftFrom(next));
      setSavedAt(Date.now());
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!dirty || invalid || saving) return;
    void commit(update);
  };

  const disconnectRepo = () => {
    if (!workspace.repo) {
      setDraft((current) => ({ ...current, repoName: "", repoBranch: "" }));
      return;
    }
    if (!window.confirm(`Disconnect ${workspace.repo.fullName}? New agents in this workspace will start without it.`)) return;
    void commit({ repo: null });
  };

  const githubChanged = useCallback(
    (next: SlackWorkspace) => {
      onUpdated(next);
      setDraft((current) => ({
        ...current,
        repoName: next.repo?.fullName ?? "",
        repoBranch: next.repo?.branch ?? "",
      }));
    },
    [onUpdated],
  );

  return (
    <article className={s.workspace}>
      <header className={s.workspaceHead}>
        <div className={s.workspaceIdentity}>
          <span className={s.workspaceAvatar} aria-hidden="true">
            {workspace.teamName.trim().charAt(0).toUpperCase() || "#"}
          </span>
          <div>
            <h2 className={s.workspaceName}>{workspace.teamName}</h2>
            <p className={s.workspaceMeta}>
              Connected {installedDate.format(new Date(workspace.installedAt))}
            </p>
          </div>
        </div>
        <a className={s.secondary} href={workspace.slackUrl} target="_blank" rel="noopener noreferrer">
          Open in Slack
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>

      <section className={s.panel} aria-labelledby={`${workspace.teamId}-engine`}>
        <div className={s.panelHead}>
          <p className={s.cardEyebrow} id={`${workspace.teamId}-engine`}>
            How Stella works here
          </p>
        </div>

        <div className={s.field}>
          <span className={s.label}>Engine</span>
          <div className={s.engines} role="radiogroup" aria-label="Engine">
            {options.engines.map((engine) => (
              <button
                key={engine.id}
                type="button"
                role="radio"
                aria-checked={draft.engine === engine.id}
                className={s.engine}
                data-active={draft.engine === engine.id ? "" : undefined}
                onClick={() => chooseEngine(engine.id)}
              >
                <span className={s.engineLabel}>{engine.label}</span>
                <span className={s.engineDetail}>{engine.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={s.row}>
          <label className={s.field}>
            <span className={s.label}>Model</span>
            <select
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
          </label>

          <div className={s.field}>
            <span className={s.label}>Reasoning effort</span>
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
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={draft.slackCommands}
          className={s.toggleRow}
          onClick={() => set("slackCommands", !draft.slackCommands)}
        >
          <span className={s.toggle} data-on={draft.slackCommands ? "" : undefined} aria-hidden="true">
            <span />
          </span>
          <span className={s.toggleText}>
            <span className={s.toggleTitle}>Let people change these from Slack with /stella</span>
            <span className={s.toggleDetail}>
              Anyone in the workspace can switch the engine, model or effort. Turn this off to keep
              them as you set them here.
            </span>
          </span>
        </button>
      </section>

      <GithubPanel
        workspace={workspace}
        available={githubAvailable}
        githubReturn={githubReturn}
        repoName={draft.repoName}
        repoBranch={draft.repoBranch}
        dirty={dirty}
        saving={saving}
        onRepo={(repoName, repoBranch) => {
          setSavedAt(null);
          setDraft((current) => ({ ...current, repoName, repoBranch }));
        }}
        onBranch={(branch) => set("repoBranch", branch)}
        onDisconnectRepo={disconnectRepo}
        onWorkspace={githubChanged}
      />

      <section className={s.panel}>
        <div className={s.panelHead}>
          <p className={s.cardEyebrow}>Rules</p>
          <p className={s.panelLede}>
            Write them in plain language. Stella follows these as rules for everyone in this
            workspace.
          </p>
        </div>
        <TextArea
          value={draft.rules}
          max={SLACK_RULES_MAX_CHARS}
          placeholder={"Only Priya can ask for deploys.\nAnswer in the thread, not the channel."}
          onChange={(value) => set("rules", value)}
          label="Rules"
        />
      </section>

      <section className={s.panel}>
        <div className={s.panelHead}>
          <p className={s.cardEyebrow}>Workspace memory</p>
          <p className={s.panelLede}>
            Stella&apos;s notes about this workspace: people, projects, how things are done. She
            keeps them up to date as she works, and you can edit them.
          </p>
        </div>
        <TextArea
          value={draft.memory}
          max={SLACK_MEMORY_MAX_CHARS}
          placeholder="Nothing yet. Stella adds notes here as she learns about the workspace."
          onChange={(value) => set("memory", value)}
          label="Workspace memory"
          tall
        />
      </section>

      <div className={s.saveBar} data-dirty={dirty ? "" : undefined}>
        <span className={s.saveStatus} role="status">
          {saveError ? (
            <span className={s.errorText}>{saveError}</span>
          ) : saving ? (
            "Saving…"
          ) : dirty ? (
            "Unsaved changes"
          ) : savedAt ? (
            <span className={s.savedText}>
              <Check size={15} aria-hidden="true" /> Saved
            </span>
          ) : (
            "All changes saved"
          )}
        </span>
        <div className={s.saveActions}>
          <button
            type="button"
            className={s.secondary}
            disabled={!dirty || saving}
            onClick={() => {
              setSaveError(null);
              setDraft(draftFrom(workspace));
            }}
          >
            Discard
          </button>
          <button type="button" className={s.primary} disabled={!dirty || invalid || saving} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </article>
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

function GithubPanel({
  workspace,
  available,
  githubReturn,
  repoName,
  repoBranch,
  dirty,
  saving,
  onRepo,
  onBranch,
  onDisconnectRepo,
  onWorkspace,
}: {
  workspace: SlackWorkspace;
  available: boolean;
  githubReturn: GithubReturn | null;
  repoName: string;
  repoBranch: string;
  dirty: boolean;
  saving: boolean;
  onRepo: (repoName: string, repoBranch: string) => void;
  onBranch: (branch: string) => void;
  onDisconnectRepo: () => void;
  onWorkspace: (workspace: SlackWorkspace) => void;
}) {
  const teamId = workspace.teamId;
  const github = workspace.github;
  const active = github?.status === "active";
  const [busy, setBusy] = useState<"connect" | "finish" | "disconnect" | null>(
    githubReturn?.code ? "finish" : null,
  );
  const [error, setError] = useState<string | null>(githubReturn?.error ?? null);
  const [choices, setChoices] = useState<SlackGithubInstallationChoice[] | null>(null);
  const [reposKey, setReposKey] = useState(0);
  const [reposLoaded, setReposLoaded] = useState<Loaded<SlackGithubRepoOption[]> | null>(null);
  const reposFor = active ? `${teamId}:${reposKey}` : null;
  const repos = loadable(reposFor, reposLoaded);
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
          setReposKey((key) => key + 1);
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

  useEffect(() => {
    if (!reposFor) return;
    let cancelled = false;
    listGithubRepos(teamId).then(
      ({ repos: value }) => {
        if (!cancelled) setReposLoaded({ key: reposFor, value });
      },
      (failure) => {
        if (!cancelled) setReposLoaded({ key: reposFor, message: errorText(failure) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reposFor, teamId]);

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

  const disconnect = async () => {
    if (!github) return;
    const repoGoes = workspace.repo?.access === "github";
    const message = repoGoes
      ? `Disconnect GitHub (${github.account})? ${workspace.repo!.fullName} is removed too, so new agents start without it.`
      : `Disconnect GitHub (${github.account})?`;
    if (!window.confirm(message)) return;
    setBusy("disconnect");
    setError(null);
    try {
      onWorkspace((await disconnectGithub(teamId)).workspace);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };

  const repoOptions = repos.state === "ready" ? repos.value : [];
  const chosen = repoOptions.find((repo) => repo.fullName.toLowerCase() === repoName.toLowerCase());

  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <p className={s.cardEyebrow}>
          <GitBranch size={13} aria-hidden="true" /> GitHub repository
        </p>
        <p className={s.panelLede}>
          Every agent Stella starts in this workspace begins with this repository cloned in. Stella
          only ever gets read access.
        </p>
      </div>

      {available ? (
        github && !active ? (
          <div className={`${s.callout} ${s.callout_warn}`} role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            <div className={s.calloutBody}>
              <p className={s.calloutTitle}>
                {github.status === "suspended"
                  ? `GitHub access is suspended on ${github.account}`
                  : `Stella lost access to GitHub (${github.account})`}
              </p>
              <p className={s.calloutText}>
                {github.status === "suspended"
                  ? "Someone suspended Stella for Slack on GitHub. Unsuspend it there, or reconnect with another account."
                  : "Stella for Slack was uninstalled or its access was removed. Reconnect to keep cloning private repositories."}
              </p>
            </div>
            <div className={s.calloutActions}>
              <button type="button" className={s.primary} onClick={() => void connect()} disabled={busy !== null}>
                {busy === "connect" ? "Opening GitHub…" : "Reconnect GitHub"}
              </button>
              <button type="button" className={s.linkButton} onClick={() => void disconnect()} disabled={busy !== null}>
                Disconnect
              </button>
            </div>
          </div>
        ) : github ? (
          <div className={s.githubBar}>
            <span className={s.githubAccount}>
              <GithubMark />
              <span>
                Connected to <strong>{github.account}</strong>
              </span>
            </span>
            <span className={s.githubLinks}>
              <a className={s.linkButton} href={github.manageUrl} target="_blank" rel="noopener noreferrer">
                Choose repositories on GitHub
              </a>
              <button type="button" className={s.linkButton} onClick={() => setReposKey((key) => key + 1)} disabled={busy !== null}>
                Refresh list
              </button>
              <button type="button" className={s.linkButton} onClick={() => void disconnect()} disabled={busy !== null}>
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </span>
          </div>
        ) : (
          <div className={s.githubConnect}>
            <div>
              <p className={s.githubConnectTitle}>Connect GitHub to use private repositories</p>
              <p className={s.hint}>
                You choose which repositories Stella can see. She gets short-lived, read-only access when
                an agent starts, and never a token you have to paste.
              </p>
            </div>
            <button type="button" className={s.githubButton} onClick={() => void connect()} disabled={busy !== null}>
              <GithubMark />
              {busy === "connect" ? "Opening GitHub…" : busy === "finish" ? "Connecting…" : "Connect GitHub"}
            </button>
          </div>
        )
      ) : null}

      {choices ? (
        <div className={s.choices} role="group" aria-label="Choose a GitHub account">
          <p className={s.label}>Which GitHub account should Stella use?</p>
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
              <span className={s.choiceType}>{choice.accountType === "Organization" ? "Organization" : "Personal"}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className={`${s.banner} ${s.banner_error}`}>{error}</p> : null}

      <div className={s.row}>
        <div className={s.field}>
          <span className={s.label}>Repository</span>
          <RepoPicker
            value={repoName}
            repos={repoOptions}
            loading={repos.state === "loading"}
            connected={active}
            onChange={(fullName) => onRepo(fullName, "")}
          />
          {repos.state === "error" ? <span className={s.fieldError}>{repos.message}</span> : null}
        </div>
        <label className={s.field}>
          <span className={s.label}>Branch</span>
          <BranchPicker
            teamId={teamId}
            repo={REPO_PATTERN.test(repoName) ? repoName : ""}
            defaultHint={chosen?.defaultBranch ?? ""}
            value={repoBranch}
            onChange={onBranch}
          />
        </label>
      </div>

      <div className={s.repoFoot}>
        {workspace.repo?.access === "token" && repoName === workspace.repo.fullName ? (
          <span className={s.repoNote}>
            <Lock size={13} aria-hidden="true" /> Uses an access token saved earlier.
            {available ? " Connect GitHub and pick the repository again to replace it." : null}
          </span>
        ) : workspace.repo?.access === "public" && repoName === workspace.repo.fullName ? (
          <span className={s.repoNote}>
            <Globe size={13} aria-hidden="true" /> Cloned as a public repository.
          </span>
        ) : workspace.repo?.access === "github" && repoName === workspace.repo.fullName ? (
          <span className={s.repoNote}>
            <Check size={13} aria-hidden="true" /> Cloned with read-only access through GitHub.
          </span>
        ) : <span />}
        {workspace.repo || repoName ? (
          <button type="button" className={s.linkButton} onClick={onDisconnectRepo} disabled={saving}>
            Remove repository
          </button>
        ) : null}
      </div>
    </section>
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
