/// <reference path="../../js/natives.d.ts" />
// "Use your computer's Stella": pairs the phone to a computer straight over the device link (no
// account), by scanning the QR code that computer shows (Settings › Account › Connect a device),
// opening its `stella://p2p?c=…` link, or typing its code. The phone's sign-in layout (the
// SignInScreen stand-in): the headline at the top, the ways in at the bottom within thumb reach.
// Computers already paired are listed to open again.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { P2pComputer } from "@stella/contracts/p2p";
import { useT } from "@/shared/i18n";
import { I18nProviderBase } from "@/shared/i18n/I18nProvider";
import { Button, Form, TextField } from "../../../desktop-rune/ui/kit/compat";
import { Icon, Icons } from "../../../desktop-rune/ui/kit";
import { useDevices } from "../../../desktop-rune/ui/global/devices/use-devices";
import { alpha, font, look, sheet, ThemeProvider, useTokens } from "../../../desktop-rune/ui/theme";
import { onEngineEvent } from "../../../desktop-rune/host/bridge";
import { PhoneRequestError } from "../native/app";
import { scanQrCode } from "../native/scanner";
import { usePhoneInsets } from "../phone/insets";
import { isPairingLink, phoneP2p } from "../../js/p2p";
import { computerMode } from "./computer-mode";

const SIDE = 28;
const CONTROL_H = 54;
const CONTROL_RADIUS = 14;
const BUTTON = 44;

const SCAN_ICON =
  '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2M7.5 12h9"/></g>';

type Sheet = { open: boolean; code: string | null };
let state: Sheet = { open: false, code: null };
const listeners = new Set<() => void>();
const set = (next: Sheet) => {
  state = next;
  for (const listener of listeners) listener();
};

/** Opens the sheet; with a code (a scanned or opened link) it connects at once. */
export const connectComputer = {
  open: (code: string | null = null) => set({ open: true, code }),
  close: () => set({ open: false, code: null }),
  isOpen: () => state.open,
};

const useSheet = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );

/** A computer's pairing link opened the app (its QR code read by the system camera, or a tap). */
export function listenForPairingLinks() {
  onEngineEvent("open-url", ({ url }) => {
    if (isPairingLink(url)) connectComputer.open(url);
  });
}

const useLook = sheet((c, t) => ({
  scan: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS, fill: t.dark ? "#ffffff" : "#000000", align: "center", justify: "center", gap: 10 },
  divider: { w: "full", align: "center", gap: 10, py: 2 },
  dividerLine: { grow: 1, h: 1, fill: c.border },
  form: { gap: 12, w: "full" },
  input: { size: 17, h: CONTROL_H, radius: CONTROL_RADIUS, px: 18 },
  inputWrapper: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS },
  button: { w: "full", h: CONTROL_H, radius: CONTROL_RADIUS, justify: "center", size: 17, weight: 600 },
  row: { w: "full", h: 60, align: "center", gap: 14, px: 16, radius: CONTROL_RADIUS, border: c.border },
}));

function ComputerRow({ computer, onOpen }: { computer: P2pComputer; onOpen: (c: P2pComputer) => void }) {
  const t = useT();
  const tokens = useTokens();
  const s = useLook();
  const state = computer.link.state;
  const status =
    state === "online"
      ? t("devices.status.online")
      : state === "offline"
        ? t("devices.status.offline")
        : state === "revoked" || state === "not_paired"
          ? t("devices.status.unpaired")
          : t("devices.status.connecting");
  const gone = state === "revoked" || state === "not_paired";
  return (
    <box
      id={`phone-p2p-computer-${computer.id.slice(0, 8)}`}
      role="button"
      label={t("devices.computerChat", { name: computer.name })}
      {...s.row}
      opacity={gone ? 0.5 : 1}
      pressFill={alpha(tokens.c.foreground, 0.06)}
      onPress={gone ? undefined : () => onOpen(computer)}
    >
      <Icon icon={Icons.stella.Monitor} size={20} color={tokens.c.foreground} />
      <col grow={1} shrink minW={0} gap={2}>
        <text {...look(16, 600)} color={tokens.c.textStrong} maxLines={1} truncate>
          {t("devices.computerChat", { name: computer.name })}
        </text>
        <text {...look(13, 400)} color={tokens.c.mutedForeground} maxLines={1}>
          {status}
        </text>
      </col>
      <Icon icon={Icons.stella.ChevronRight} size={18} color={tokens.c.mutedForeground} />
    </box>
  );
}

