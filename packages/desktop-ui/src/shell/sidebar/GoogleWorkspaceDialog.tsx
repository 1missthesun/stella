import { useCallback, useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { BrandIcon } from "@/ui/brand-icon";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import "./google-workspace-dialog.css";

const BUNDLE_ID = "googlesuper";

type Phase = "loading" | "disconnected" | "connecting" | "connected" | "disconnecting";

const SERVICES = [
  {
    name: "Gmail",
    scope: "https://www.googleapis.com/auth/gmail.modify",
    uses: "Search and read your email and attachments, draft and send messages and replies, and organize mail: add or remove labels, archive, mark read or unread, and move to Trash.",
    why: "Read-only can't send or organize, and send/compose can't read your inbox. gmail.modify is the narrowest scope covering read, send, and label together, and it cannot permanently delete mail.",
  },
  {
    name: "Google Calendar",
    scope: "https://www.googleapis.com/auth/calendar",
    uses: "See all of your calendars, list and open events, create, update, and delete events, respond to invitations, and find free time.",
    why: "Read-only can't create or change events. calendar.events can't read your calendar list or look up free/busy, which scheduling across your calendars needs.",
  },
  {
    name: "Google Drive",
    scope: "https://www.googleapis.com/auth/drive",
    uses: "Search all of your Drive, including files you made outside Stella, download and read files, create folders, and rename, move, or trash files.",
    why: "drive.file only reaches files Stella created or you opened with Stella, so it can't find your existing files. Read-only scopes can't rename, move, or trash.",
  },
  {
    name: "Google Docs",
    scope: "https://www.googleapis.com/auth/documents",
    uses: "Create documents, read their text, comments, and suggested edits, write and replace text, and apply formatting.",
    why: "documents.readonly can't create or edit documents.",
  },
  {
    name: "Google Sheets",
    scope: "https://www.googleapis.com/auth/spreadsheets",
    uses: "Create spreadsheets, read tabs and cell ranges, write cells, append rows, and add tabs.",
    why: "spreadsheets.readonly can't create or write, and drive.file can't open the spreadsheets you already have.",
  },
  {
    name: "Google Tasks",
    scope: "https://www.googleapis.com/auth/tasks",
    uses: "See your task lists and tasks, create tasks, edit them, and mark them complete.",
    why: "tasks.readonly can't create, edit, or complete tasks; Google has no narrower write scope for Tasks.",
  },
] as const;

export const GoogleWorkspaceDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api?.list) return;
    const list = await api.list().catch(() => []);
    const bundle = list.find((entry) => entry.id === BUNDLE_ID);
    setPhase(bundle?.enabled ? "connected" : "disconnected");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api) return;
    setError(null);
    setPhase("connecting");
    try {
      await api.enable({ id: BUNDLE_ID });
      setPhase("connected");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api) return;
    setError(null);
    setPhase("disconnecting");
    try {
      await api.disable({ id: BUNDLE_ID });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    await refresh();
  }, [refresh]);

  const connected = phase === "connected" || phase === "disconnecting";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="google-workspace-dialog">
        <DialogHeader>
          <DialogTitle>Google Workspace</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="google-workspace-dialog__body">
        <div className="google-workspace-dialog__status" data-connected={connected || undefined}>
          <BrandIcon brand="google" size={22} />
          <div className="google-workspace-dialog__status-copy">
            <span className="google-workspace-dialog__status-title">
              {phase === "loading"
                ? "Checking connection…"
                : phase === "connecting"
                  ? "Waiting for Google in your browser…"
                  : connected
                    ? "Connected"
                    : "Not connected"}
            </span>
            <span className="google-workspace-dialog__status-sub">
              One Google sign-in gives Stella these six services. Stella uses them only when you ask it to in chat.
            </span>
          </div>
          {connected ? (
            <Button
              variant="ghost"
              className="pill-btn"
              disabled={phase === "disconnecting"}
              onClick={() => void disconnect()}
            >
              {phase === "disconnecting" ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : (
            <Button
              variant="primary"
              className="pill-btn pill-btn--primary"
              disabled={phase === "loading" || phase === "connecting"}
              onClick={() => void connect()}
            >
              Connect with Google
            </Button>
          )}
        </div>
        {error ? <p className="google-workspace-dialog__error">{error}</p> : null}
        <ol className="google-workspace-dialog__scopes">
          {SERVICES.map((service) => (
            <li key={service.scope} className="google-workspace-dialog__scope">
              <div className="google-workspace-dialog__scope-head">
                <span className="google-workspace-dialog__scope-name">{service.name}</span>
                <code className="google-workspace-dialog__scope-id">{service.scope}</code>
              </div>
              <p className="google-workspace-dialog__scope-uses">{service.uses}</p>
              <p className="google-workspace-dialog__scope-why">
                <span>Why this scope: </span>
                {service.why}
              </p>
            </li>
          ))}
        </ol>
        <p className="google-workspace-dialog__identity">
          Sign-in scopes <code>openid</code>, <code>userinfo.email</code>, and{" "}
          <code>userinfo.profile</code> only identify which Google account is connected.
          Disconnect revokes Stella's access at Google.
        </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
