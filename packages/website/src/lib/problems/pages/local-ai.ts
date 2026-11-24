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
      "A small model takes 1 to 2 GB. Bigger, smarter ones need 4 to 20 GB and 16 GB of memory.",
    ],
    related: [
      "local-ai/best-ollama-model-for-your-pc",
      "local-ai/ollama-open-webui-setup",
      "pc-cleanup/free-up-space-on-c-drive",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-comfyui",
    niche: "local-ai",
    searchPhrases: [
      "comfyui install",
      "how to install comfyui on windows",
      "comfyui install linux",
      "comfyui portable install",
      "comfyui install mac",
    ],
    title: "Install ComfyUI on Windows, Mac or Linux",
    description:
      "Install ComfyUI and make your first picture on your own graphics card. Ask Stella (stella.sh) and it sets everything up on your computer and opens it for you.",
    h1: "Install ComfyUI on your computer",
    short: "Install ComfyUI",
    lede: "Your own image maker, running on your graphics card.",
    answer:
      "ComfyUI comes as a desktop app, a portable folder for Windows with NVIDIA cards, or a manual install on Linux. Stella (stella.sh) picks the right one for your machine, adds a starter model and opens it.",
    gets: [
      "ComfyUI set up for your graphics card",
      "A starter model so the first picture works",
      "A shortcut that opens it in one click",
    ],
    prompt:
      "Install ComfyUI on my PC with the RTX 4070 and get it making pictures. Put it on my D drive.",
    demo: {
      ack: "On it. Checking your card and free space first.",
      task: "Installing ComfyUI",
      rows: ["Unpacking the portable version on D:", "Downloading an SDXL starter model", "Making a test picture"],
      reply:
        "Done. ComfyUI is in D:\\ComfyUI and opens from the shortcut on your desktop. The SDXL model is loaded and the test picture came out in your output folder.",
    },
    faq: [
      ["Which ComfyUI should I install?", "The desktop app on Windows with NVIDIA or a Mac with Apple chips. The portable folder if you want the newest updates first. Linux gets a manual install."],
      ["Does ComfyUI work on AMD cards?", "Yes, best on Linux. Newer Windows builds support recent AMD cards too, but NVIDIA has the fewest problems."],
    ],
    byHand: [
      "Windows or Mac: get the desktop app from [comfy.org/download](https://www.comfy.org/download).",
      "Windows portable: download the 7z from [GitHub releases](https://github.com/comfyanonymous/ComfyUI/releases), unpack it with 7-Zip and run run_nvidia_gpu.bat.",
      "Linux: clone the repo into a Python 3.13 venv, install PyTorch from pytorch.org, then the requirements, and run main.py.",
    ],
    related: [
      "local-ai/add-models-and-loras-to-comfyui",
      "local-ai/comfyui-text-to-image-workflow",
      "local-ai/comfyui-missing-custom-nodes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "comfyui-missing-custom-nodes",
    niche: "local-ai",
    searchPhrases: [
      "comfyui missing nodes",
      "comfyui missing custom nodes",
      "comfyui import failed custom node",
      "comfyui missing node types",
      "comfyui install missing nodes not working",
    ],
    title: "ComfyUI missing nodes or Import Failed? Fix them",
    description:
      "Red nodes, a missing node types popup or Import Failed in ComfyUI? Stella (stella.sh) installs the missing node packs and repairs the ones that fail to load.",
    h1: "ComfyUI missing nodes: get every red node working",
    short: "Missing or failed custom nodes",
    lede: "A downloaded workflow with every node found and loading.",
    answer:
      "Red boxes mean ComfyUI doesn't have the custom nodes a workflow uses, or they failed to load at start. Stella (stella.sh) installs the missing packs, adds what they need into ComfyUI's own Python and restarts it.",
    gets: [
      "Every missing node pack found and installed",
      "Import Failed errors read and fixed",
      "Your other custom nodes kept as they are",
    ],
    prompt:
      "I loaded a workflow from Civitai and half the nodes are red. ComfyUI says missing node types. Fix it.",
    demo: {
      ack: "On it. Reading the startup log first.",
      task: "Fixing missing ComfyUI nodes",
      rows: ["Matching red nodes to their packs", "Installing 3 node packs", "Fixing one pack that failed to load", "Restarting ComfyUI"],
      reply:
        "Fixed. Impact Pack, rgthree and WAS Node Suite are installed. WAS failed to load because a library was missing in ComfyUI's Python; it's added. No red nodes left.",
    },
    faq: [
      ["What does Import Failed mean in ComfyUI?", "The node pack is in your folder but crashed while loading, usually because something it needs isn't installed in the Python ComfyUI uses."],
      ["Why does Install Missing Custom Nodes do nothing?", "Some nodes aren't listed in the Manager, or the pack installs but then fails to load. The startup log says which."],
    ],
    byHand: [
      "Open the Manager and click Install Missing Custom Nodes, then restart ComfyUI fully, not just the page.",
      "Search the startup window for IMPORT FAILED to see which pack broke and why.",
      "Portable on Windows: run python_embeded\\python.exe -m pip install -r custom_nodes\\<pack>\\requirements.txt from the ComfyUI_windows_portable folder.",
    ],
    related: [
      "local-ai/fix-comfyui-workflow-errors",
      "local-ai/comfyui-python-version",
      "local-ai/install-comfyui",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-comfyui-workflow-errors",
    niche: "local-ai",
    searchPhrases: [
      "comfyui prompt outputs failed validation",
      "comfyui value not in list",
      "comfyui value not in list ckpt_name",
      "comfyui workflow not loading",
      "comfyui missing models error",
    ],
    title: "ComfyUI: Prompt outputs failed validation (fix)",
    description:
      "ComfyUI says Prompt outputs failed validation or Value not in list? Stella (stella.sh) finds the models the workflow wants, puts them in place and runs it.",
    h1: "ComfyUI prompt outputs failed validation: make the workflow run",
    short: "Fix a broken ComfyUI workflow",
    lede: "Someone else's workflow, running on your setup.",
    answer:
      "This error usually means a node points at a model file you don't have, or one saved under another name. Stella (stella.sh) finds each missing model, downloads it into the right folder and points the nodes at it.",
    gets: [
      "Each failing node named, with the reason",
      "Missing models downloaded to the right folders",
    ],
    prompt:
      "My ComfyUI workflow stops with Prompt outputs failed validation and Value not in list. Make it run.",
    demo: {
      ack: "On it. Reading which nodes failed and why.",
      task: "Repairing your workflow",
      rows: ["Two nodes want files you don't have", "Downloading the VAE and upscale model", "Pointing nodes at the new files", "Running the workflow once"],
      reply:
        "It runs now. The workflow asked for ae.safetensors and 4x-UltraSharp.pth, which weren't on your computer. Both are in place and the fixed copy is saved as Portrait (fixed).",
    },
    faq: [
      ["What does Value not in list mean in ComfyUI?", "The node wants a file by an exact name, like ckpt_name: model.safetensors, and no file with that name is in its folder."],
      ["Why does a workflow image not load when I drag it in?", "The picture was saved without its workflow, often by a website that strips it. Ask the creator for the workflow file."],
    ],
    byHand: [
      "Read the red text: it names the node and the file it wanted, e.g. ckpt_name or vae_name.",
      "Download that file (the workflow's page usually links it) into the matching folder under ComfyUI/models.",
      "Press R in ComfyUI to refresh, then pick the file in the node.",
    ],
    related: [
      "local-ai/comfyui-missing-custom-nodes",
      "local-ai/add-models-and-loras-to-comfyui",
      "local-ai/comfyui-text-to-image-workflow",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "comfyui-text-to-image-workflow",
    niche: "local-ai",
    searchPhrases: [
      "comfyui text to image workflow",
      "comfyui text to image workflow with lora",
      "comfyui text to image tutorial",
      "comfyui basic workflow",
      "comfyui first image",
    ],
    title: "ComfyUI text to image workflow, built for your models",
    description:
      "Want a simple ComfyUI text to image workflow, with a LoRA if you like? Stella (stella.sh) builds one around the models you have and saves it for you.",
    h1: "A ComfyUI text to image workflow that just works",
    short: "Text to image workflow",
    lede: "Type what you want to see and get a picture back.",
    answer:
      "A text to image workflow loads a model, reads your prompt, makes the picture and saves it. Stella (stella.sh) builds one for the models on your computer, adds your LoRA, picks sensible settings and saves it.",
    gets: [
      "A clean workflow you can open any time",
      "Settings that suit your model and card",
      "A slot for a LoRA or style",
    ],
    prompt:
      "Make me a ComfyUI workflow that turns a text prompt into a picture with my anime LoRA added.",
    demo: {
      ack: "Sure. Looking at the models you have.",
      task: "Building a text to image workflow",
      rows: ["Found SDXL model and anime LoRA", "Wiring prompt, sampler and save nodes", "Making a sample picture"],
      reply:
        "Saved in your workflows as **Text to image (anime)**. Type in the green box and press Run. The LoRA is at 0.8 strength; lower it if faces look too stylised.",
      files: ["text-to-image-anime.json"],
    },
    faq: [
      ["Where are the ComfyUI workflow templates?", "In the Workflow menu under Browse Templates. They download any model they need when you open them."],
      ["Where do I put the LoRA in a ComfyUI workflow?", "Between the model and the prompt boxes: a Load LoRA node takes the model and CLIP lines and passes them on."],
    ],
    byHand: [
      "The default graph is already text to image: Load Checkpoint, two CLIP Text Encode boxes, Empty Latent Image, KSampler, VAE Decode, Save Image.",
      "For a LoRA, add LoraLoader after Load Checkpoint and route MODEL and CLIP through it.",
    ],
    related: [
      "local-ai/comfyui-upscale-image-workflow",
      "local-ai/add-models-and-loras-to-comfyui",
      "local-ai/run-flux-locally",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "comfyui-upscale-image-workflow",
    niche: "local-ai",
    searchPhrases: [
      "comfyui upscale image workflow",
      "comfyui upscale models",
      "comfyui upscale image",
      "comfyui upscale model download",
      "upscale image to 4k comfyui",
    ],
    title: "ComfyUI upscale image workflow (sharp 4K results)",
    description:
      "Turn small AI pictures into sharp large ones. Stella (stella.sh) adds an upscale model to ComfyUI and builds an upscale image workflow for your folder.",
    h1: "A ComfyUI upscale image workflow for sharp, big pictures",
    short: "Upscale images in ComfyUI",
    lede: "Small, soft pictures made big and crisp.",
    answer:
      "Upscaling in ComfyUI uses a small model that makes a picture two or four times bigger, sometimes with a second pass that adds detail. Stella (stella.sh) downloads the model, builds the workflow and can run your folder through it.",
    gets: [
      "A ready upscale model in the right place",
      "A workflow that doubles or quadruples size",
      "A whole folder of pictures done in one go",
    ],
    prompt:
      "Upscale every picture in my ComfyUI output folder to 4K and keep faces sharp, not plastic.",
    demo: {
      ack: "On it. Setting up a 4x upscale.",
      task: "Upscaling your pictures",
      rows: ["Downloading 4x-UltraSharp", "Building an upscale workflow", "Running 42 pictures through it"],
      reply:
        "Done. All 42 pictures are in output/upscaled at about 4K. Your originals weren't touched. The workflow is saved as Upscale 4x for next time.",
      files: ["upscale-4x.json"],
    },
    faq: [
      ["Which ComfyUI upscale models are good?", "4x-UltraSharp for most pictures, RealESRGAN x4plus for photos, and anime-specific ones for drawings. All are small downloads."],
      ["Why do upscaled faces look plastic?", "A plain upscale only sharpens. A second pass at low strength redraws fine detail like skin and hair."],
    ],
    byHand: [
      "Download an upscale model from [OpenModelDB](https://openmodeldb.info) into ComfyUI/models/upscale_models.",
      "Add Load Upscale Model and Upscale Image (using Model) after VAE Decode or Load Image.",
      "For extra detail, install the Ultimate SD Upscale node and use denoise around 0.2 to 0.35.",
    ],
    related: [
      "local-ai/comfyui-text-to-image-workflow",
      "local-ai/add-models-and-loras-to-comfyui",
      "local-ai/comfyui-out-of-memory",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-models-and-loras-to-comfyui",
    niche: "local-ai",
    searchPhrases: [
      "where to put loras in comfyui",
      "comfyui lora folder",
      "comfyui install models",
      "how to add models to comfyui from civitai",
      "comfyui missing models",
    ],
    title: "Where to put LoRAs and models in ComfyUI",
    description:
      "Downloaded a model or LoRA from Civitai or Hugging Face? Stella (stella.sh) puts each file in the right ComfyUI folder so it shows up in your nodes.",
    h1: "Where to put LoRAs and models in ComfyUI",
    short: "Add models and LoRAs",
    lede: "Every download in the right folder and showing up in the list.",
    answer:
      "Each kind of file has its own folder inside ComfyUI's models folder: checkpoints, loras, vae and more. Stella (stella.sh) downloads from Civitai or Hugging Face, sorts each file into place and can share folders with Forge.",
    gets: [
      "Models, LoRAs and VAEs sorted into place",
      "Downloads straight from Civitai or Hugging Face links",
      "One models folder shared with Forge or A1111",
    ],
    prompt:
      "I have a pile of .safetensors files from Civitai in Downloads. Put them where ComfyUI can see them.",
    demo: {
      ack: "On it. Working out what each file is.",
      task: "Sorting models into ComfyUI",
      rows: ["Reading 9 files in Downloads", "Telling checkpoints from LoRAs", "Moving them into ComfyUI/models"],
      reply:
        "Done. 2 checkpoints went to models/checkpoints, 6 LoRAs to models/loras and 1 VAE to models/vae. Press R in ComfyUI and they're in the lists.",
    },
    faq: [
      ["Why doesn't my LoRA show up in ComfyUI?", "It's in the wrong folder, or ComfyUI hasn't refreshed. LoRAs go in models/loras; press R or restart."],
      ["Can ComfyUI use my A1111 or Forge models?", "Yes. One small settings file points ComfyUI at the other app's model folders, so nothing is copied twice."],
    ],
    byHand: [
      "Full models go in models/checkpoints, LoRAs in models/loras, VAEs in models/vae, upscalers in models/upscale_models.",
      "Flux and other newer models split up: the main file in models/diffusion_models, text encoders in models/text_encoders.",
      "To share folders, rename extra_model_paths.yaml.example in the ComfyUI folder and set base_path to your A1111 or Forge folder.",
    ],
    related: [
      "local-ai/fix-comfyui-workflow-errors",
      "local-ai/install-comfyui",
      "pc-cleanup/find-large-files-taking-up-space",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "torch-not-compiled-with-cuda-enabled",
    niche: "local-ai",
    searchPhrases: [
      "torch not compiled with cuda enabled",
      "assertionerror torch not compiled with cuda enabled comfyui",
      "torch not compiled with cuda enabled windows",
      "comfyui torch cuda version mismatch",
      "cuda error no kernel image is available",
    ],
    title: "Torch not compiled with CUDA enabled: fix it",
    description:
      "Getting AssertionError: Torch not compiled with CUDA enabled? Stella (stella.sh) puts the right PyTorch for your NVIDIA card in the Python your app uses.",
    h1: "Torch not compiled with CUDA enabled: get your graphics card working",
    short: "Torch not compiled with CUDA",
    lede: "Your app using the graphics card again instead of crawling.",
    answer:
      "The error means the app has a copy of PyTorch built without NVIDIA support, so it can't use your card. Stella (stella.sh) swaps in the CUDA build that matches your card and driver, in the Python that app runs.",
    gets: [
      "The right PyTorch for your card and driver",
      "Installed in the app's own Python, not another one",
    ],
    prompt:
      "ComfyUI says AssertionError: Torch not compiled with CUDA enabled. I have an RTX 3060. Fix it.",
    demo: {
      ack: "On it. Finding which Python ComfyUI really uses.",
      task: "Fixing Torch and CUDA",
      rows: ["ComfyUI has the processor-only PyTorch", "Installing PyTorch with CUDA for your driver", "Starting ComfyUI on the RTX 3060"],
      reply:
        "Fixed. ComfyUI had a PyTorch with no CUDA, pulled in by a node pack. It now has the CUDA build and starts on your RTX 3060.",
    },
    faq: [
      ["Why does Torch not compiled with CUDA enabled keep coming back?", "A custom node or update reinstalls the plain PyTorch. Stella puts the CUDA one back and names the pack."],
      ["I have an AMD card or a Mac. What now?", "CUDA is NVIDIA only. The app needs the AMD or Apple version of PyTorch instead, and the setting asking for CUDA switched off."],
      ["What does no kernel image is available mean?", "Your PyTorch is too old for your card, common on RTX 50 series. A newer CUDA build fixes it."],
    ],
    byHand: [
      "Use the app's own Python: python_embeded in ComfyUI portable, venv in Forge.",
      "With that Python: pip uninstall torch torchvision torchaudio, then install the CUDA build from [pytorch.org](https://pytorch.org/get-started/locally/).",
    ],
    related: [
      "local-ai/comfyui-python-version",
      "local-ai/comfyui-out-of-memory",
      "local-ai/install-comfyui",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "comfyui-out-of-memory",
    niche: "local-ai",
    searchPhrases: [
      "comfyui out of memory",
      "comfyui cuda out of memory",
      "comfyui allocation on device error",
      "comfyui out of vram",
      "torch outofmemoryerror cuda out of memory",
    ],
    title: "ComfyUI out of memory (allocation on device)? Fix it",
    description:
      "ComfyUI stopping with CUDA out of memory or Allocation on device? Stella (stella.sh) finds what fills your graphics card and changes the workflow so it fits.",
    h1: "ComfyUI out of memory: make it fit your graphics card",
    short: "Out of memory and VRAM errors",
    lede: "Big models and pictures that finish instead of crashing.",
    answer:
      "Out of memory means the model, picture size or batch is bigger than your graphics card holds. Stella (stella.sh) switches to a smaller copy of the model, turns on ComfyUI's low VRAM mode and splits big steps so it finishes.",
    gets: [
      "The step that runs out named plainly",
      "Smaller model copies that look nearly the same",
      "Low VRAM mode set to start every time",
    ],
    prompt:
      "ComfyUI crashes with torch.OutOfMemoryError: Allocation on device on 1536-pixel pictures. 8 GB card.",
    demo: {
      ack: "On it. Finding which step runs out.",
      task: "Fixing out of memory in ComfyUI",
      rows: ["Your card has 8 GB", "Swapping in the smaller fp8 model", "Turning on low VRAM mode", "Splitting the final decode step"],
      reply:
        "Fixed. The full model alone needed more than your card holds. It now uses the fp8 copy, low VRAM mode is on, and the last step works in tiles. 1536-pixel pictures finish.",
    },
    faq: [
      ["Will more computer memory (RAM) help ComfyUI out of memory?", "Sometimes. Low VRAM mode moves parts of the model into normal memory, so 32 GB helps a lot with big models."],
    ],
    byHand: [
      "Lower the size and batch in Empty Latent Image first. Close games and browsers that hold graphics memory.",
      "Start ComfyUI with --lowvram (add it to run_nvidia_gpu.bat on portable).",
      "Use fp8 or GGUF versions of big models (the ComfyUI-GGUF node loads GGUF).",
      "Replace VAE Decode with VAE Decode (Tiled) for large pictures and video.",
    ],
    related: [
      "local-ai/make-comfyui-faster-low-vram",
      "local-ai/run-flux-locally",
      "local-ai/torch-not-compiled-with-cuda-enabled",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "comfyui-python-version",
    niche: "local-ai",
    searchPhrases: [
      "comfyui python version",
      "comfyui python 3.13",
      "comfyui python 3.14 not working",
      "stable diffusion python version wrong",
      "no matching distribution found for torch",
    ],
    title: "ComfyUI Python version problems, sorted",
    description:
      "Wrong Python for ComfyUI or Stable Diffusion, and installs failing? Stella (stella.sh) sets the app up with the Python it wants, without breaking others.",
    h1: "ComfyUI Python version wrong? Run it on the right one",
    short: "Python version problems",
    lede: "The right Python for each AI app, side by side.",
    answer:
      "AI apps want a particular Python, and a newer one on your computer often makes installs fail. Stella (stella.sh) gives each app its own copy of the Python it wants, so ComfyUI, Forge and others stop clashing.",
    gets: [
      "Each app on the Python it was built for",
      "Your system Python left alone",
      "Installs that stop failing with no matching version",
    ],
    prompt:
      "ComfyUI won't install, it says No matching distribution found for torch. I think my Python is too new.",
    demo: {
      ack: "On it. Checking which Pythons you have.",
      task: "Fixing the Python version",
      rows: ["You have Python 3.14 only", "Adding Python 3.12 just for ComfyUI", "Reinstalling ComfyUI's parts inside it"],
      reply:
        "Fixed. ComfyUI now runs in its own Python 3.12 folder, so its packages install. Your Python 3.14 is untouched for everything else.",
    },
    faq: [
      ["What Python version does ComfyUI use?", "ComfyUI recommends Python 3.13, with 3.12 when a custom node won't install. The portable version brings its own, so your system's doesn't matter."],
      ["What Python does A1111 need?", "Automatic1111 was built for Python 3.10.6 and breaks on newer ones. Forge Neo uses a newer Python."],
    ],
    byHand: [
      "Install [uv](https://docs.astral.sh/uv/) and run uv venv --python 3.12 in the ComfyUI folder for a private copy.",
      "Activate it, install PyTorch from pytorch.org, then pip install -r requirements.txt.",
      "On Windows, the portable ComfyUI avoids all this: it ships with its own Python.",
    ],
    related: [
      "local-ai/torch-not-compiled-with-cuda-enabled",
      "local-ai/comfyui-missing-custom-nodes",
      "local-ai/install-stable-diffusion-forge",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "best-ollama-model-for-your-pc",
    niche: "local-ai",
    searchPhrases: [
      "best ollama model for my pc",
      "ollama best models to run locally",
      "ollama best model for 8gb vram",
      "how to install ollama models",
      "which ollama model should i use",
    ],
    title: "Best Ollama model for your PC, picked and installed",
    description:
      "Not sure which Ollama model your PC can run? Stella (stella.sh) checks your graphics card and memory, installs Ollama and downloads a model that fits.",
    h1: "The best Ollama model for my PC",
    short: "Run Ollama and pick a model",
    lede: "A chat model that fits your computer and answers quickly.",
    answer:
      "The best Ollama model is the biggest one that fits in your graphics card's memory with room to spare. Stella (stella.sh) checks your card, installs Ollama, downloads a model that fits and tries it.",
    gets: [
      "A model matched to your card's memory",
      "Ollama installed and starting with your computer",
    ],
    prompt:
      "Install Ollama and pick the best model my PC can run well. I mostly want help writing emails.",
    demo: {
      ack: "Sure. Seeing how much your card holds.",
      task: "Choosing an Ollama model",
      rows: ["Graphics card has 8 GB", "Installing Ollama", "Downloading Qwen3 8B, about 5 GB"],
      reply:
        "Done. Ollama is running with **Qwen3 8B**, which fits your 8 GB card and is good at writing. Open the Ollama app and pick it from the model menu to start.",
    },
    faq: [
      ["What Ollama model fits 8 GB of VRAM?", "Models around 7 to 9 billion size, like Qwen3 8B or Gemma 3 4B. They download at 3 to 6 GB."],
      ["Can Ollama run without a graphics card?", "Yes, on the processor alone. Small models like Llama 3.2 3B stay usable; bigger ones get slow."],
    ],
    byHand: [
      "Install from [ollama.com/download](https://ollama.com/download). Windows and Mac get an app with a chat window.",
      "Rule of thumb: the model's download size should be a gigabyte or two under your card's memory.",
      "Pull a model with ollama pull qwen3:8b (or gemma3:4b for smaller cards), then ollama run qwen3:8b.",
    ],
    related: [
      "local-ai/ollama-open-webui-setup",
      "local-ai/run-ai-offline-on-your-computer",
      "pc-cleanup/free-up-space-on-c-drive",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "ollama-open-webui-setup",
    niche: "local-ai",
    searchPhrases: [
      "ollama open webui setup",
      "ollama open webui install",
      "use local model in chat app",
      "chatgpt style interface for ollama",
      "ollama vs lm studio",
    ],
    title: "Set up Open WebUI with Ollama (a ChatGPT-style chat)",
    description:
      "Want a ChatGPT-style window for your local models? Stella (stella.sh) sets up Open WebUI with Ollama, keeps your chats and opens it in your browser.",
    h1: "Ollama and Open WebUI setup: a proper chat for local models",
    short: "Chat app for local models",
    lede: "A ChatGPT-style chat window for the AI on your computer.",
    answer:
      "Open WebUI is a free chat window that talks to Ollama on your computer, with saved chats, file uploads and model switching. Stella (stella.sh) installs it, connects it to your models and starts it with your computer.",
    gets: [
      "A ChatGPT-style chat in your browser",
      "Every Ollama model in one menu",
    ],
    prompt:
      "I have Ollama with a few models. Set up Open WebUI so I can chat like in ChatGPT and upload PDFs.",
    demo: {
      ack: "On it. Checking which models Ollama has.",
      task: "Setting up Open WebUI",
      rows: ["Found 3 models in Ollama", "Installing Open WebUI", "Linking it to Ollama", "Starting it with your computer"],
      reply:
        "Done. Open WebUI is at http://localhost:8080 and bookmarked. All 3 models are in the menu at the top, and PDFs can be dropped into any chat.",
    },
    faq: [
      ["Ollama vs LM Studio: which is easier?", "LM Studio is one app with chat and downloads built in. Ollama runs in the background and works with more chat apps, like Open WebUI."],
      ["Can my phone use it?", "Yes, from any device on your home Wi-Fi, using your computer's address."],
    ],
    byHand: [
      "With Docker: docker run -d -p 3000:8080 --add-host=host.docker.internal:host-gateway -v open-webui:/app/backend/data --name open-webui ghcr.io/open-webui/open-webui:main.",
      "Without Docker: pip install open-webui in a Python 3.11 venv, then open-webui serve.",
      "Open it, make the first account (it stays on your computer) and your Ollama models appear.",
    ],
    related: [
      "local-ai/best-ollama-model-for-your-pc",
      "local-ai/run-ai-offline-on-your-computer",
      "local-ai/install-comfyui",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-stable-diffusion-forge",
    niche: "local-ai",
    searchPhrases: [
      "how to install stable diffusion forge",
      "stable diffusion forge neo install",
      "automatic1111 install",
      "where to put loras in forge",
      "automatic1111 vs forge",
    ],
    title: "Install Stable Diffusion Forge (Neo) or A1111",
    description:
      "Want the simple Stable Diffusion screen with sliders, not ComfyUI's boxes? Stella (stella.sh) installs Forge Neo on your computer and adds your models.",
    h1: "How to install Stable Diffusion Forge",
    short: "Stable Diffusion Forge or A1111",
    lede: "The classic Stable Diffusion screen, fast on your card.",
    answer:
      "Forge looks like Automatic1111 but runs faster and on smaller cards; Forge Neo is the version still getting updates. Stella (stella.sh) installs it, adds your models and LoRAs and opens it in your browser.",
    gets: [
      "Forge Neo on the right Python for it",
      "Your existing models and LoRAs found",
      "A desktop shortcut that starts it",
    ],
    prompt:
      "Install Stable Diffusion Forge on my PC and use the models already in my old A1111 folder.",
    demo: {
      ack: "On it. Looking at your old A1111 folder.",
      task: "Installing Stable Diffusion Forge",
      rows: ["Found 4 models and 11 LoRAs", "Installing Forge Neo", "Pointing it at your existing models", "Making a test picture"],
      reply:
        "Done. Forge Neo opens from the shortcut on your desktop and uses the models and LoRAs in your A1111 folder, so nothing was copied twice.",
    },
    faq: [
      ["Automatic1111 vs Forge: which should I use?", "Forge. Automatic1111 hasn't had a release since 2024, while Forge Neo keeps up with new models and cards."],
      ["Where do I put LoRAs in Forge?", "In models/Lora inside the Forge folder. Checkpoints go in models/Stable-diffusion."],
    ],
    byHand: [
      "Get Forge Neo from [Haoming02/sd-webui-forge-classic](https://github.com/Haoming02/sd-webui-forge-classic) (neo branch) and follow its README for the Python it wants.",
      "Run webui-user.bat (Windows) or webui.sh (Linux). The first start downloads several GB.",
      "To reuse A1111 models, add --ckpt-dir and --lora-dir pointing at the old folders in webui-user.bat.",
    ],
    related: [
      "local-ai/install-comfyui",
      "local-ai/comfyui-python-version",
      "local-ai/add-models-and-loras-to-comfyui",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-comfyui-faster-low-vram",
    niche: "local-ai",
    searchPhrases: [
      "how to make comfyui faster",
      "comfyui low vram",
      "comfyui slow generation",
      "stable diffusion low vram",
      "comfyui slow after first generation",
    ],
    title: "Make ComfyUI faster on a low VRAM graphics card",
    description:
      "ComfyUI slow on a 6 or 8 GB card? Stella (stella.sh) picks lighter models, the right low VRAM settings and quicker samplers so your pictures come out faster.",
    h1: "How to make ComfyUI faster on a low VRAM card",
    short: "Speed up a small graphics card",
    lede: "Quicker pictures from the graphics card you already have.",
    answer:
      "On a small card, most slowness comes from a model too big to fit, so it keeps spilling into normal memory. Stella (stella.sh) swaps in lighter copies, fewer-step versions and the right ComfyUI settings for your card.",
    gets: [
      "Models sized to fit your card's memory",
      "Fast few-step versions where they exist",
      "Startup settings tuned for your card",
    ],
    prompt:
      "ComfyUI takes 3 minutes per SDXL picture on my GTX 1660 with 6 GB. Make it faster.",
    demo: {
      ack: "On it. Seeing where the time goes.",
      task: "Speeding up ComfyUI",
      rows: ["Model spills out of your 6 GB", "Adding a 4-step speed LoRA", "Turning on low VRAM mode", "Applying the fix GTX 16 cards need"],
      reply:
        "Done. The model now fits your card, the speed LoRA cuts 30 steps to 4, and the GTX 16 series fix is set. Pictures should take a fraction of the time.",
    },
    faq: [
      ["Why is ComfyUI slow after the first picture?", "Usually it reloads the model each time because your card is full. Low VRAM mode or a smaller model keeps it loaded."],
    ],
    byHand: [
      "In NVIDIA Control Panel, set CUDA Sysmem Fallback Policy to Prefer No Sysmem Fallback so it errors instead of crawling.",
      "Use SDXL Lightning, Hyper or DMD2 LoRAs for 4 to 8 steps with CFG around 1 to 2.",
      "Start with --lowvram on 4 to 6 GB cards.",
      "Use fp8 or GGUF copies of big models.",
    ],
    related: [
      "local-ai/comfyui-out-of-memory",
      "local-ai/run-flux-locally",
      "local-ai/comfyui-text-to-image-workflow",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "run-flux-locally",
    niche: "local-ai",
    searchPhrases: [
      "run flux locally",
      "flux local install",
      "flux comfyui install",
      "flux 2 klein comfyui",
      "flux low vram gguf",
    ],
    title: "Run Flux locally in ComfyUI (even on 8 GB cards)",
    description:
      "Want Flux on your own computer? Stella (stella.sh) picks the Flux version your graphics card can handle, downloads every part and sets up ComfyUI to run it.",
    h1: "Run Flux locally on your own computer",
    short: "Run Flux locally",
    lede: "Flux pictures made on your own graphics card.",
    answer:
      "Flux needs a few big files and a card with enough memory, or a shrunk copy. Stella (stella.sh) picks the version that fits, like FLUX.2 klein or a compact Flux dev, downloads every part into ComfyUI and makes a first picture.",
    gets: [
      "A Flux version that fits your card",
      "Every file in the right ComfyUI folder",
      "A ready workflow to type into",
    ],
    prompt:
      "I want to run Flux locally in ComfyUI. I have an RTX 3070 with 8 GB and 32 GB of memory.",
    demo: {
      ack: "On it. Picking a Flux version for 8 GB.",
      task: "Setting up Flux",
      rows: ["Choosing FLUX.2 klein 4B for 8 GB", "Downloading the model and text encoder", "Loading the official Flux workflow", "Making a first picture"],
      reply:
        "Done. FLUX.2 klein 4B runs on your RTX 3070. The workflow is saved as Flux 2 klein; type your prompt and press Run.",
      files: ["flux2-klein.json"],
    },
    faq: [
      ["Which Flux should I run locally?", "FLUX.2 klein 4B on 8 to 12 GB cards. With 16 GB or more, Flux dev in its fp8 copy. FLUX.2 dev needs a very large card."],
      ["Does Flux work on a Mac?", "Yes, in ComfyUI on Apple chips with 32 GB of memory or more, though slower than a good NVIDIA card."],
    ],
    byHand: [
      "Update ComfyUI first, then open Workflow → Browse Templates → Flux and let it list the files.",
      "Main model in models/diffusion_models, text encoders in models/text_encoders, ae.safetensors in models/vae.",
      "For small cards, use GGUF copies (Q4 or Q5) with the ComfyUI-GGUF node.",
    ],
    related: [
      "local-ai/make-comfyui-faster-low-vram",
      "local-ai/add-models-and-loras-to-comfyui",
      "local-ai/comfyui-out-of-memory",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "torch-cuda-out-of-memory",
    niche: "local-ai",
    searchPhrases: [
      "torch.cuda.outofmemoryerror: cuda out of memory",
      "cuda out of memory. tried to allocate",
      "cuda out of memory pytorch",
      "cuda out of memory llm",
      "lora training cuda out of memory",
    ],
    title: "torch.cuda.OutOfMemoryError: CUDA out of memory? Make it fit",
    description:
      "Model loading, training or chat stopping with CUDA out of memory, tried to allocate? Stella (stella.sh) shrinks the job to fit your graphics card and runs it.",
    h1: "torch.cuda.OutOfMemoryError: CUDA out of memory",
    short: "CUDA out of memory (PyTorch, LLMs, training)",
    lede: "The model or training run finishing on the card you have.",
    answer:
      "The job asked your graphics card for more memory than it has left. Stella (stella.sh) frees what other programs hold, then loads a smaller copy of the model or trains in smaller steps so the same work fits.",
    gets: [
      "What's eating your card's memory, named",
      "A 4-bit or 8-bit copy of the model when it helps",
      "Training settings scaled to your card",
    ],
    prompt:
      "Training a LoRA in kohya stops with torch.cuda.OutOfMemoryError: CUDA out of memory, tried to allocate 2 GB. RTX 3060 12 GB.",
    demo: {
      ack: "On it. Seeing what's already using your card.",
      task: "Fitting LoRA training on 12 GB",
      rows: ["Browser and Discord hold 1.4 GB", "Batch size 4 is too big", "Turning on memory-saving training options", "Restarting training from your folder"],
      reply:
        "Training runs now. Batch size is 1 with gradient checkpointing and 8-bit Adam, which keeps the 3060 under its 12 GB. Your LoRA saves to training/output every epoch as before.",
    },
    faq: [
      ["Why does it say it tried to allocate only a little?", "Earlier steps already filled the card, so even a small extra request fails."],
      ["Should I run a smaller model instead?", "Often a 4-bit copy of the same model is the better trade. It needs about a quarter of the memory and answers nearly as well."],
    ],
    byHand: [
      "Close other programs using the GPU; check nvidia-smi for leftover Python.",
      "Lower batch size or context length; turn on gradient checkpointing for training.",
      "Load models in 4-bit or 8-bit with bitsandbytes, or use a GGUF in llama.cpp or Ollama.",
    ],
    related: [
      "local-ai/comfyui-out-of-memory",
      "local-ai/best-ollama-model-for-your-pc",
      "local-ai/cuda-driver-version-is-insufficient",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "cuda-driver-version-is-insufficient",
    niche: "local-ai",
    searchPhrases: [
      "cuda driver version is insufficient for cuda runtime version",
      "cuda driver version is insufficient",
      "cuda driver version is insufficient for cuda runtime version windows",
      "cuda driver version is insufficient for cuda runtime version docker",
      "wsl cuda driver version is insufficient for cuda runtime version",
    ],
    title: "CUDA driver version is insufficient for CUDA runtime version",
    description:
      "AI app saying CUDA driver version is insufficient for CUDA runtime version? Stella (stella.sh) updates your NVIDIA driver or fits the app to it, then runs it.",
    h1: "CUDA driver version is insufficient for CUDA runtime version",
    short: "CUDA driver version is insufficient",
    lede: "Your AI app on the graphics card again, without the version error.",
    answer:
      "Your AI app was built for a newer CUDA than your NVIDIA driver supports. Stella (stella.sh) compares the two, updates the driver when that's simplest, or installs the app's build that fits the driver you have.",
    gets: [
      "Your driver and the app's CUDA version compared",
      "A newer NVIDIA driver, or an app build that fits",
      "The same fix applied inside WSL or Docker",
    ],
    prompt:
      "Whisper says CUDA driver version is insufficient for CUDA runtime version on my RTX 3070 laptop. Get it using the GPU.",
    demo: {
      ack: "On it. Comparing your driver with what Whisper needs.",
      task: "Fixing the CUDA version error",
      rows: ["Your driver is from early 2024", "Whisper's PyTorch wants a newer CUDA", "Installing the current NVIDIA Studio driver", "Running a short test file"],
      reply:
        "Your laptop's driver was older than the CUDA in Whisper's PyTorch. The current NVIDIA Studio driver is in and Whisper now transcribes on the RTX 3070 instead of failing at start.",
    },
    faq: [
      ["How do I check my CUDA driver version?", "Open a command window and run nvidia-smi. The top right shows the newest CUDA version your driver supports."],
      ["Does this happen in Docker or WSL too?", "Yes. Both borrow the Windows or host driver, so updating that driver is usually the whole fix."],
    ],
    byHand: [
      "Run nvidia-smi and note the CUDA Version it shows.",
      "Update the driver from [nvidia.com/drivers](https://www.nvidia.com/drivers), or the NVIDIA App.",
      "Or reinstall PyTorch built for an older CUDA from the selector on pytorch.org.",
    ],
    related: [
      "local-ai/torch-not-compiled-with-cuda-enabled",
      "local-ai/torch-cuda-out-of-memory",
      "local-ai/comfyui-python-version",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
];
