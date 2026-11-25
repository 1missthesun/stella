import { Stack } from "expo-router";
import { useWideLayout } from "../../../../src/lib/bottom-bar";

export const unstable_settings = { anchor: "apps" };

export default function AppsTabLayout() {
  const wide = useWideLayout();
  return (
    <Stack screenOptions={STACK_OPTIONS}>
      <Stack.Screen name="apps" options={ROOT_OPTIONS} />
      <Stack.Screen
        name="email"
        options={wide ? ROOT_OPTIONS : PUSHED_OPTIONS}
      />
    </Stack>
  );
}

const STACK_OPTIONS = {
  headerShown: false,
  contentStyle: { backgroundColor: "transparent" },
  gestureEnabled: false,
} as const;

const ROOT_OPTIONS = { animation: "none" } as const;
const PUSHED_OPTIONS = { animation: "slide_from_right" } as const;
