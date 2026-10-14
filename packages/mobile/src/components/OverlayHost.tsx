import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { StyleSheet, View } from "react-native";

type Layer = { id: string; node: ReactNode };

let layers: Layer[] = [];
let hosts = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const setLayer = (id: string, node: ReactNode) => {
  const index = layers.findIndex((layer) => layer.id === id);
  layers =
    index === -1
      ? [...layers, { id, node }]
      : layers.map((layer) => (layer.id === id ? { id, node } : layer));
  emit();
};

const removeLayer = (id: string) => {
  if (!layers.some((layer) => layer.id === id)) return;
  layers = layers.filter((layer) => layer.id !== id);
  emit();
};

const hostCount = () => hosts;

export function OverlayHost() {
  const current = useSyncExternalStore(subscribe, () => layers);
  useEffect(() => {
    hosts += 1;
    emit();
    return () => {
      hosts -= 1;
      emit();
    };
  }, []);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {current.map((layer) => (
        <Fragment key={layer.id}>{layer.node}</Fragment>
      ))}
    </View>
  );
}

export function OverlayPortal({ children }: { children: ReactNode }) {
  const id = useId();
  const hosted = useSyncExternalStore(subscribe, hostCount) > 0;
  useLayoutEffect(() => {
    if (hosted) setLayer(id, children);
    else removeLayer(id);
  });
  useLayoutEffect(() => () => removeLayer(id), [id]);
  return hosted ? null : <>{children}</>;
}
