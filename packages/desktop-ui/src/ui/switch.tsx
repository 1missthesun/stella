import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/shared/lib/utils";

interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label?: string;
  hideLabel?: boolean;
  description?: string;
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, label, hideLabel, description, children, id, ...props }, ref) => {
  // The label and description name and describe the control itself, so
  // assistive tech and `getByRole("switch", { name })` find it by its words.
  const generatedId = React.useId();
  const controlId = id ?? `${generatedId}-control`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  return (
    <div data-component="switch" className={cn(className)} data-checked={props.checked || undefined}>
      {(label || children) && (
        <label
          data-slot="switch-label"
          htmlFor={controlId}
          className={hideLabel ? "sr-only" : undefined}
        >
          {label || children}
        </label>
      )}
      {description && (
        <p data-slot="switch-description" id={descriptionId}>
          {description}
        </p>
      )}
      <SwitchPrimitive.Root
        ref={ref}
        id={controlId}
        data-slot="switch-control"
        aria-describedby={descriptionId}
        {...props}
      >
        <SwitchPrimitive.Thumb data-slot="switch-thumb" />
      </SwitchPrimitive.Root>
    </div>
  );
});

Switch.displayName = "Switch";