function ConnectComputerSheet({ initialCode }: { initialCode: string | null }) {
  const t = useT();
  const tokens = useTokens();
  const s = useLook();
  const insets = usePhoneInsets();
  const { computers } = useDevices();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (computer: P2pComputer, conversationId: string | null = null) => {
    await computerMode.enter(computer, conversationId);
    connectComputer.close();
  }, []);

  const pair = useCallback(
    async (code: string) => {
      if (!code.trim() || busy) return;
      setBusy(true);
      setError(null);
      try {
        const { computer, conversationId } = await phoneP2p.pair(code);
        await open(computer, conversationId);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    },
    [busy, open],
  );

  // A scanned or opened link connects straight away.
  useEffect(() => {
    if (initialCode) void pair(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  const scan = async () => {
    setError(null);
    try {
      const code = await scanQrCode(t("mobile.selfHost.cameraHint"));
      if (code) await pair(code);
    } catch (failure) {
      const code = failure instanceof PhoneRequestError ? failure.code : null;
      setError(code === "denied" ? t("mobile.p2p.cameraDenied") : code === "unavailable" ? t("mobile.p2p.noCamera") : failure instanceof Error ? failure.message : String(failure));
    }
  };

  const ink = tokens.dark ? "#000000" : "#ffffff";
  const bottom = Math.max(insets.bottom, insets.keyboard) + 16;
  return (
    <col id="phone-p2p-connect" role="dialog" fixed inset={0} raise={200} fill={tokens.c.background} pt={insets.top} pb={bottom} px={SIDE}>
      <row w="full" h={52} align="center" ml={-10}>
        <box id="phone-p2p-back" role="button" label={t("mobile.selfHost.back")} w={BUTTON} h={BUTTON} radius={BUTTON / 2} center pressFill={alpha(tokens.c.foreground, 0.08)} onPress={busy ? undefined : connectComputer.close}>
          <Icon icon={Icons.stella.ChevronLeft} size={22} color={tokens.c.foreground} />
        </box>
      </row>
      <col w="full" grow={1} shrink minH={0} gap={14} pt={12} scrollY>
        <text role="heading" {...look(32, 600, { lh: 38 / 32, em: -1.6 / 32, family: font.display })} color={tokens.c.textStrong}>
          {t("mobile.p2p.entry")}
        </text>
        <text {...look(17, 400, { lh: 24 / 17, em: -0.3 / 17 })} color={tokens.c.mutedForeground}>
          {t("mobile.p2p.intro")}
        </text>
        {computers.length ? (
          <col w="full" gap={10} pt={10}>
            {computers.map((computer) => (
              <ComputerRow key={computer.id} computer={computer} onOpen={(c) => void open(c)} />
            ))}
          </col>
        ) : null}
      </col>
      <col w="full" gap={12}>
        <box id="phone-p2p-scan" role="button" label={t("mobile.p2p.scan")} {...s.scan} opacity={busy ? 0.6 : 1} pressFill={tokens.dark ? "#e6e6e6" : "#222222"} onPress={busy ? undefined : () => void scan()}>
          <icon svg={SCAN_ICON} name="p2p/scan" view={24} size={20} color={ink} inert />
          <text {...look(17, 600, { em: -0.3 / 17 })} color={ink}>
            {t("mobile.p2p.scan")}
          </text>
        </box>
        <row {...s.divider}>
          <box {...s.dividerLine} />
          <text {...look(11, 400, { em: 0 })} mono textCase="upper" color={tokens.c.mutedForeground}>
            {t("mobile.p2p.orType")}
          </text>
          <box {...s.dividerLine} />
        </row>
        <Form
          w="full"
          {...s.form}
          onSubmit={(event) => {
            event.preventDefault();
            void pair(text);
          }}
        >
          <TextField
            id="phone-p2p-pairing"
            label={t("devices.enter.label")}
            hideLabel
            placeholder="K7M-49PX"
            value={text}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
            wrapperStyle={s.inputWrapper}
            inputStyle={s.input}
          />
          <Button {...s.button} type="submit" variant="primary" size="large" disabled={busy || !text.trim()}>
            {busy ? t("devices.enter.connecting") : t("devices.enter.connect")}
          </Button>
        </Form>
        {error ? (
          <text id="phone-p2p-error" role="alert" w="full" textAlign="center" {...look(15, 400, { lh: 21 / 15 })} color={tokens.c.destructive}>
            {error}
          </text>
        ) : null}
      </col>
    </col>
  );
}

/**
 * Over the whole app while open (signed out or in), so a link or the entry can open it anywhere.
 * It sits beside the app's window content, outside its providers, so it brings the language and
 * theme along.
 */
export function ConnectComputerLayer() {
  const { open, code } = useSheet();
  return open ? (
    <I18nProviderBase>
      <ThemeProvider>
        <ConnectComputerSheet initialCode={code} />
      </ThemeProvider>
    </I18nProviderBase>
  ) : null;
}

/** The sign-in screen's way in without an account. */
export function UseComputerEntry() {
  const t = useT();
  const tokens = useTokens();
  return (
    <row id="phone-p2p-entry" role="button" label={t("mobile.p2p.entry")} w="full" h={44} center gap={8} radius={CONTROL_RADIUS} pressFill={alpha(tokens.c.foreground, 0.06)} onPress={() => connectComputer.open()}>
      <Icon icon={Icons.stella.Monitor} size={18} color={tokens.c.foreground} />
      <text {...look(16, 600, { em: -0.2 / 16 })} color={tokens.c.foreground}>
        {t("mobile.p2p.entry")}
      </text>
    </row>
  );
}
