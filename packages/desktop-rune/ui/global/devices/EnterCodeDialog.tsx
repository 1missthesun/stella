import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Form, Input, Monitor, T } from "../../kit/compat";
import { useSelfHost } from "../self-host/self-host.styles";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/shared/i18n";
import type { P2pNearbyComputer } from "@stella/contracts/p2p";
import { p2p, useLocalNetwork } from "./use-devices";
import { useDevicesStyles } from "./devices.styles";

const NONE: P2pNearbyComputer[] = [];
const noop = () => () => {};

const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

/** Pairs this device to another computer's Stella: one on this network with the six digits it
 *  shows, or anywhere with the code from its Connect a device dialog. */
export function EnterCodeDialog({ initialCode, onClose, onPaired }: { initialCode?: string; onClose: () => void; onPaired: (conversationId: string | null) => void }) {
  const s = useSelfHost();
  const d = useDevicesStyles();
  const t = useT();
  const api = p2p();
  // Nearby computers are looked for only while the person has turned on finding devices on this network.
  const localNetwork = useLocalNetwork();
  const watching = api && localNetwork;
  const nearby = useSyncExternalStore(watching ? api.watchNearby : noop, watching ? api.nearby : () => NONE, () => NONE);
  const [text, setText] = useState(initialCode ?? "");
  const [asking, setAsking] = useState<P2pNearbyComputer | null>(null);
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const askingRef = useRef(asking);
  askingRef.current = asking;
  const stoppedAsking = useRef<string | null>(null);

  useEffect(
    () =>
      api?.onNearbyEnded((id, reason) => {
        const current = askingRef.current;
        if (current?.id !== id) return;
        setAsking(null);
        setBusy(null);
        setDigits("");
        setError(reason === "denied" ? t("devices.nearby.denied", { name: current.name }) : t("devices.nearby.ended", { name: current.name }));
      }),
    [api, t],
  );

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(null);
    }
  };

  const pairWithCode = () =>
    void run("code", async () => {
      if (!api || !text.trim()) return;
      onPaired((await api.pair(text)).conversationId);
    });

  const ask = (computer: P2pNearbyComputer) =>
    void run(computer.id, async () => {
      if (!api) return;
      stoppedAsking.current = null;
      try {
        await api.askNearby(computer.id);
      } catch (failure) {
        if (stoppedAsking.current === computer.id) return;
        throw failure;
      }
      setDigits("");
      setAsking(computer);
    });

  const confirm = () =>
    void run("digits", async () => {
      if (!api || !asking) return;
      onPaired((await api.confirmNearby(asking.id, digits)).conversationId);
    });

  const back = () => {
    if (asking) api?.cancelNearby(asking.id);
    setAsking(null);
    setError(null);
  };

  const unpaired = nearby.filter((c) => !c.paired);
  // Asked, and waiting for the person at that computer to allow it.
  const waitingOn = busy ? (unpaired.find((c) => c.id === busy) ?? null) : null;

  const stopWaiting = () => {
    if (!waitingOn) return;
    stoppedAsking.current = waitingOn.id;
    api?.cancelNearby(waitingOn.id);
  };

  const close = () => {
    if (asking) api?.cancelNearby(asking.id);
    stopWaiting();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && (!busy || waitingOn) ? close() : undefined)}>
      <DialogContent fit {...s.dialog_selfHostDialog}>
        <DialogHeader {...s.selfHostDialog_dialogHeader}>
          <DialogTitle>{asking ? t("devices.nearby.digitsTitle", { name: asking.name }) : t("devices.enter.title")}</DialogTitle>
        </DialogHeader>
        {asking ? (
          <Form
            {...s.selfHostDialogBody}
            onSubmit={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            <DialogDescription {...s.selfHostDialogDescription}>{t("devices.nearby.digitsIntro", { name: asking.name })}</DialogDescription>
            <Input
              {...d.digitsInput}
              value={digits}
              spellCheck={false}
              autoFocus
              placeholder="000000"
              label={t("devices.nearby.digitsLabel")}
              onChange={(event) => setDigits(event.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={busy !== null}
            />
            {error ? (
              <T w="full" {...s.selfHostDialogError} role="alert">
                {error}
              </T>
            ) : null}
            <row {...s.selfHostDialogActions}>
              <Button variant="ghost" className="pill-btn" onClick={back} disabled={busy !== null}>
                {t("common.back")}
              </Button>
              <Button type="submit" variant="primary" className="pill-btn" disabled={busy !== null || digits.length !== 6}>
                {busy ? t("devices.enter.connecting") : t("devices.enter.connect")}
              </Button>
            </row>
          </Form>
        ) : (
          <Form
            {...s.selfHostDialogBody}
            onSubmit={(event) => {
              event.preventDefault();
              pairWithCode();
            }}
          >
            {localNetwork ? (
            <col w="full" gap={4}>
              <T {...d.sectionLabel}>{t("devices.nearby.title")}</T>
              {unpaired.length ? (
                <col w="full" {...d.nearbyList} role="list">
                  {unpaired.map((computer) => (
                    <row key={computer.id} w="full" {...d.nearbyRow} role="listitem">
                      <Monitor size={18} {...s.serverListIcon} />
                      <T {...d.nearbyName}>{computer.name}</T>
                      <Button variant="ghost" size="small" className="pill-btn" label={t("devices.nearby.connectTo", { name: computer.name })} onClick={() => ask(computer)} disabled={busy !== null}>
                        {busy === computer.id ? t("devices.enter.connecting") : t("devices.enter.connect")}
                      </Button>
                    </row>
                  ))}
                </col>
              ) : (
                <T w="full" {...d.nearbyEmpty}>
                  {t("devices.nearby.looking")}
                </T>
              )}
              {waitingOn ? (
                <T w="full" {...d.nearbyEmpty} role="status">
                  {t("devices.nearby.waiting", { name: waitingOn.name })}
                </T>
              ) : null}
            </col>
            ) : null}
            <DialogDescription {...s.selfHostDialogDescription}>{t("devices.enter.intro")}</DialogDescription>
            <Input {...s.selfHostDialogInput} value={text} spellCheck={false} placeholder="K7M-Q2X-49P" label={t("devices.enter.label")} onChange={(event) => setText(event.target.value)} disabled={busy !== null} />
            {error ? (
              <T w="full" {...s.selfHostDialogError} role="alert">
                {error}
              </T>
            ) : null}
            <row {...s.selfHostDialogActions}>
              <Button variant="ghost" className="pill-btn" onClick={waitingOn ? stopWaiting : close} disabled={busy !== null && !waitingOn}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" className="pill-btn" disabled={busy !== null || !text.trim()}>
                {busy === "code" ? t("devices.enter.connecting") : t("devices.enter.connect")}
              </Button>
            </row>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
