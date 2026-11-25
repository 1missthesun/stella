import type { MessageRecord } from "@stella/contracts/local-chat";

export const CHAT_FIXTURE_START = Date.UTC(2026, 10, 20, 15, 0, 0);

export const CHAT_FIXTURE_REPLY = `Here is a quick summary:

- **Apples** are crisp and sweet
- *Bananas* ripen fast
- \`citrus\` keeps well

\`\`\`ts
const fruits = ["apple", "banana", "cherry"];
console.log(fruits.length);
\`\`\`

| Fruit | Colour |
| --- | --- |
| Apple | Red |
| Banana | Yellow |

See [the docs](https://example.com) for more.`;

export const chatFixtureMessage = (index: number, type: "user_message" | "assistant_message", text: string): MessageRecord => ({
  _id: `fixture-${index}`,
  timestamp: CHAT_FIXTURE_START + index * 47 * 60_000,
  type,
  payload: { text },
  toolEvents: [],
});

/** A conversation of `count` alternating turns: long questions, short thanks, rich and short replies. */
export const chatFixtureMessages = (count: number): MessageRecord[] =>
  Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? chatFixtureMessage(
          index,
          "user_message",
          index % 6 === 0 ? `Question ${index / 2 + 1}: can you list a few fruits and show a code sample? Please keep it short, with a table if you can.` : `Thanks! Follow-up ${index / 2 + 1}`,
        )
      : chatFixtureMessage(index, "assistant_message", index % 4 === 1 ? CHAT_FIXTURE_REPLY : `Sure — reply ${index}. Short and to the point.`),
  );

export const CHAT_FIXTURE_CONTENT_STYLE = { maxWidth: "min(50rem, 100%)", marginLeft: "auto", marginRight: "auto", paddingLeft: 24, paddingRight: 24, paddingTop: 112, paddingBottom: 28 };
