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

/** Signed-in sessions on this account, each revocable on its own. */
export function SessionsCard() {
  const t = useT();
  const [sessions, setSessions] = useState<AccountSessionSummary[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await listAccountSessions());
      setError(null);
    } catch {
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
      <h3 className="settings-card-title">{t("settings.sessions.title")}</h3>
      <p className="settings-card-desc">
        {t("settings.sessions.description")}
      </p>
      {error ? (
        <p className="settings-card-desc settings-card-desc--error" role="alert">
          {error}
        </p>
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
