import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Form, Input, T } from "../../kit/compat";
import { useSelfHost } from "../self-host/self-host.styles";
import { useState } from "react";
import { useT } from "@/shared/i18n";
import { p2p } from "./use-devices";

/** Pairs this device to another computer's Stella with the code that computer shows. */
export function EnterCodeDialog({ initialCode, onClose, onPaired }: { initialCode?: string; onClose: () => void; onPaired: (conversationId: string | null) => void }) {
  const s = useSelfHost();
  const t = useT();
  const [text, setText] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = async () => {
    const api = p2p();
    if (!api || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { conversationId } = await api.pair(text);
      onPaired(conversationId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent fit {...s.dialog_selfHostDialog}>
        <DialogHeader {...s.selfHostDialog_dialogHeader}>
          <DialogTitle>{t("devices.enter.title")}</DialogTitle>
        </DialogHeader>
        <Form {...s.selfHostDialogBody} onSubmit={(event) => {
            event.preventDefault();
            void pair();
          }}>
          <DialogDescription {...s.selfHostDialogDescription}>{t("devices.enter.intro")}</DialogDescription>
          <Input {...s.selfHostDialogInput} value={text} spellCheck={false} autoFocus placeholder="stella-p2p1.…" label={t("devices.enter.label")} onChange={(event) => setText(event.target.value)} disabled={busy} />
          {error ? (
            <T w="full" {...s.selfHostDialogError} role="alert">
              {error}
            </T>
          ) : null}
          <row {...s.selfHostDialogActions}>
            <Button variant="ghost" className="pill-btn" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" className="pill-btn" disabled={busy || !text.trim()}>
              {busy ? t("devices.enter.connecting") : t("devices.enter.connect")}
            </Button>
          </row>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
