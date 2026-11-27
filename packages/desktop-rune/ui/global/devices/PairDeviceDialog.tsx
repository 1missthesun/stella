import { Button, Copy, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, T } from "../../kit/compat";
import { useSelfHost } from "../self-host/self-host.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useEffect, useState } from "react";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useT } from "@/shared/i18n";
import type { P2pPairing } from "@stella/contracts/p2p";
import { p2p } from "./use-devices";

type State =
  | { kind: "starting" }
  | { kind: "ready"; pairing: P2pPairing; qr: string }
  | { kind: "paired"; name: string }
  | { kind: "expired" }
  | { kind: "failed"; error: string };

const remaining = (expiresAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** A one-time code for this computer, as a QR code for a phone and as text for another computer. */
export function PairDeviceDialog({ onClose }: { onClose: () => void }) {
  const s = useSelfHost();
  const sPill = usePill();
  const t = useT();
  const [state, setState] = useState<State>({ kind: "starting" });
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const start = useCallback(async () => {
    const api = p2p();
    if (!api) return;
    setState({ kind: "starting" });
    try {
      const pairing = await api.createPairing();
      const { default: QRCode } = await import("qrcode");
      const qr = await QRCode.toDataURL(pairing.url, {
        width: 400,
        margin: 1,
        errorCorrectionLevel: "L",
        color: { dark: "#000000", light: "#ffffff" },
      });
      setState({ kind: "ready", pairing, qr });
    } catch (error) {
      setState({ kind: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void start();
    const api = p2p();
    const off = api?.onPaired((device) => setState({ kind: "paired", name: device.name }));
    return () => {
      off?.();
      void api?.cancelPairing().catch(() => undefined);
    };
  }, [start]);

  const expiresAt = state.kind === "ready" ? state.pairing.expiresAt : 0;
  useEffect(() => {
    if (!expiresAt) return;
    const tick = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at > expiresAt) setState({ kind: "expired" });
    }, 1_000);
    return () => window.clearInterval(tick);
  }, [expiresAt]);

  const copyCode = useCallback(async (code: string) => {
    const ok = await copyTextToClipboard(code);
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
          <DialogDescription {...s.selfHostDialogDescription}>
            {state.kind === "paired" ? t("selfHost.device.claimedNamed", { name: state.name }) : t("devices.pair.intro")}
          </DialogDescription>

          {state.kind === "ready" ? (
            <>
              <col w="full" {...s.selfHostQr}>
                <image src={state.qr} label={t("selfHost.device.qrAlt")} />
              </col>
              <row {...s.selfHostLink}>
                <T {...s.selfHostLinkText}>{state.pairing.code}</T>
                <Button variant="ghost" size="small" className="pill-btn" onClick={() => void copyCode(state.pairing.code)}>
                  <Copy size={13} color={sPill.pillBtn.color} />
                  {copied ? t("selfHost.device.copied") : t("devices.pair.copy")}
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
