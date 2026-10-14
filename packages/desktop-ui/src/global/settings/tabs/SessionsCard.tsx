import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useCallback, useEffect, useState } from "react";
import type { AccountSessionSummary } from "@stella/contracts/auth-session";
import {
  listAccountSessions,
  revokeAccountSession,
} from "@/global/auth/services/auth";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";

const deviceLabel = (session: AccountSessionSummary): string => {
  const ua = session.userAgent ?? "";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/linux/i.test(ua)) return "Linux";
  return ua ? ua.slice(0, 48) : "Unknown device";
};

const LOAD_TIMEOUT_MS = 15_000;

export function SessionsCard() {
  const t = useT();
  const [sessions, setSessions] = useState<AccountSessionSummary[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const timeout = new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS),
      );
      const next = await Promise.race([listAccountSessions(), timeout]);
      if (next.length === 0) throw new Error("empty");
      setSessions(next);
    } catch {
      setSessions((current) => current ?? []);
      setError(t("settings.sessions.loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = useCallback(
    (sessionId: string) => {
      setRevoking(sessionId);
      void revokeAccountSession(sessionId)
        .then(load)
        .catch(() => setError(t("settings.sessions.loadError")))
        .finally(() => setRevoking(null));
    },
    [load, t],
  );

  return (
    <div className="settings-card">
      <SettingsCardTitle titleKey="settings.sessions.title" />
      <p className="settings-card-desc">
        {t("settings.sessions.description")}
      </p>
      {error ? (
        <div className="settings-row">
          <p className="settings-card-desc settings-card-desc--error" role="alert">
            {error}
          </p>
          <div className="settings-row-control">
            <Button type="button" variant="ghost" className="pill-btn" onClick={() => void load()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        </div>
      ) : sessions === null ? (
        <p className="settings-card-desc">{t("common.loading")}</p>
      ) : null}
      {sessions?.map((session) => (
        <div className="settings-row" key={session.id}>
          <div className="settings-row-info">
            <div className="settings-row-label">
              {session.current && !session.userAgent
                ? t("settings.sessions.current")
                : session.current
                  ? `${deviceLabel(session)} · ${t("settings.sessions.current")}`
                  : deviceLabel(session)}
            </div>
            <div className="settings-card-desc">
              {[
                session.ipAddress,
                session.updatedAt
                  ? new Date(session.updatedAt).toLocaleString()
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="settings-row-control">
            {!session.current ? (
              <Button
                type="button"
                variant="ghost"
                className="pill-btn pill-btn--danger"
                disabled={revoking === session.id}
                onClick={() => revoke(session.id)}
              >
                {revoking === session.id
                  ? t("settings.sessions.revoking")
                  : t("settings.sessions.revoke")}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
