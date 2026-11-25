import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Form, Input, T } from "../../kit/compat";
import { useSelfHost } from "./self-host.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useEffect, useState } from "react";
import type { ServerDiscovery } from "@stella/contracts/self-host";
import { useT } from "@/shared/i18n";

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
  notice,
  onClose,
}: {
  initialLink: string | null;
  notice?: string;
  onClose: () => void;
}) {
  const s = useSelfHost();
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
    <Dialog open onOpenChange={(open) => {
        if (!open && step.kind !== "restarting" && step.kind !== "connecting") onClose();
      }}>
      <DialogContent fit>
        <DialogHeader>
          <DialogTitle>
            {step.kind === "restarting"
              ? t("selfHost.connect.restartingTitle", { name: step.discovery.name })
              : t("selfHost.connect.title")}
          </DialogTitle>
        </DialogHeader>

        {step.kind === "enter" || step.kind === "checking" ? (
          <Form {...s.selfHostDialogBody} onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) void inspect(text);
            }}>
            <DialogDescription {...s.selfHostDialogText} {...s.selfHostDialog_selfHostDialogText}>
              {t("selfHost.connect.intro")}
            </DialogDescription>
            {notice ? <T w="full" {...s.selfHostDialogNotice}>{notice}</T> : null}
            <Input {...s.selfHostDialogInput} multiline value={text} rows={3} spellCheck={false} autoFocus placeholder="stella://pair?server=…&code=…" label={t("selfHost.connect.linkLabel")} onChange={(event) => setText(event.target.value)} disabled={busy} />
            {error ? (
              <T w="full" {...s.selfHostDialogError} role="alert">
                {error}
              </T>
            ) : null}
            <row {...s.selfHostDialogActions}>
              <Button variant="ghost" className="pill-btn" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" className="pill-btn" disabled={busy || !text.trim()}>
                {step.kind === "checking" ? t("selfHost.connect.checking") : t("common.continue")}
              </Button>
            </row>
          </Form>
        ) : step.kind === "confirm" || step.kind === "connecting" ? (
          <col {...s.selfHostDialogBody}>
            <col {...s.selfHostServer}>
              <T w="full" {...s.selfHostServerName}>{step.discovery.name}</T>
              <T w="full" {...s.selfHostServerHost}>{hostOf(step.server)}</T>
              {releasedOn(step.discovery.releasedAt) ? (
                <T w="full" {...s.selfHostServerMeta}>
                  {t("selfHost.connect.version", { date: releasedOn(step.discovery.releasedAt)! })}
                </T>
              ) : null}
            </col>
            <T w="full" {...s.selfHostDialogNotice}>
              {step.discovery.ownerMode
                ? t("selfHost.connect.ownerNotice")
                : t("selfHost.connect.hostedNotice")}
            </T>
            <T w="full" {...s.selfHostDialogText} {...s.selfHostDialog_selfHostDialogText}>{t("selfHost.connect.restartNotice")}</T>
            {error ? (
              <T w="full" {...s.selfHostDialogError} role="alert">
                {error}
              </T>
            ) : null}
            <row {...s.selfHostDialogActions}>
              <Button variant="ghost" className="pill-btn" onClick={onClose} disabled={step.kind === "connecting"}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" className="pill-btn" onClick={() => void connect()} disabled={step.kind === "connecting"}>
                {step.kind === "connecting" ? t("selfHost.connect.connecting") : t("selfHost.connect.connect")}
              </Button>
            </row>
          </col>
        ) : (
          <col {...s.selfHostDialogBody}>
            <T w="full" {...s.selfHostDialogText} {...s.selfHostDialog_selfHostDialogText}>{t("selfHost.connect.restarting")}</T>
            <col w="full" {...s.selfHostDialogProgress} />
          </col>
        )}
      </DialogContent>
    </Dialog>
  );
}
