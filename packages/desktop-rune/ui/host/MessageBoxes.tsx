// dialog.showMessageBox / showErrorBox from Electron main, drawn in the window they belong to
// (boxes without a window go to the main one). The first pending box shows; answering it resolves
// main's promise with the button index.

import { useState, useSyncExternalStore } from "react";
import { Button, Dialog, DialogDescription, DialogHeader, DialogTitle, Switch } from "../kit";
import type { HostMessageBox } from "../../host/services/ui-host";

const none: HostMessageBox[] = [];
const noSubscribe = () => () => {};

export function useMessageBoxes(): HostMessageBox[] {
  const dialogs = stella.host?.dialogs;
  return useSyncExternalStore(dialogs?.subscribe ?? noSubscribe, dialogs?.pending ?? (() => none));
}

export function MessageBoxes({ windowId, isMain }: { windowId: string; isMain: boolean }) {
  const boxes = useMessageBoxes().filter((b) => b.windowId === windowId || (b.windowId === null && isMain));
  const box = boxes[0];
  if (!box) return null;
  return <MessageBox key={box.id} box={box} />;
}

function MessageBox({ box }: { box: HostMessageBox }) {
  const o = box.options;
  const buttons = o.buttons?.length ? o.buttons : ["OK"];
  const cancelId = o.cancelId ?? Math.max(0, buttons.findIndex((b) => /^(cancel|no|close)$/i.test(b)));
  const defaultId = o.defaultId ?? 0;
  const [checked, setChecked] = useState(o.checkboxChecked ?? false);
  const answer = (response: number) => stella.host?.dialogs.answer(box.id, response, checked);
  return (
    <Dialog id={`message-box-${box.id}`} open fit label={o.title || o.message} onOpenChange={(open) => { if (!open) answer(cancelId); }} closeOnBackdrop={false}>
      <DialogHeader>
        <DialogTitle>{o.title || o.message}</DialogTitle>
      </DialogHeader>
      <col w="full" gap={4} pb={20}>
          {o.title && o.message !== o.title ? <DialogDescription>{o.message}</DialogDescription> : null}
          {o.detail ? <DialogDescription>{o.detail}</DialogDescription> : null}
          {o.checkboxLabel ? (
            <row gap={8} align="center" px={24} pb={12}>
              <Switch id={`message-box-${box.id}-check`} checked={checked} onCheckedChange={setChecked} label={o.checkboxLabel} />
            </row>
          ) : null}
          <row w="full" gap={8} justify="end" px={20}>
            {buttons.map((label, i) => (
              <Button key={i} id={`message-box-${box.id}-b${i}`} variant={i === defaultId ? "primary" : "secondary"} onPress={() => answer(i)}>
                {label}
              </Button>
            ))}
          </row>
      </col>
    </Dialog>
  );
}
