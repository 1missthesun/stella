import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  type FrameInfo,
  type SharedValue,
} from "react-native-reanimated";
import Svg, {
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
  type GProps,
} from "react-native-svg";
import {
  STELLA_MARK_CENTER,
  STELLA_MARK_VIEWBOX,
  STELLA_MARK_VIEWBOX_SPAN,
  STELLA_ORB_PATH,
} from "./geometry";
import { stellaMarkLayout } from "./layout";
import { MarkLayer } from "./MarkLayer";
import { DOT_SPREAD_UNITS } from "./motion";
import {
  createRig,
  rigMaxZoom,
  rigSmallness,
  stepRig,
  type RigDots,
  type RigInput,
  type RigState,
} from "./rig";
import { clamp, easeOutBackRaw, easeOutCubicRaw } from "./rig-math";
import { useAppVisible } from "../../lib/use-app-visible";
import type { WorkingIndicatorCharacterState } from "../working-indicator-character";

const DEFAULT_SIZE = 34;
const C = STELLA_MARK_CENTER;
const INK_FROM = C * 1.86;
const INK_TO = C * 0.14;
const SPARK_CANVAS = 1.6;
const SPARK_FILL = "#be57a4";
const DOT_STAGGER = 0.12;
const REDUCED_SETTLE_MS = 120;
const INK_STOPS: [string, number][] = [
  ["#00aad8", 0],
  ["#3493d9", 0.25],
  ["#4878db", 0.5],
  ["#7449c5", 0.75],
  ["#be57a4", 1],
];

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

type SparkFrame = { d: string[]; o: number[] };

function SparkPath({
  index,
  sparks,
}: {
  index: number;
  sparks: SharedValue<SparkFrame>;
}) {
  const props = useAnimatedProps(() => ({
    d: sparks.value.d[index],
    opacity: sparks.value.o[index],
  }));
  return <AnimatedPath animatedProps={props} fill={SPARK_FILL} />;
}

function useSideDotStyle(
  dots: SharedValue<RigDots>,
  order: number,
  slot: number,
  sign: number,
  pxPerUnit: number,
  sideDotPx: number,
  zoomMax: number,
) {
  return useAnimatedStyle(() => {
    const f = dots.value;
    const k = clamp(
      (f.w - order * DOT_STAGGER) / (1 - order * DOT_STAGGER),
      0,
      1,
    );
    const o = slot * 4;
    const sx = f.hop[o + 1];
    const sy = f.hop[o + 2];
    if (k <= 0.004) {
      return {
        opacity: 0,
        transform: [
          { translateX: 0 },
          { translateY: 0 },
          { scale: 0 },
          { scaleX: 1 },
          { scaleY: 1 },
        ],
      };
    }
    const app = easeOutCubicRaw(k);
    const spread = easeOutBackRaw(k);
    const scale = (app * f.z) / zoomMax;
    return {
      opacity: app * f.hop[o + 3],
      transform: [
        { translateX: sign * DOT_SPREAD_UNITS * pxPerUnit * f.z * spread },
        {
          translateY:
            -f.hop[o] * sideDotPx + (sideDotPx * scale * (1 - sy)) / 2,
        },
        { scale },
        { scaleX: sx },
        { scaleY: sy },
      ],
    };
  });
}

