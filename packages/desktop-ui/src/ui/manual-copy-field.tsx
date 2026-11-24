import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";

export const ManualCopyField = ({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [value]);
  return (
    <input
      ref={ref}
      className={cn("manual-copy-field", className)}
      readOnly
      value={value}
      aria-label={label}
      title={label}
      spellCheck={false}
      data-view-state="off"
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
};
