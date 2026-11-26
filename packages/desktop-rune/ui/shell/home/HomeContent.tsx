import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { font, look, useTokens } from "../../theme";
import { reportHomeGreetingTop } from "../../replace/shell/workspace-stage/viewer-geometry";

const FUN_GREETINGS = [
  "Welcome back!",
  "Hey there!",
  "Glad you're here",
  "Ready when you are",
  "Let's make today great",
  "What's on your mind?",
  "Where should we start?",
  "Let's dive in",
  "Good to see you",
  "Hey, I'm all ears",
  "Let's create something",
  "Ready to roll?",
  "What are we tackling?",
  "Hello, friend",
  "Howdy!",
  "Welcome aboard",
  "Let's go!",
  "What's up?",
  "Let's make magic",
  "Pick a quest",
  "Adventure awaits",
  "Let's build something cool",
  "Good to have you back",
  "Let's do this",
  "Onward!",
  "What can we explore today?",
  "Hello, hello",
  "Greetings, traveler",
  "Let's chase some ideas",
  "Where to next?",
  "Hey, friend",
  "Ready to make a dent?",
  "Let's cook something up",
  "What's the mission?",
  "Hi! What's first?",
  "Let's get curious",
  "Bring me your best ideas",
  "Tell me everything",
  "What's the plan?",
  "Let's make something",
];
const FUN_GREETING_CHANCE = 0.25;

type GreetingState = { kind: "fun"; text: string } | { kind: "time" };

function timeBasedGreeting(date: Date) {
  const hour = date.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function initialGreeting(): GreetingState {
  if (Math.random() < FUN_GREETING_CHANCE) {
    return { kind: "fun", text: FUN_GREETINGS[Math.floor(Math.random() * FUN_GREETINGS.length)]! };
  }
  return { kind: "time" };
}

const subscribeResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};
const isNarrow = () => window.innerWidth <= 640;

function useGreeting() {
  const [state] = useState(initialGreeting);
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.kind !== "time") return;
    const interval = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(interval);
  }, [state.kind]);
  return state.kind === "fun" ? state.text : timeBasedGreeting(new Date());
}

/** desktop-ui's `HomeContent`: the greeting over the centred composer (`children`), max 780 wide. */
export function HomeContent({ children, leaving = false }: { children?: ReactNode; leaving?: boolean }) {
  const t = useTokens();
  const greeting = useGreeting();
  const narrow = useSyncExternalStore(subscribeResize, isNarrow);
  const title = look(narrow ? 29 : 36, 600, { lh: 1.2, em: -0.03, family: font.display });
  useEffect(() => () => reportHomeGreetingTop(null), []);
  return (
    <col id="home-content" grow={1} w="100%" maxW={780} px={24} py={48} align="center" justify="center" selfAlign="center">
      <text
        id="home-stella-title"
        {...title}
        color={t.c.textStrong}
        textAlign="center"
        mb={20}
        enter={{ opacity: 0, y: 6, dur: 0.3 }}
        opacity={leaving ? 0 : 1}
        y={leaving ? 8 : 0}
        motion={{ dur: 0.28 }}
        onLayout={(r) => reportHomeGreetingTop(r.y)}
      >
        {greeting}
      </text>
      {children}
    </col>
  );
}