export function StellaMarkIndicator({
  active,
  size = DEFAULT_SIZE,
  state = "thinking",
  faceColor,
}: {
  active: boolean;
  size?: number;
  state?: WorkingIndicatorCharacterState;
  faceColor?: string;
}) {
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();
  const running = active && appVisible;
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");

  const layout = useMemo(() => stellaMarkLayout(size), [size]);
  const { dotPx, sideDotPx, pxPerUnit } = layout;
  const zoomMax = rigMaxZoom(size);
  const smallness = rigSmallness(size);

  const input: RigInput = useMemo(
    () => ({ state, paused: !running, reduced: reduceMotion, smallness }),
    [state, running, reduceMotion, smallness],
  );

  const [initial] = useState(() => {
    const rig = createRig(input.state);
    stepRig(rig, 0, input);
    return rig.out;
  });

  const inputSV = useSharedValue<RigInput>(input);
  const rigSV = useSharedValue<RigState | null>(null);
  const bodyD = useSharedValue(initial.bodyD);
  const bodyM = useSharedValue(initial.matrix);
  const eyeL = useSharedValue(initial.eyeL);
  const eyeR = useSharedValue(initial.eyeR);
  const sparks = useSharedValue<SparkFrame>({
    d: initial.sparkD,
    o: initial.sparkO,
  });
  const dots = useSharedValue<RigDots>(initial.dots);

  useEffect(() => {
    inputSV.value = input;
  }, [input, inputSV]);

  const onFrame = useCallback(
    (info: FrameInfo) => {
      "worklet";
      const current = inputSV.value;
      let rig = rigSV.value;
      if (rig === null) {
        rig = createRig(current.state);
        rigSV.value = rig;
      }
      stepRig(rig, info.timeSincePreviousFrame ?? 0, current);
      const out = rig.out;
      if (out.bodyDirty) {
        bodyD.value = out.bodyD;
        out.bodyDirty = false;
      }
      if (out.matrixDirty) {
        bodyM.value = out.matrix;
        out.matrixDirty = false;
      }
      if (out.eyesDirty) {
        eyeL.value = out.eyeL;
        eyeR.value = out.eyeR;
        out.eyesDirty = false;
      }
      if (out.sparksDirty) {
        sparks.value = { d: out.sparkD, o: out.sparkO };
        out.sparksDirty = false;
      }
      if (out.dotsDirty) {
        dots.value = out.dots;
        out.dotsDirty = false;
      }
    },
    [bodyD, bodyM, dots, eyeL, eyeR, inputSV, rigSV, sparks],
  );
  const frame = useFrameCallback(onFrame, false);

  useEffect(() => {
    if (!running) {
      frame.setActive(false);
      return;
    }
    frame.setActive(true);
    if (!reduceMotion || state === "thinking") return;
    const timer = setTimeout(() => frame.setActive(false), REDUCED_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [frame, reduceMotion, running, state]);

  const bodyProps = useAnimatedProps(() => ({ d: bodyD.value }));
  const coreProps = useAnimatedProps(() => ({ d: bodyD.value }));
  const clipProps = useAnimatedProps(() => ({ d: bodyD.value }));
  const matrixProps = useAnimatedProps(
    () => ({ matrix: bodyM.value }) as unknown as Partial<GProps>,
  );
  const eyeLProps = useAnimatedProps(() => ({ d: eyeL.value }));
  const eyeRProps = useAnimatedProps(() => ({ d: eyeR.value }));

  const bodyStyle = useAnimatedStyle(() => {
    const f = dots.value;
    const sy = f.hop[6];
    const half = (size * f.bodyScale) / 2;
    return {
      opacity: f.hop[7],
      transform: [
        { translateY: -f.hop[4] * dotPx + half * (1 - sy) },
        { scaleX: f.hop[5] },
        { scaleY: sy },
      ],
    };
  });
  const leftStyle = useSideDotStyle(
    dots,
    0,
    0,
    -1,
    pxPerUnit,
    sideDotPx,
    zoomMax,
  );
  const rightStyle = useSideDotStyle(
    dots,
    1,
    2,
    1,
    pxPerUnit,
    sideDotPx,
    zoomMax,
  );

  const viewport = useMemo(
    () => [styles.viewport, { width: size, height: size }],
    [size],
  );
  const sideDotBox = useMemo(
    () => ({
      height: sideDotPx,
      left: (size - sideDotPx) / 2,
      position: "absolute" as const,
      top: (size - sideDotPx) / 2,
      width: sideDotPx,
    }),
    [sideDotPx, size],
  );
  const sparkCanvas = useMemo(() => {
    const px = size * SPARK_CANVAS;
    const span = STELLA_MARK_VIEWBOX_SPAN * SPARK_CANVAS;
    const min = C - span / 2;
    return {
      px,
      viewBox: `${min} ${min} ${span} ${span}`,
      style: {
        height: px,
        left: (size - px) / 2,
        position: "absolute" as const,
        top: (size - px) / 2,
        width: px,
      },
    };
  }, [size]);

  const inkId = `${uid}-ink`;
  const coreId = `${uid}-core`;
  const clipId = `${uid}-clip`;

  return (
    <View style={viewport} pointerEvents="none">
      <Animated.View style={[sideDotBox, leftStyle]}>
        <MarkLayer
          d={STELLA_ORB_PATH}
          size={sideDotPx}
          gradientId={`${uid}-left`}
          inkFrom={INK_FROM}
          inkTo={INK_TO}
        />
      </Animated.View>
      <Animated.View style={[sideDotBox, rightStyle]}>
        <MarkLayer
          d={STELLA_ORB_PATH}
          size={sideDotPx}
          gradientId={`${uid}-right`}
          inkFrom={INK_FROM}
          inkTo={INK_TO}
        />
      </Animated.View>
      <Svg
        pointerEvents="none"
        width={sparkCanvas.px}
        height={sparkCanvas.px}
        viewBox={sparkCanvas.viewBox}
        style={sparkCanvas.style}
      >
        {[0, 1, 2, 3, 4].map((index) => (
          <SparkPath key={index} index={index} sparks={sparks} />
        ))}
      </Svg>
      <Animated.View style={[styles.layer, bodyStyle]}>
        <Svg
          pointerEvents="none"
          width={size}
          height={size}
          viewBox={STELLA_MARK_VIEWBOX}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <LinearGradient
              id={inkId}
              x1={C}
              y1={INK_FROM}
              x2={C}
              y2={INK_TO}
              gradientUnits="userSpaceOnUse"
            >
              {INK_STOPS.map(([color, offset]) => (
                <Stop key={offset} offset={offset} stopColor={color} />
              ))}
            </LinearGradient>
            <RadialGradient
              id={coreId}
              cx={C}
              cy={C}
              fx={C}
              fy={C}
              r={C * 0.92}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset={0} stopColor="#ffffff" stopOpacity={0.26} />
              <Stop offset={0.32} stopColor="#ffffff" stopOpacity={0.09} />
              <Stop offset={1} stopColor="#ffffff" stopOpacity={0} />
            </RadialGradient>
            <ClipPath id={clipId}>
              <AnimatedPath animatedProps={clipProps} />
            </ClipPath>
          </Defs>
          <AnimatedG animatedProps={matrixProps}>
            <AnimatedPath animatedProps={bodyProps} fill={`url(#${inkId})`} />
            <AnimatedPath animatedProps={coreProps} fill={`url(#${coreId})`} />
            {faceColor ? (
              <G clipPath={`url(#${clipId})`}>
                <AnimatedPath animatedProps={eyeLProps} fill={faceColor} />
                <AnimatedPath animatedProps={eyeRProps} fill={faceColor} />
              </G>
            ) : null}
          </AnimatedG>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill },
  viewport: { alignItems: "center", justifyContent: "center" },
});
