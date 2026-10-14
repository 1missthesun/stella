export type AddContextSheetProps = {
  visible: boolean;
  onClose: () => void;
  onDismissed: () => void;
  onCamera?: () => void;
  onPhotos?: () => void;
  onFiles?: () => void;
  readAloud: boolean;
  onReadAloudChange?: (next: boolean) => void;
};
