import { useEffect, useState } from "react";
import { Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function useKeyboardInset() {
  const bottomInset = useSafeAreaInsets().bottom;
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const onDidShow = (e: { endCoordinates: { height: number } }) => {
      setHeight(e.endCoordinates.height);
    };
    const onDidHide = () => setHeight(0);

    const subs = [
      Keyboard.addListener("keyboardDidShow", onDidShow),
      Keyboard.addListener("keyboardDidHide", onDidHide),
    ];

    return () => {
      for (const sub of subs) sub.remove();
    };
  }, []);

  const open = height > 0;
  const composerBottomPad = 6 + bottomInset;

  return { height, open, composerBottomPad };
}
