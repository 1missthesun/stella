import { StellaMark, type StellaMarkProps } from "@/ui/stella-mark";

export function InlineStellaMark({
  size = 16,
  style,
  ...props
}: StellaMarkProps) {
  return (
    <StellaMark
      size={size}
      style={{
        display: "inline-block",
        flex: "0 0 auto",
        verticalAlign: "middle",
        ...style,
      }}
      {...props}
    />
  );
}
