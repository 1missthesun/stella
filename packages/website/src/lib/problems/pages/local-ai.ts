import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const LOCAL_AI_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "run-ai-offline-on-your-computer",
    niche: "local-ai",
    searchPhrases: [
      "run ai offline on your computer",
      "run ai locally",
      "how to run an llm locally",
      "offline ai chatbot for pc",
      "install ollama",
    ],
    title: "Run an AI on your own computer, offline (small model)",
    description:
      "Want an AI that works offline and keeps what you type private? Ask Stella (stella.sh) to set one up on your own computer, sized to fit it.",
    h1: "Run an AI on your own computer, offline",
    short: "Run AI offline on your computer",
    lede: "A private AI chat that lives on your computer and needs no internet.",
    answer:
      "To run AI offline, install a free AI app and download a small model once; after that it answers with the internet off. Stella (stella.sh) picks one that fits your computer and sets it up.",
    gets: [
      "An AI chat that works with no internet",
      "A model sized for your computer",
      "What you type stays on your machine",
    ],
    prompt:
      "Set up an AI that runs on my own computer and works without internet. Keep it small, under 2 GB.",
    demo: {
      ack: "On it. Checking what your computer can run.",
      task: "Setting up an offline AI",
      rows: ["Looking at memory and graphics card", "Downloading a 1.57 GB model", "Asking it a question with Wi-Fi off"],
      reply:
        "Done. A small AI called Qwen3.5-2B now runs on your computer and answers with the internet off. Open it from your apps.",
    },
    faq: [
      ["How do I use AI offline on my PC?", "Install a free AI app such as Ollama or LM Studio and download a small model once. Then it works with Wi-Fi off."],
      ["Is a local AI as good as ChatGPT?", "Small ones handle quick questions, drafts and summaries well. ChatGPT and Claude are stronger at hard reasoning."],
    ],
    byHand: [
      "Install [Ollama](https://ollama.com) for Windows, Mac or Linux, or [LM Studio](https://lmstudio.ai) for everything in one window.",
      "Pick a small model such as Llama 3.2 1B (about 1.3 GB) and start typing.",
      "Turn off Wi-Fi and ask it something. If it answers, it's running on your computer.",
      "A small model takes 1 to 2 GB. Bigger, smarter ones need 4 to 20 GB and 16 GB of memory.",
    ],
    related: ["pc-cleanup/organize-downloads-folder", "photos-files/sort-photos-into-folders-by-date"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
