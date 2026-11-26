import { Button, Copy, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, T } from "../../kit/compat";
import { useSelfHost } from "./self-host.styles";
import { usePill } from "../shared/pill.styles";
import { serverNow } from "@stella/contracts/server-clock";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useT } from "@/shared/i18n";

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
  const s = useSelfHost();
  const sPill = usePill();
  const t = useT();
  const [state, setState] = useState<State>({ kind: "starting" });
  const [now, setNow] = useState(() => serverNow());
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
    const { default: QRCode } = await import("qrcode");
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
    const tick = window.setInterval(() => setNow(serverNow()), 1_000);
    const poll = async () => {
      if (stopped) return;
      const status = await window.electronAPI?.selfHost?.pairingStatus(pairingId);
      if (stopped || !status) return;
      if (status.ok && status.status === "claimed") {
        pendingId.current = null;
        setState({ kind: "claimed", deviceName: status.deviceName });
        return;
      }
      if ((status.ok && status.status !== "pending") || serverNow() > expiresAt) {
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
    const ok = await copyTextToClipboard(link);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1_500);
  }, []);

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent fit {...s.dialog_selfHostDialog}>
        <DialogHeader {...s.selfHostDialog_dialogHeader}>
          <DialogTitle>{t("selfHost.device.title")}</DialogTitle>
        </DialogHeader>
        <col {...s.selfHostDialogBody}>
          {state.kind === "claimed" ? (
            <DialogDescription {...s.selfHostDialogDescription}>
              {state.deviceName
                ? t("selfHost.device.claimedNamed", { name: state.deviceName })
                : t("selfHost.device.claimed")}
            </DialogDescription>
          ) : (
            <DialogDescription {...s.selfHostDialogDescription}>
              {t("selfHost.device.intro")}
            </DialogDescription>
          )}

          {state.kind === "ready" ? (
            <>
              <col w="full" {...s.selfHostQr}>
                <image src={state.pairing.qr} label={t("selfHost.device.qrAlt")} />
              </col>
              <row {...s.selfHostLink}>
                <T {...s.selfHostLinkText}>{state.pairing.link}</T>
                <Button variant="ghost" size="small" className="pill-btn" onClick={() => void copyLink(state.pairing.link)}>
                  <Copy size={13} color={sPill.pillBtn.color} />
                  {copied ? t("selfHost.device.copied") : t("selfHost.device.copy")}
                </Button>
              </row>
              <T w="full" {...s.selfHostDialogMeta}>
                {t("selfHost.device.expires", { time: remaining(state.pairing.expiresAt, now) })}
              </T>
            </>
          ) : state.kind === "starting" ? (
            <col w="full" {...s.selfHostQr} {...s.selfHostQrPlaceholder} />
          ) : state.kind === "expired" ? (
            <T w="full" {...s.selfHostDialogError} role="status">
              {t("selfHost.device.expired")}
            </T>
          ) : state.kind === "failed" ? (
            <T w="full" {...s.selfHostDialogError} role="alert">
              {state.error}
            </T>
          ) : null}

          <row {...s.selfHostDialogActions}>
            {state.kind === "expired" || state.kind === "failed" ? (
              <Button variant="ghost" className="pill-btn" onClick={() => void start()}>
                {t("selfHost.device.newCode")}
              </Button>
            ) : null}
            <Button variant="primary" className="pill-btn" onClick={onClose}>
              {t("selfHost.device.done")}
            </Button>
          </row>
        </col>
      </DialogContent>
    </Dialog>
  );
}
