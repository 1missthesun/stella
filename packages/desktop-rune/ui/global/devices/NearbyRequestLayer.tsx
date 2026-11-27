import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, T } from "../../kit/compat";
import { useSelfHost } from "../self-host/self-host.styles";
import { useState, useSyncExternalStore } from "react";
import { useT } from "@/shared/i18n";
import type { P2pConfirmRequest } from "@stella/contracts/p2p";
import { p2p } from "./use-devices";
import { useDevicesStyles } from "./devices.styles";

const noop = () => () => {};
const none = (): P2pConfirmRequest | null => null;

/** On this computer, wherever the person is: a nearby device asking to pair, with the six digits
 *  to type on it. It closes by itself once the device pairs or gives up. */
export function NearbyRequestLayer() {
  const s = useSelfHost();
  const d = useDevicesStyles();
  const t = useT();
  const api = p2p();
  const request = useSyncExternalStore(api ? api.subscribeConfirming : noop, api ? api.confirming : none, none);
  const [denying, setDenying] = useState(false);
  if (!api || !request) return null;
  const { name } = request.device;
  const deny = () => {
    setDenying(true);
    void api
      .denyNearby(request.request)
      .catch(() => undefined)
      .finally(() => setDenying(false));
  };
  return (
    <Dialog open onOpenChange={(open) => (!open ? deny() : undefined)}>
      <DialogContent fit {...s.dialog_selfHostDialog}>
        <DialogHeader {...s.selfHostDialog_dialogHeader}>
          <DialogTitle>{t("devices.nearby.requestTitle", { name })}</DialogTitle>
        </DialogHeader>
        <col {...s.selfHostDialogBody}>
          <DialogDescription {...s.selfHostDialogDescription}>{t("devices.nearby.requestIntro", { name })}</DialogDescription>
          <T w="full" {...d.confirmDigits} label={t("devices.nearby.digitsLabel")}>
            {`${request.code.slice(0, 3)} ${request.code.slice(3)}`}
          </T>
          <row {...s.selfHostDialogActions}>
            <Button variant="ghost" className="pill-btn" onClick={deny} disabled={denying}>
              {t("devices.nearby.deny")}
            </Button>
          </row>
        </col>
      </DialogContent>
    </Dialog>
  );
}
