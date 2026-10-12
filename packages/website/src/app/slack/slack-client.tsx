"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Check, GitBranch, Lock, Plus } from "lucide-react";
import type { ReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import {
  SLACK_INSTALL_RESULT_PARAM,
  SLACK_MEMORY_MAX_CHARS,
  SLACK_RULES_MAX_CHARS,
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
import { listSlackWorkspaces, startSlackInstall, updateSlackWorkspace } from "./slack-api";
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

const installedDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const isInstallResult = (value: string | null): value is SlackInstallResult =>
  value === "installed" || value === "canceled" || value === "failed";

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";

type Boot = { mock: SlackMockMode | null; result: SlackInstallResult | null };

let bootSnapshot: Boot | null = null;

const readBoot = (): Boot => {
  if (!bootSnapshot) {
    const raw = new URL(window.location.href).searchParams.get(SLACK_INSTALL_RESULT_PARAM);
    bootSnapshot = { mock: readMockMode(), result: isInstallResult(raw) ? raw : null };
  }
  return bootSnapshot;
};

const subscribeNever = () => () => {};

export function SlackClient() {
  const boot = useSyncExternalStore(subscribeNever, readBoot, () => null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SLACK_INSTALL_RESULT_PARAM)) return;
    url.searchParams.delete(SLACK_INSTALL_RESULT_PARAM);
    window.history.replaceState(null, "", url.toString());
  }, []);

  let body;
  if (boot === null) body = <Loading />;
  else if (boot.mock) body = <Account installResult={boot.result} />;
  else if (!isBackendConfigured())
    body = <Notice title="Not available here">This build of the site isn&apos;t connected to Stella.</Notice>;
  else body = <SessionGate installResult={boot.result} />;

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

function SessionGate({ installResult }: { installResult: SlackInstallResult | null }) {
  const session = authClient.useSession();
  if (session.isPending) return <Loading />;
  const user = (session.data as { user?: { id?: string; isAnonymous?: boolean | null } } | null)?.user;
  if (!user || user.isAnonymous) return <SignedOut installResult={installResult} />;
  return <Account key={user.id ?? "user"} installResult={installResult} />;
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

function Account({ installResult }: { installResult: SlackInstallResult | null }) {
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
  repoToken: string;
  removeToken: boolean;
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
  repoToken: "",
  removeToken: false,
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
  const token = d.repoToken.trim();
  if (name) {
    const changed =
      !w.repo || name !== w.repo.fullName || branch !== w.repo.branch || token !== "" || d.removeToken;
    if (changed) {
      update.repo = { fullName: name, branch };
      if (token) update.repo.token = token;
      else if (d.removeToken) update.repo.token = "";
    }
  } else if (w.repo) {
    update.repo = null;
  }
  return update;
};

function WorkspaceCard({
  workspace,
  options,
  onUpdated,
}: {
  workspace: SlackWorkspace;
  options: SlackWorkspaceOptions;
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
      setDraft((current) => ({ ...current, repoName: "", repoBranch: "", repoToken: "", removeToken: false }));
      return;
    }
    if (!window.confirm(`Disconnect ${workspace.repo.fullName}? New agents in this workspace will start without it.`)) return;
    void commit({ repo: null });
  };

  const tokenSaved = Boolean(workspace.repo?.hasToken) && !draft.removeToken;

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

      <section className={s.panel}>
        <div className={s.panelHead}>
          <p className={s.cardEyebrow}>
            <GitBranch size={13} aria-hidden="true" /> GitHub repository
          </p>
          <p className={s.panelLede}>
            Every agent Stella starts in this workspace begins with this repository cloned in.
          </p>
        </div>
        <div className={s.row}>
          <label className={s.field}>
            <span className={s.label}>Repository</span>
            <input
              className={s.input}
              value={draft.repoName}
              onChange={(event) => set("repoName", event.target.value)}
              placeholder="owner/name"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={repoInvalid || undefined}
            />
            {repoInvalid ? <span className={s.fieldError}>Use the form owner/name.</span> : null}
          </label>
          <label className={s.field}>
            <span className={s.label}>Branch</span>
            <input
              className={s.input}
              value={draft.repoBranch}
              onChange={(event) => set("repoBranch", event.target.value)}
              placeholder="Default branch"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        </div>
        <label className={s.field}>
          <span className={s.label}>Access token, for private repositories</span>
          <input
            className={s.input}
            type="password"
            value={draft.repoToken}
            onChange={(event) => set("repoToken", event.target.value)}
            placeholder={tokenSaved ? "Token saved. Paste a new one to replace it" : "github_pat_…"}
            spellCheck={false}
            autoComplete="off"
            disabled={!repoName}
          />
          <span className={s.hint}>
            A fine-grained token with read-only access to Contents on this repository.
          </span>
        </label>
        <div className={s.repoFoot}>
          {tokenSaved && !draft.repoToken ? (
            <span className={s.tokenSaved}>
              <Lock size={13} aria-hidden="true" /> Token saved
              <button type="button" className={s.linkButton} onClick={() => set("removeToken", true)}>
                Remove
              </button>
            </span>
          ) : draft.removeToken ? (
            <span className={s.tokenSaved}>
              Token will be removed
              <button type="button" className={s.linkButton} onClick={() => set("removeToken", false)}>
                Keep it
              </button>
            </span>
          ) : null}
          {workspace.repo || draft.repoName ? (
            <button type="button" className={s.linkButton} onClick={disconnectRepo} disabled={saving}>
              Disconnect repository
            </button>
          ) : null}
        </div>
      </section>

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
