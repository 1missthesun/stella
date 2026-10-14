import type {
  ButtonHTMLAttributes,
  ForwardRefExoticComponent,
  JSX,
  RefAttributes,
  TextareaHTMLAttributes,
} from "react";

type ComposerButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
type ComposerForwardButton = ForwardRefExoticComponent<
  ComposerButtonProps & RefAttributes<HTMLButtonElement>
>;

export const ComposerAddButton: ComposerForwardButton;
export const ComposerStopButton: ComposerForwardButton;
export const ComposerMicButton: ForwardRefExoticComponent<
  ComposerButtonProps &
    { isTranscribing?: boolean } &
    RefAttributes<HTMLButtonElement>
>;
export const ComposerRealtimeVoiceButton: ForwardRefExoticComponent<
  ComposerButtonProps & { active?: boolean } & RefAttributes<HTMLButtonElement>
>;
type MotionOwnedButtonHandlers =
  | "onDrag"
  | "onDragCapture"
  | "onDragStart"
  | "onDragStartCapture"
  | "onDragEnd"
  | "onDragEndCapture"
  | "onAnimationStart"
  | "onAnimationStartCapture"
  | "onAnimationEnd"
  | "onAnimationEndCapture"
  | "onAnimationIteration"
  | "onAnimationIterationCapture";

export function ComposerSubmitButton(
  props: Omit<ComposerButtonProps, MotionOwnedButtonHandlers> & {
    animated?: boolean;
  },
): JSX.Element;
export const ComposerTextarea: ForwardRefExoticComponent<
  TextareaHTMLAttributes<HTMLTextAreaElement> &
    { tone?: "default" | "orb" } &
    RefAttributes<HTMLTextAreaElement>
>;
