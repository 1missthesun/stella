import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/ui/button";
import { Copy } from "@/ui/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { useT } from "@/shared/i18n";
import "./self-host.css";

type Pairing = { pairingId: string; link: string; expiresAt: number; qr: string };

type State =
  | { kind: "starting" }
  | { kind: "ready"; pairing: Pairing }
  | { kind: "claimed"; deviceName: string | null }
  | { kind: "expired" }
  | { kind: "failed"; error: string };

const POLL_MS = 2_000;

const remaining = (expiresAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function ConnectDeviceDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "starting" });
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const pendingId = useRef<string | null>(null);

  const start = useCallback(async () => {
    const api = window.electronAPI?.selfHost;
    if (!api) return;
    setState({ kind: "starting" });
    const result = await api.startPairing();
    if (!result.ok) {
      setState({ kind: "failed", error: result.error });
      return;
    }
    const qr = await QRCode.toDataURL(result.link, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    pendingId.current = result.pairingId;
    setState({ kind: "ready", pairing: { ...result, qr } });
  }, []);

  useEffect(() => {
    void start();
    return () => {
      const id = pendingId.current;
      pendingId.current = null;
      if (id) void window.electronAPI?.selfHost?.cancelPairing(id);
    };
  }, [start]);

  const pairingId = state.kind === "ready" ? state.pairing.pairingId : null;
  const expiresAt = state.kind === "ready" ? state.pairing.expiresAt : 0;
  useEffect(() => {
    if (!pairingId) return;
    let stopped = false;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    const poll = async () => {
      if (stopped) return;
      const status = await window.electronAPI?.selfHost?.pairingStatus(pairingId);
      if (stopped || !status) return;
      if (status.ok && status.status === "claimed") {
        pendingId.current = null;
        setState({ kind: "claimed", deviceName: status.deviceName });
        return;
      }
      if ((status.ok && status.status !== "pending") || Date.now() > expiresAt) {
        pendingId.current = null;
        setState({ kind: "expired" });
        return;
      }
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    let timer = window.setTimeout(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.clearTimeout(timer);
    };
  }, [expiresAt, pairingId]);

  const copyLink = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent fit className="self-host-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("selfHost.device.title")}</DialogTitle>
        </DialogHeader>
        <div className="self-host-dialog__body">
          {state.kind === "claimed" ? (
            <DialogDescription className="self-host-dialog__text">
              {state.deviceName
                ? t("selfHost.device.claimedNamed", { name: state.deviceName })
                : t("selfHost.device.claimed")}
            </DialogDescription>
          ) : (
            <DialogDescription className="self-host-dialog__text">
              {t("selfHost.device.intro")}
            </DialogDescription>
          )}

          {state.kind === "ready" ? (
            <>
              <div className="self-host-qr">
                <img src={state.pairing.qr} alt={t("selfHost.device.qrAlt")} draggable={false} />
              </div>
              <div className="self-host-link">
                <code className="self-host-link__text">{state.pairing.link}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  className="pill-btn"
                  onClick={() => void copyLink(state.pairing.link)}
                >
                  <Copy size={13} />
                  {copied ? t("selfHost.device.copied") : t("selfHost.device.copy")}
                </Button>
              </div>
              <p className="self-host-dialog__meta">
                {t("selfHost.device.expires", { time: remaining(state.pairing.expiresAt, now) })}
              </p>
            </>
          ) : state.kind === "starting" ? (
            <div className="self-host-qr self-host-qr--placeholder" aria-hidden="true" />
          ) : state.kind === "expired" ? (
            <p className="self-host-dialog__error" role="status">
              {t("selfHost.device.expired")}
            </p>
          ) : state.kind === "failed" ? (
            <p className="self-host-dialog__error" role="alert">
              {state.error}
            </p>
          ) : null}

          <div className="self-host-dialog__actions">
            {state.kind === "expired" || state.kind === "failed" ? (
              <Button type="button" variant="ghost" className="pill-btn" onClick={() => void start()}>
                {t("selfHost.device.newCode")}
              </Button>
            ) : null}
            <Button type="button" variant="primary" className="pill-btn" onClick={onClose}>
              {t("selfHost.device.done")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
