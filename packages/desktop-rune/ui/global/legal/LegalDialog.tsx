import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogTitle, T, tx, VisuallyHidden } from "../../kit/compat";
import { useLegalDialog } from "./legal-dialog.styles";
import {
  TERMS_OF_SERVICE,
  PRIVACY_POLICY,
  type LegalDocument,
} from "@/global/legal/legal-text";
import { useT } from "@/shared/i18n";

const CONTENT: Record<LegalDocument, string> = {
  terms: TERMS_OF_SERVICE,
  privacy: PRIVACY_POLICY,
};

const TITLE_KEYS: Record<LegalDocument, string> = {
  terms: "global.legal.terms.title",
  privacy: "global.legal.privacy.title",
};

const SUBTITLE_KEYS: Record<LegalDocument, string> = {
  terms: "global.legal.terms.subtitle",
  privacy: "global.legal.privacy.subtitle",
};

type LegalDialogProps = {
  document: LegalDocument | null;
  onOpenChange: (open: boolean) => void;
};

export const LegalDialog = ({ document, onOpenChange }: LegalDialogProps) => {
  const s = useLegalDialog();
  const t = useT();
  const title = document ? t(TITLE_KEYS[document]) : "";
  const subtitle = document ? t(SUBTITLE_KEYS[document]) : "";
  return (
    <Dialog open={document !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg" {...s.legalDialogContent}>
        <VisuallyHidden asChild>
          <DialogTitle>{title}</DialogTitle>
        </VisuallyHidden>
        <VisuallyHidden asChild>
          <DialogDescription>{subtitle}</DialogDescription>
        </VisuallyHidden>
        <DialogCloseButton {...s.legalDialogClose} />
        <DialogBody {...s.legalDialogBody}>
          <col {...s.legalDialogHeader}>
            <T {...tx(s.legalDialogHeader)} w="full" {...s.legalDialogTitle}>{title}</T>
            {subtitle ? <T {...tx(s.legalDialogHeader)} w="full" {...s.legalDialogSub}>{subtitle}</T> : null}
          </col>
          <col w="full" {...s.legalDialogScroll} scrollFade={{ top: { size: 18, linear: true }, bottom: { size: 18, linear: true } }}>
            <T {...s.legalDialogText}>
              {document ? CONTENT[document] : ""}
            </T>
          </col>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
