import { useCallback, useEffect, useState } from "react";
import type { ServerDiscovery } from "@stella/contracts/self-host";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { useT } from "@/shared/i18n";
import "./self-host.css";

type Step =
  | { kind: "enter" }
  | { kind: "checking" }
  | { kind: "confirm"; server: string; discovery: ServerDiscovery }
  | { kind: "connecting"; server: string; discovery: ServerDiscovery }
  | { kind: "restarting"; discovery: ServerDiscovery };

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

const releasedOn = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

export function ConnectServerDialog({
  initialLink,
  onClose,
}: {
  initialLink: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(initialLink ?? "");
  const [step, setStep] = useState<Step>({ kind: "enter" });
  const [error, setError] = useState<string | null>(null);

  const inspect = useCallback(
    async (value: string) => {
      const api = window.electronAPI?.selfHost;
      if (!api) {
        setError(t("selfHost.connect.unavailable"));
        return;
      }
      setError(null);
      setStep({ kind: "checking" });
      const result = await api.inspectLink(value);
      if (!result.ok) {
        setError(result.error);
        setStep({ kind: "enter" });
        return;
      }
      setStep({ kind: "confirm", server: result.server, discovery: result.discovery });
    },
    [t],
  );

  useEffect(() => {
    if (initialLink) void inspect(initialLink);
  }, [initialLink, inspect]);

  const connect = useCallback(async () => {
    if (step.kind !== "confirm") return;
    const api = window.electronAPI?.selfHost;
    if (!api) return;
    setError(null);
    setStep({ kind: "connecting", server: step.server, discovery: step.discovery });
    const result = await api.connect(text.trim() || initialLink || "");
    if (!result.ok) {
      setError(result.error);
      setStep({ kind: "confirm", server: step.server, discovery: step.discovery });
      return;
    }
    if (result.relaunching) {
      setStep({ kind: "restarting", discovery: step.discovery });
      return;
    }
    onClose();
  }, [initialLink, onClose, step, text]);

  const busy = step.kind === "checking" || step.kind === "connecting" || step.kind === "restarting";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && step.kind !== "restarting" && step.kind !== "connecting") onClose();
      }}
    >
      <DialogContent fit className="self-host-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {step.kind === "restarting"
              ? t("selfHost.connect.restartingTitle", { name: step.discovery.name })
              : t("selfHost.connect.title")}
          </DialogTitle>
        </DialogHeader>

        {step.kind === "enter" || step.kind === "checking" ? (
          <form
            className="self-host-dialog__body"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) void inspect(text);
            }}
          >
            <DialogDescription className="self-host-dialog__text">
              {t("selfHost.connect.intro")}
            </DialogDescription>
            <textarea
              className="self-host-dialog__input"
              value={text}
              rows={3}
              spellCheck={false}
              autoFocus
              placeholder="stella://pair?server=…&code=…"
              aria-label={t("selfHost.connect.linkLabel")}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
            />
            {error ? (
              <p className="self-host-dialog__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="self-host-dialog__actions">
              <Button type="button" variant="ghost" className="pill-btn" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" className="pill-btn" disabled={busy || !text.trim()}>
                {step.kind === "checking" ? t("selfHost.connect.checking") : t("common.continue")}
              </Button>
            </div>
          </form>
        ) : step.kind === "confirm" || step.kind === "connecting" ? (
          <div className="self-host-dialog__body">
            <div className="self-host-server">
              <div className="self-host-server__name">{step.discovery.name}</div>
              <div className="self-host-server__host">{hostOf(step.server)}</div>
              {releasedOn(step.discovery.releasedAt) ? (
                <div className="self-host-server__meta">
                  {t("selfHost.connect.version", { date: releasedOn(step.discovery.releasedAt)! })}
                </div>
              ) : null}
            </div>
            <p className="self-host-dialog__notice">
              {step.discovery.ownerMode
                ? t("selfHost.connect.ownerNotice")
                : t("selfHost.connect.hostedNotice")}
            </p>
            <p className="self-host-dialog__text">{t("selfHost.connect.restartNotice")}</p>
            {error ? (
              <p className="self-host-dialog__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="self-host-dialog__actions">
              <Button
                type="button"
                variant="ghost"
                className="pill-btn"
                onClick={onClose}
                disabled={step.kind === "connecting"}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="pill-btn"
                onClick={() => void connect()}
                disabled={step.kind === "connecting"}
              >
                {step.kind === "connecting" ? t("selfHost.connect.connecting") : t("selfHost.connect.connect")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="self-host-dialog__body">
            <p className="self-host-dialog__text">{t("selfHost.connect.restarting")}</p>
            <div className="self-host-dialog__progress" aria-hidden="true" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
