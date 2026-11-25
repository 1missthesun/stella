import { SettingsCard, SettingsRow } from "../../settings/parts";
import { Button, Input, T, showToast } from "../../kit/compat";
import { useSettings } from "../../settings/settings.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useState } from "react";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import {
  createCloudProject,
  finishGithubConnect,
  startGithubInstall,
  useCloudProjects,
  useGithubConnections,
} from "@/features/cloud/cloud-projects-api";

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  stella: "Stella-hosted",
};

const projectErrorText = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : "That didn't work. Try again.";

function CloudProjectsCardImpl() {
  const s = useSettings();
  const projects = useCloudProjects();
  const github = useGithubConnections();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [connectCode, setConnectCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const connections = github?.connections ?? [];

  const handleConnect = useCallback(async () => {
    setBusy(true);
    try {
      const { installUrl } = await startGithubInstall();
      window.open(installUrl, "_blank", "noopener");
      setAwaitingCode(true);
    } catch (error) {
      showToast({ title: projectErrorText(error), variant: "error" });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleFinishConnect = useCallback(async () => {
    const code = connectCode.trim();
    if (!code) return;
    setBusy(true);
    try {
      const result = await finishGithubConnect(code);
      if (!result.ok) {
        showToast({
          title: result.reason ?? "That connect code was not accepted.",
          variant: "error",
        });
        return;
      }
      setConnectCode("");
      setAwaitingCode(false);
      showToast({
        title: `GitHub connected as ${result.accountLogin}.`,
        variant: "success",
      });
    } catch (error) {
      showToast({ title: projectErrorText(error), variant: "error" });
    } finally {
      setBusy(false);
    }
  }, [connectCode]);

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setBusy(true);
    try {
      const remote = remoteUrl.trim();
      await createCloudProject({
        name: trimmedName,
        ...(remote ? { remoteUrl: remote } : {}),
      });
      setName("");
      setRemoteUrl("");
    } catch (error) {
      showToast({ title: projectErrorText(error), variant: "error" });
    } finally {
      setBusy(false);
    }
  }, [name, remoteUrl]);

  return (
    <SettingsCard>
      <T role="heading" {...s.settingsCardTitle}>Cloud projects</T>
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>GitHub</T>
          <T w="full" {...s.settingsRowSublabel}>
            {connections.length
              ? `Connected as ${connections
                  .map((connection) => connection.accountLogin)
                  .join(", ")}.`
              : github && !github.appConfigured
                ? "GitHub projects aren't configured on this deployment yet."
                : "Give cloud tasks access to your repositories."}
          </T>
        </col>
        <row {...s.settingsRowControl}>
          <Button variant="ghost" className="pill-btn" onClick={() => void handleConnect()} disabled={busy || github?.appConfigured === false}>
            {connections.length ? "Manage" : "Connect"}
          </Button>
        </row>
      </SettingsRow>
      {awaitingCode ? (
        <SettingsRow>
          <col {...s.settingsRowInfo} grow={1} shrink minW={0}>
            <T w="full" {...s.settingsRowSublabel}>
              Enter the connect code GitHub showed you.
            </T>
            <Input type="text" value={connectCode} onChange={(event) => setConnectCode(event.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} w="full" mt={6} />
          </col>
          <row {...s.settingsRowControl}>
            <Button variant="ghost" className="pill-btn" onClick={() => void handleFinishConnect()} disabled={busy || !connectCode.trim()}>
              Finish
            </Button>
          </row>
        </SettingsRow>
      ) : null}
      {(projects ?? []).map((project) => (
        <SettingsRow key={project.projectId}>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>{project.name}</T>
            <T w="full" {...s.settingsRowSublabel}>
              {PROVIDER_LABEL[project.provider] ?? project.provider} ·{" "}
              {project.remoteUrl ?? `project:${project.slug}`}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <T {...s.settingsRowSublabel}>{project.status}</T>
          </row>
        </SettingsRow>
      ))}
      <SettingsRow>
        <col {...s.settingsRowInfo} grow={1} shrink minW={0}>
          <T w="full" {...s.settingsRowSublabel}>
            New project
          </T>
          <Input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" autoComplete="off" spellCheck={false} w="full" mt={6} />
          <Input type="text" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="GitHub repository URL (optional)" autoComplete="off" spellCheck={false} w="full" mt={6} />
        </col>
        <row {...s.settingsRowControl}>
          <Button variant="ghost" className="pill-btn" onClick={() => void handleCreate()} disabled={busy || !name.trim()}>
            Add
          </Button>
        </row>
      </SettingsRow>
    </SettingsCard>
  );
}

export function CloudProjectsCard() {
  const { isAuthenticated } = useAuthState();
  if (!isAuthenticated) return null;
  return (
    <CloudBoundary>
      <CloudProjectsCardImpl />
    </CloudBoundary>
  );
}
