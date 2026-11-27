import { Button, Copy, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Press, T } from "../../kit/compat";
import { useSelfHost } from "../self-host/self-host.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useT } from "@/shared/i18n";
import type { P2pPairing } from "@stella/contracts/p2p";
import { p2p } from "./use-devices";
import { useDevicesStyles } from "./devices.styles";

type State =
  | { kind: "starting" }
  | { kind: "ready"; pairing: P2pPairing; short: string | null; qr: string }
  | { kind: "paired"; name: string }
  | { kind: "expired" }
  | { kind: "failed"; error: string };

const remaining = (expiresAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const qrFor = async (url: string) => {
  const { default: QRCode } = await import("qrcode");
  return await QRCode.toDataURL(url, { width: 400, margin: 1, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#ffffff" } });
};

/** This computer's one-time code: a QR code for a phone, a short code to type on another computer,
 *  and the full code for when there's no internet. */
export function PairDeviceDialog({ onClose }: { onClose: () => void }) {
  const s = useSelfHost();
  const d = useDevicesStyles();
  const sPill = usePill();
  const t = useT();
  const [state, setState] = useState<State>({ kind: "starting" });
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [offline, setOffline] = useState(false);
  const live = useRef(true);

  const start = useCallback(async () => {
    const api = p2p();
    if (!api) return;
    setState({ kind: "starting" });
    setOffline(false);
    try {
      const short = await api.createShortCode().catch(() => null);
      const pairing = short ?? (await api.createPairing());
      const qr = await qrFor(pairing.url);
      if (!live.current) return;
      setState({ kind: "ready", pairing, short: short?.short ?? null, qr });
      if (!short) setOffline(true);
    } catch (error) {
      setState({ kind: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void start();
    const api = p2p();
    const offPaired = api?.onPaired((device) => setState({ kind: "paired", name: device.name }));
    // A wrong guess spends a short code; the same pairing gets a new one.
    const offShort = api?.onShortCodeEnded((reason) => {
      if (reason !== "failed") return;
      void api
        .createShortCode()
        .then((short) => setState((current) => (current.kind === "ready" ? { ...current, short: short.short } : current)))
        .catch(() => setState((current) => (current.kind === "ready" ? { ...current, short: null } : current)));
    });
    return () => {
      live.current = false;
      offPaired?.();
      offShort?.();
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
              {state.short ? (
                <col w="full" {...d.shortBlock}>
                  <T {...d.shortCode} selectable label={t("devices.pair.shortLabel")}>
                    {state.short}
                  </T>
                  <T w="full" {...s.selfHostDialogMeta}>
                    {t("selfHost.device.expires", { time: remaining(state.pairing.expiresAt, now) })}
                  </T>
                </col>
              ) : null}
              {offline ? (
                <col w="full" {...d.offlineBlock}>
                  {!state.short ? (
                    <T w="full" {...s.selfHostDialogMeta}>
                      {t("devices.pair.noShort")}
                    </T>
                  ) : null}
                  <row {...s.selfHostLink}>
                    <T {...s.selfHostLinkText}>{state.pairing.code}</T>
                    <Button variant="ghost" size="small" className="pill-btn" onClick={() => void copyCode(state.pairing.code)}>
                      <Copy size={13} color={sPill.pillBtn.color} />
                      {copied ? t("selfHost.device.copied") : t("devices.pair.copy")}
                    </Button>
                  </row>
                </col>
              ) : (
                <Press {...d.quietLink} onPress={() => setOffline(true)}>
                  <T {...d.quietLinkText}>{t("devices.pair.useOffline")}</T>
                </Press>
              )}
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
