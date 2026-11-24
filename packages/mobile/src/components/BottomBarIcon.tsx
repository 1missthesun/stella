import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { BottomBarIconProps } from "./BottomBarIcon.types";

const STROKE = 1.6;

export function BottomBarIcon({ tab, selected, color, size }: BottomBarIconProps) {
  const fill = selected ? color : "none";
  const outline = {
    stroke: color,
    strokeWidth: STROKE,
    strokeLinejoin: "round",
    strokeLinecap: "round",
  } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {tab === "chat" ? (
        <Path
          d="M6 4h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6.2l-4.1 3.6a.7.7 0 0 1-1.2-.5V17H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"
          fill={fill}
          {...outline}
        />
      ) : null}
      {tab === "schedule" ? (
        <>
          <Rect x={3} y={4} width={18} height={16.5} rx={3} {...outline} />
          <Path d="M3 9V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2Z" fill={color} />
          {[12.3, 16.3].flatMap((cy) =>
            [7.5, 12, 16.5].map((cx) => (
              <Circle
                key={`${cx}:${cy}`}
                cx={cx}
                cy={cy}
                r={selected ? 1.35 : 1.05}
                fill={color}
              />
            )),
          )}
        </>
      ) : null}
      {tab === "apps"
        ? [3.5, 13.5].flatMap((y) =>
            [3.5, 13.5].map((x) => (
              <Rect
                key={`${x}:${y}`}
                x={x}
                y={y}
                width={7}
                height={7}
                rx={1.6}
                fill={fill}
                {...outline}
              />
            )),
          )
        : null}
      {tab === "files" ? (
        <>
          <Path
            d="M3 7a2.5 2.5 0 0 1 2.5-2.5h3.6c.6 0 1.1.2 1.5.6l1.1 1.1c.3.3.7.4 1.1.4h5.7A2.5 2.5 0 0 1 21 9.1v8.4a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"
            fill={fill}
            {...outline}
          />
          {selected ? null : <Path d="M3 10.2h18" {...outline} />}
        </>
      ) : null}
    </Svg>
  );
}
