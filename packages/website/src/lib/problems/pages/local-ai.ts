import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const LOCAL_AI_PAGES: ProblemPage[] = [
  {
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
      "Set up a small AI chat model that runs on your own computer with no internet, using Ollama or LM Studio, or let Stella (stella.sh) install and test one for you.",
    h1: "Run an AI on your own computer, offline",
    short: "Run AI offline on your computer",
    lede: "A 1.6 GB chat model on the computer itself, answering with the internet switched off.",
    answer:
      "Install a free model runner such as Ollama or LM Studio, download a small model (1–2 GB, like Llama 3.2 1B), and chat with it; once downloaded it needs no internet. Small models are fine for everyday questions and drafts but well behind ChatGPT or Claude, and speed depends on your computer. Stella (stella.sh) can pick a model that fits, install it without admin rights, and test it offline.",
    stellaSteps: [
      "Looks at the computer first: graphics card, memory, and whether it has admin rights (here it didn't need them)",
      "Picks a model under the size you set, here Qwen3.5-2B at 1.57 GB, and checks the download against its published checksum",
      "Installs llama.cpp, a free program that runs models, in your home folder, using the graphics card when there is one",
      "Tests it with the network switched off, so you know the answers really come from your computer",
      "Adds an `ai` command, a chat window like ChatGPT's that only your computer can reach, and launchers, then stops everything so nothing runs in the background",
    ],
    prompt: "Set up an AI that runs on my own computer, offline. Use a small model, under 2 GB.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In 8 minutes 15 seconds Stella installed llama.cpp and the 1.57 GB Qwen3.5-2B model, tested it offline, and added a terminal command and a chat window. Checked afterwards by us: with the computer's network cut (only its own loopback left), the same program and model answered “What is the capital of France?” with “Paris”, on the processor alone at about 25 tokens a second. Nothing was left running.",
      note: "This was the second try. The first, with the prompt “Keep it small, this laptop isn't very powerful”, chose a 2.4 GB model after finding a powerful graphics card, which broke our 2 GB limit, so we stated the size in the prompt and ran it again. The test computer is a fast desktop with an RTX 5090, so Stella's “about a second” per answer is on that card. The wait is sped up 40×.",
      video: {
        src: `${PROOFS}/local-ai/run-ai-offline-on-your-computer/proof.mp4`,
        cuts: webCuts("local-ai/run-ai-offline-on-your-computer"),
        poster: `${PROOFS}/local-ai/run-ai-offline-on-your-computer/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 50,
        realDuration: 495,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer with no AI model installed and no admin password available." },
        { at: 3, text: "The prompt: set up an AI that runs on my own computer, offline. Use a small model, under 2 GB." },
        { at: 8, text: "Stella replies that it's setting it up and will say which model it picked." },
        { at: 12, text: "Choosing the model, downloading it and llama.cpp, testing offline, and building the chat window, sped up 40×." },
        { at: 24.3, text: "Done: Qwen3.5-2B, a 1.57 GB download, tested with the internet off. Type `ai` to chat, or open Local AI Chat." },
        { at: 39.8, text: "A screenshot of its own test: the local chat window answering in 1.4 seconds, marked offline." },
      ],
      shots: [
        {
          src: `${PROOFS}/local-ai/run-ai-offline-on-your-computer/web-chat.jpg`,
          alt: "The local chat window Stella set up, showing a 3-day beginner workout plan written by Qwen3.5-2B (offline), 476 tokens in 1.4 seconds.",
          width: 600,
          height: 675,
          caption: "Stella's own test of the chat window it made, on the test computer's graphics card. A laptop without one is much slower.",
        },
      ],
    },
    manualTitle: "Set it up yourself",
    manualSteps: [
      {
        title: "Check what your computer has",
        body: "A 1–2 GB model runs on almost any computer from the last five years with 8 GB of memory. A graphics card (Nvidia, AMD) or an Apple Silicon Mac makes it much faster; on an older laptop's processor alone expect a few words a second. Bigger models (7B and up, 4 GB+) want 16 GB of memory or a good graphics card.",
      },
      {
        title: "Install Ollama",
        body: "Download Ollama from ollama.com for Windows, Mac or Linux and install it. It runs quietly in the background, with a chat window on Windows and Mac and an `ollama` command everywhere. LM Studio is a free alternative with everything in one window: search for a model, download it and chat.",
      },
      {
        title: "Download a small model",
        body: "In a terminal, run `ollama run llama3.2:1b` (about 1.3 GB). The first time it downloads the model, then lets you type questions; type `/bye` to quit. In the Ollama app on Windows or Mac, pick the model from the list and start typing. Check the size on a model's page before downloading; many models come in several sizes.",
      },
      {
        title: "Check it really works offline",
        body: "Turn off Wi-Fi (or unplug the cable) and ask it something. If it answers, it's running on your computer. Nothing you type leaves it, though the app may still check for updates when you're back online.",
      },
      {
        title: "Stop it when you're done",
        body: "A loaded model uses memory. Quit Ollama from the tray or menu bar icon, or eject the model in LM Studio. To remove a model, run `ollama rm llama3.2:1b`.",
      },
    ],
    limits: [
      "This is for the curious. A 2B model is good for quick questions, drafts and summaries, and clearly worse than ChatGPT or Claude at hard reasoning, facts and code; Stella said so too.",
      "Speed depends heavily on your computer. The test machine had a top graphics card; our own offline check on its processor alone ran at about 25 tokens a second, and an ordinary laptop will be slower.",
      "It used llama.cpp rather than Ollama, since it needs no installer or background service. Ask for Ollama by name if you want it.",
      "Recorded on Linux. On Windows or a Mac the steps differ (and a Mac uses its own chip instead of a graphics card); that hasn't been recorded yet.",
      "Stella itself still uses your ChatGPT or Claude plan to do the setting up. Only the model it installs runs offline.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Is a local AI as good as ChatGPT?",
        a: "No. Models small enough for an ordinary computer are far smaller than ChatGPT or Claude, so they make more mistakes and know less. They're useful when you want privacy, no internet, or just to see how it works.",
      },
      {
        q: "Is it private?",
        a: "The model runs on your computer and what you type doesn't leave it. You can prove it the way we did: switch the network off and it still answers.",
      },
      {
        q: "How much space does it need?",
        a: "The model in the recording is 1.57 GB, plus about 100 MB for the program. Larger models are 4–20 GB or more, and you can keep several.",
      },
      {
        q: "Can Stella itself use the local model?",
        a: "Stella can work with local models through a provider set up in its settings, but a 1–2 GB model is too small to do Stella's tasks well. Use it for chatting, and your ChatGPT or Claude plan for getting things done.",
      },
    ],
    related: ["pc-cleanup/organize-downloads-folder", "photos-files/sort-photos-into-folders-by-date"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "Ollama: download", href: "https://ollama.com/download" },
      { label: "Ollama blog: Ollama's new app", href: "https://ollama.com/blog/new-app" },
      { label: "Ollama library: llama3.2", href: "https://ollama.com/library/llama3.2" },
      { label: "LM Studio", href: "https://lmstudio.ai" },
      { label: "llama.cpp", href: "https://github.com/ggml-org/llama.cpp" },
      { label: "Qwen3.5-2B GGUF files", href: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF" },
    ],
  },
];
