---
name: stella-llm
description: Call language models from Stella's own code through the user's configured model route and Stella sign-in, with no provider API keys. Use when a change to Stella (a feature, panel or runtime helper) needs an LLM call.
---

# Stella LLM calls

Stella's runtime host runs one-shot completions on whatever model route the user has set up (Stella's managed models, their API keys, ChatGPT or Claude Code), with Stella's own auth and billing:

```ts
const { text } = await runner.runOneShotCompletion({
  agentType: "general",        // whose model settings to use
  systemPrompt: "Return only the title text.",
  userText: "Name this note in five words: …",
  model: "stella/light",       // optional; omit for the user's default
  maxOutputTokens: 200,        // optional, like temperature and reasoningEffort
});
```

The request type is `RuntimeOneShotCompletionRequest` in `packages/contracts/protocol`; Electron main reaches it through the runtime host adapter, as `modelResolve` in `packages/desktop/electron/bootstrap/ipc.js` does. A renderer feature asks main for it over IPC: the renderer has no model access of its own.

- Prefer Stella aliases (`stella/default`, `stella/light`, `stella/builder`) over provider ids, and pass `model` only when the task needs a different one.
- Send only what the task needs: no secrets, private files or unrelated context.
- Never ask the user for a provider key for this; a failure from the route (signed out, quota, provider unavailable) is surfaced to them as it comes.

Outside Stella's code there is no LLM route: agent shells deliberately don't carry Stella's tokens, and cloud apps get no Stella credentials. An agent needing model output for its own work writes it itself or hands it to a helper agent.
