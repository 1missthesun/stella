import type { AnswerPage } from "@/lib/answers";

type ModelPage = Omit<AnswerPage, "kind">;

const FREE = "Free with the Claude, Gemini or ChatGPT plan you already have.";

export const MODEL_PAGES_DATA: ModelPage[] = [
  {
    slug: "claude-for-game-modding",
    queries: ["Claude for game modding", "use Claude to mod games", "can Claude install mods", "Claude mod maker", "Claude Skyrim mods"],
    metaTitle: "Use Claude to mod your games, right on your PC",
    metaDescription:
      "Claude installs mods, fixes broken ones and makes new ones on your own PC when you run it through Stella (stella.sh). Free with your Claude plan.",
    eyebrow: "Claude for game modding",
    headline: "Use Claude to mod your games.",
    lede: "Say which mods you want. Claude puts them in your game.",
    recommended: "claude",
    answer: `Run Claude through Stella (stella.sh) and it mods your games on your own PC: it finds the game, gets the mods, sorts the order and checks the game starts. ${FREE}`,
    demo: {
      prompt: "Install the Skyrim mods that make it look like a 2026 game, and keep it running smooth on my PC.",
      ack: "On it. Checking your graphics card and your Skyrim folder first.",
      task: "Modding Skyrim",
      rows: ["Found Skyrim Special Edition on Steam", "Installing 14 visual mods in order", "Starting the game to check it loads"],
      reply: "Done. Skyrim has new lighting, grass, water and faces, tuned for your card. It starts to the menu with no errors. Your old setup is saved if you want it back.",
    },
    why: [
      {
        title: "Claude does the modding, not just the explaining.",
        body: "In a browser chat, Claude tells you which files go where and you do the copying. Through Stella, Claude works on your PC: it opens the game folder, downloads the mods, puts each file in the right place and starts the game to see if it loads.",
      },
      {
        title: "Claude stops? Hand the step to Gemini.",
        body: "If Claude won't do one step, type @ in the same chat, pick Gemini and it carries on from where Claude was. Same chat, nothing to explain again.",
      },
      {
        title: "Fixes, too.",
        body: "When a patch breaks your mods, say so. It reads the crash log, finds the mod at fault and updates or removes it. Want a mod nobody made yet? Describe it and Claude makes it.",
      },
    ],
    guides: ["game-mods/mod-skyrim", "game-mods/gta-5-mods-not-working", "game-mods/ai-mod-maker", "game-mods/mod-baldurs-gate-3", "game-mods/install-minecraft-mods", "game-mods/mod-stardew-valley"],
    questions: [
      { q: "Can Claude install mods for me?", a: "Yes, when it runs through Stella on your computer. Tell it the game and the mods, and they're in when you start the game." },
      { q: "Which Claude plan do I need?", a: "Claude Pro or Max. Stella uses it through Claude Code, Anthropic's own tool, and sets that up for you." },
    ],
  },
  {
    slug: "claude-for-reverse-engineering",
    queries: ["Claude for reverse engineering", "Claude reverse engineering", "use Claude to decompile", "Claude Ghidra", "Claude Code reverse engineering"],
    metaTitle: "Use Claude for reverse engineering on your own computer",
    metaDescription:
      "Give Claude a program, app, game or file and it takes it apart on your computer when you run it through Stella (stella.sh). Free with your Claude plan.",
    eyebrow: "Claude for reverse engineering",
    headline: "Use Claude for reverse engineering.",
    lede: "Hand Claude the file. It shows you what's inside.",
    recommended: "claude",
    answer: `Run Claude through Stella (stella.sh) and it works on the real file on your computer: it decompiles it, reads the code, explains what it does and changes it if you ask. ${FREE}`,
    demo: {
      prompt: "What does this tool.exe in my Downloads actually do? Get me the code back if you can.",
      ack: "Taking a look at tool.exe now.",
      task: "Taking tool.exe apart",
      rows: ["It's a .NET program", "Turning it back into C#", "Reading what each part does"],
      reply: "It's a small backup tool: it zips your Documents folder every night and uploads it to one web address. The readable code is in Downloads/tool-source.",
      files: ["tool-source"],
    },
    why: [
      {
        title: "Claude gets the file, not a paste.",
        body: "A browser chat only sees what you paste, and a program doesn't paste. Through Stella, Claude opens the file on your computer, picks the right decompiler, runs it and reads the result itself.",
      },
      {
        title: "Ask Gemini when Claude says no.",
        body: "Claude turns down some steps. Type @, pick Gemini, and the same chat carries on with the file it already has.",
      },
      {
        title: "Changes you can use.",
        body: "Ask for a fix, a patch or a cleaner version and it builds a new copy next to the original. Your file stays as it was.",
      },
    ],
    guides: ["reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/use-ai-with-ghidra", "reverse-engineering/decompile-apk", "reverse-engineering/edit-save-file", "reverse-engineering/decompile-unity-game", "reverse-engineering/is-this-exe-safe"],
    questions: [
      { q: "Can Claude decompile an EXE?", a: "Yes, through Stella. It runs the decompiler on your computer and gives you code you can read, change and build again." },
      { q: "Can Claude use Ghidra?", a: "Yes. Stella opens Ghidra for Claude and Claude explains what it finds. See [AI with Ghidra](/how/reverse-engineering/use-ai-with-ghidra)." },
    ],
  },
  {
    slug: "claude-for-comfyui",
    queries: ["Claude for ComfyUI", "Claude ComfyUI", "use Claude to fix ComfyUI", "Claude local AI setup", "Claude make ComfyUI workflow"],
    metaTitle: "Use Claude for ComfyUI and local AI on your computer",
    metaDescription:
      "Claude installs ComfyUI, fixes missing nodes and broken workflows, and adds models when you run it through Stella (stella.sh). Free with your Claude plan.",
    eyebrow: "Claude for ComfyUI",
    headline: "Use Claude for ComfyUI and local AI.",
    lede: "Claude sets it up, fixes the red nodes and makes the workflow.",
    recommended: "claude",
    answer: `Run Claude through Stella (stella.sh) and it works in your own ComfyUI: it installs it, fixes missing nodes and errors, adds models and LoRAs, and builds the workflow you describe. ${FREE}`,
    demo: {
      prompt: "My ComfyUI workflow is full of red missing nodes. Fix it so it runs.",
      ack: "Opening your ComfyUI to see what's missing.",
      task: "Fixing your ComfyUI workflow",
      rows: ["6 missing nodes from 3 packs", "Installing them and their Python parts", "Restarting ComfyUI and running it"],
      reply: "Fixed. The three node packs are in, ComfyUI restarted, and the workflow made a test image with no errors. Nothing else in your setup changed.",
    },
    why: [
      {
        title: "Claude works in your setup.",
        body: "A browser chat guesses at your folders and Python. Through Stella, Claude looks at your actual ComfyUI, your graphics card and the error itself, then fixes it and runs the workflow to check.",
      },
      {
        title: "Gemini is one @ away.",
        body: "If Claude won't do a step, type @, pick Gemini and keep going in the same chat.",
      },
      {
        title: "From nothing to images.",
        body: "Starting from scratch? Ask for ComfyUI, a model that fits your card and a simple text-to-image workflow, and Claude sets up the lot.",
      },
    ],
    guides: ["local-ai/comfyui-missing-custom-nodes",  "local-ai/install-comfyui",  "local-ai/fix-comfyui-workflow-errors",  "local-ai/add-models-and-loras-to-comfyui",  "local-ai/torch-not-compiled-with-cuda-enabled",  "local-ai/comfyui-out-of-memory"],
    questions: [
      { q: "Can Claude fix ComfyUI errors?", a: "Yes, through Stella on your computer. It reads the error, fixes the nodes, models or Python behind it and runs the workflow again." },
      { q: "Can Claude make a ComfyUI workflow?", a: "Yes. Describe what you want made and it builds the workflow, adds what's missing and runs it once." },
    ],
  },
  {
    slug: "claude-for-emulation",
    queries: ["Claude for emulation", "use Claude to set up emulators", "Claude RetroArch setup", "AI set up emulator", "Claude PS2 emulator"],
    metaTitle: "Use Claude to set up emulators on your computer",
    metaDescription:
      "Claude sets up Switch, PS2, PS3, GameCube and RetroArch emulators, controllers and saves when you run it through Stella (stella.sh). Free with your plan.",
    eyebrow: "Claude for emulation",
    headline: "Use Claude to set up emulators.",
    lede: "Name the console and the game. Claude gets it playing.",
    recommended: "claude",
    answer: `Run Claude through Stella (stella.sh) and it sets up emulators on your computer: the emulator, its settings, your controller and your saves, ready to play. ${FREE}`,
    demo: {
      prompt: "Set up a PS2 emulator so I can play my God of War disc copy with my Xbox controller.",
      ack: "On it. Setting up PCSX2 for your PC.",
      task: "Setting up PS2 games",
      rows: ["Installing PCSX2", "Matching settings to your graphics card", "Mapping your Xbox controller"],
      reply: "Ready. God of War opens in PCSX2 at 3x resolution with your Xbox controller mapped. Your saves go to Documents/PCSX2/memcards.",
    },
    why: [
      {
        title: "Claude does the setup.",
        body: "A browser chat gives you twelve steps and settings to copy. Through Stella, Claude installs the emulator on your computer, sets it up for your graphics card, maps your controller and opens the game.",
      },
      {
        title: "Gemini picks up what Claude won't.",
        body: "If Claude turns down a step, type @, pick Gemini and the same chat carries on.",
      },
      {
        title: "Stutter, black screens and saves.",
        body: "Say what's wrong in plain words. It changes the right setting, moves saves between emulators and puts fan translations on your games.",
      },
    ],
    guides: ["emulation/set-up-pcsx2",  "emulation/set-up-switch-emulator-on-pc",  "emulation/set-up-retroarch",  "emulation/emulator-controller-not-working",  "emulation/switch-emulator-stuttering",  "emulation/transfer-saves-between-emulators"],
    questions: [
      { q: "Can Claude set up an emulator?", a: "Yes, through Stella on your computer. It installs the emulator, sets it up and maps your controller." },
      { q: "Is Gemini better for emulation?", a: "We mark Gemini first for emulators because it rarely stops at a step. Claude is just as good at the setup, and you can switch in the same chat." },
    ],
  },
  {
    slug: "claude-for-pc-fixes",
    queries: ["Claude fix my PC", "use Claude to fix FPS drops", "Claude fix gaming PC", "Claude fix game stutter"],
    metaTitle: "Use Claude to fix your gaming PC: FPS, stutter, crashes",
    metaDescription:
      "Claude finds why games stutter, crash or drop frames and fixes drivers, settings and temps on your PC when you run it through Stella (stella.sh).",
    eyebrow: "Claude for PC fixes",
    headline: "Use Claude to fix your gaming PC.",
    lede: "Say what's wrong. Claude finds the cause and fixes it.",
    recommended: "claude",
    answer: `Run Claude through Stella (stella.sh) and it fixes your PC itself: it reads your drivers, settings, temperatures and crash logs, finds the cause and changes what's needed. ${FREE}`,
    demo: {
      prompt: "My games started stuttering last week and my FPS dropped in Fortnite. Fix it.",
      ack: "Checking what changed on your PC last week.",
      task: "Finding the stutter",
      rows: ["A Windows update replaced your NVIDIA driver", "Installing the current driver cleanly", "Turning Game Mode back on"],
      reply: "Fixed. Windows had swapped in an old graphics driver. The current one is installed and Game Mode is on again. Fortnite should be back to how it ran before.",
    },
    why: [
      {
        title: "Claude looks at your actual PC.",
        body: "A browser chat lists twenty things to try. Through Stella, Claude checks your drivers, temperatures, startup apps and crash logs on your computer, finds the one that's wrong and fixes it.",
      },
      {
        title: "Gemini right there too.",
        body: "If Claude won't do a step, type @, pick Gemini and it carries on in the same chat.",
      },
      {
        title: "Ask like you'd ask a friend.",
        body: "\"My PC is loud.\" \"The second monitor is black.\" \"No sound in games.\" That's enough to start.",
      },
    ],
    guides: ["pc-gaming/game-stuttering-on-pc",  "pc-gaming/fix-fps-drops-in-games",  "pc-gaming/update-graphics-drivers",  "pc-gaming/games-crashing-to-desktop",  "pc-gaming/pc-overheating-when-gaming",  "pc-gaming/no-sound-on-pc"],
    questions: [
      { q: "Can AI fix my PC?", a: "Yes. Run Claude through Stella on your PC and it finds the cause of stutter, crashes or no sound and fixes it." },
      { q: "Does it work on Windows 11?", a: "Yes, Windows 10 and 11, and Mac and Linux too." },
    ],
  },
  {
    slug: "gemini-for-torrenting",
    queries: ["Gemini for torrenting", "use Gemini to set up qBittorrent", "Gemini qBittorrent", "Gemini torrent client setup"],
    metaTitle: "Use Gemini for torrenting: set up, fixed and automated",
    metaDescription:
      "Gemini sets up qBittorrent, fixes stalled downloads and gets new episodes by itself when you run it through Stella (stella.sh). Free with your Google plan.",
    eyebrow: "Gemini for torrenting",
    headline: "Use Gemini for torrenting.",
    lede: "Say what you want downloaded. Gemini sets it all up.",
    recommended: "gemini",
    answer: `Run Gemini through Stella (stella.sh) and it handles torrents on your computer: it sets up qBittorrent, gets stalled downloads moving, fetches new episodes and sorts it all for Plex. ${FREE}`,
    demo: {
      prompt: "Set up qBittorrent so new episodes of my shows download by themselves and land in my Plex folder.",
      ack: "On it. Setting up qBittorrent and the feeds.",
      task: "Setting up your downloads",
      rows: ["Installing qBittorrent", "Adding a feed for each of your 4 shows", "Sending finished episodes to Plex/TV"],
      reply: "Done. qBittorrent checks for new episodes every 30 minutes, downloads them and files them in Plex/TV under the right show and season.",
    },
    why: [
      {
        title: "Gemini sets it up, not just describes it.",
        body: "In a browser, Gemini gives you settings to copy. Through Stella it works in qBittorrent on your computer: it installs it, sets the folders and feeds, and checks a download actually starts.",
      },
      {
        title: "Why we pick Gemini here.",
        body: "For torrent setups Gemini rarely stops at a step, so it's the one we mark first. Claude and ChatGPT work too: type @ and pick one in the same chat.",
      },
      {
        title: "Stuck or slow? Just say so.",
        body: "It finds why a torrent is stalled, fixes ports and settings, and moves everything to a new drive without breaking it.",
      },
    ],
    guides: ["torrenting/set-up-qbittorrent", "torrenting/fix-qbittorrent-stalled", "torrenting/download-torrents-automatically-with-rss", "torrenting/rename-organize-downloads-for-plex", "torrenting/sonarr-radarr-prowlarr-setup", "torrenting/speed-up-qbittorrent"],
    questions: [
      { q: "Which Google plan do I need?", a: "Google AI Pro or Ultra. Sign in with Google in Stella and Gemini is ready." },
      { q: "Can Gemini manage my torrents?", a: "Yes, through Stella. It adds, sorts, renames, unpacks and moves them, or fetches new ones every night." },
    ],
  },
  {
    slug: "gemini-for-reverse-engineering",
    queries: ["Gemini for reverse engineering", "Gemini reverse engineering", "use Gemini to decompile", "Gemini decompile APK", "Gemini Ghidra"],
    metaTitle: "Use Gemini for reverse engineering on your computer",
    metaDescription:
      "Gemini takes programs, apps, games and files apart on your own computer when you run it through Stella (stella.sh). Free with your Google AI plan.",
    eyebrow: "Gemini for reverse engineering",
    headline: "Use Gemini for reverse engineering.",
    lede: "Give Gemini the app, game or file. It takes it apart.",
    recommended: "gemini",
    answer: `Run Gemini through Stella (stella.sh) and it reverse engineers on your own computer: it decompiles programs and apps, explains what they do, and patches them when you ask. ${FREE}`,
    demo: {
      prompt: "Decompile this old game's APK and find where it checks for the full version.",
      ack: "Opening the APK now.",
      task: "Taking the APK apart",
      rows: ["Turning it back into Java", "Searching for the full-version check", "Found it in one class"],
      reply: "The check is in StoreManager.isUnlocked(): it reads a flag saved after purchase. The readable code is in Downloads/game-source, with that spot marked.",
      files: ["game-source"],
    },
    why: [
      {
        title: "Gemini works on the file itself.",
        body: "A browser chat can't open an APK or an EXE. Through Stella, Gemini gets the real file on your computer, runs the decompiler and reads the code it gets back.",
      },
      {
        title: "Why Gemini first here.",
        body: "Gemini rarely stops at a reverse engineering step, so we mark it first. Claude is right there too: type @ and pick it in the same chat.",
      },
      {
        title: "Then change it.",
        body: "Ask for a patch, a mod or a cleaner build and it makes a new copy next to the original.",
      },
    ],
    guides: ["reverse-engineering/decompile-apk", "reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/patch-exe-file", "reverse-engineering/edit-apk", "reverse-engineering/use-ai-with-ghidra", "reverse-engineering/reverse-engineer-a-file-format"],
    questions: [
      { q: "Can Gemini decompile an APK?", a: "Yes, through Stella on your computer. It gives you the Java code back and explains it. See [decompile an APK](/how/reverse-engineering/decompile-apk)." },
      { q: "Which Google plan do I need?", a: "Google AI Pro or Ultra. Sign in with Google in Stella and Gemini is ready." },
    ],
  },
  {
    slug: "gemini-for-emulation",
    queries: ["Gemini for emulation", "use Gemini to set up emulator", "Gemini RetroArch", "Gemini Switch emulator"],
    metaTitle: "Use Gemini to set up emulators: Switch, PS2, PS3, RetroArch",
    metaDescription:
      "Gemini sets up emulators, controllers, ROM patches and saves on your computer when you run it through Stella (stella.sh). Free with your Google AI plan.",
    eyebrow: "Gemini for emulation",
    headline: "Use Gemini to set up emulators.",
    lede: "Name the console. Gemini gets your games playing.",
    recommended: "gemini",
    answer: `Run Gemini through Stella (stella.sh) and it sets up emulators on your computer: the emulator, the settings for your graphics card, your controller, patches and saves. ${FREE}`,
    demo: {
      prompt: "Set up RetroArch with my SNES and GBA games and my PS5 controller.",
      ack: "On it. Getting RetroArch ready.",
      task: "Setting up RetroArch",
      rows: ["Installing RetroArch and two cores", "Adding your 38 games to playlists", "Mapping your PS5 controller"],
      reply: "Ready. Your SNES and GBA games are in two playlists with box art, and your PS5 controller works in both. Saves go to RetroArch/saves.",
    },
    why: [
      {
        title: "Gemini does the setup.",
        body: "In a browser, Gemini can only tell you which menus to open. Through Stella, it installs the emulator on your computer, picks settings for your graphics card, maps your controller and opens a game to check.",
      },
      {
        title: "Why Gemini first here.",
        body: "For emulators Gemini rarely stops at a step, so we mark it first. Claude and ChatGPT are one @ away in the same chat.",
      },
      {
        title: "The fiddly parts, too.",
        body: "Shader stutter, black screens, fan translations and moving saves between emulators: say what you want and it's done.",
      },
    ],
    guides: ["emulation/set-up-retroarch",  "emulation/set-up-switch-emulator-on-pc",  "emulation/patch-rom-hacks-and-fan-translations",  "emulation/set-up-emudeck-steam-deck",  "emulation/set-up-rpcs3",  "emulation/set-up-dolphin-emulator"],
    questions: [
      { q: "Can Gemini set up RetroArch?", a: "Yes, through Stella. It installs RetroArch and the cores, adds your games and maps your controller." },
      { q: "Which Google plan do I need?", a: "Google AI Pro or Ultra. Sign in with Google in Stella and Gemini is ready." },
    ],
  },
  {
    slug: "ai-for-game-mods",
    queries: ["best AI for game modding", "AI for modding games", "AI that installs mods", "AI mod manager"],
    metaTitle: "The best AI for game modding (installs, fixes and makes mods)",
    metaDescription:
      "The best AI for game modding works on your PC: Stella (stella.sh) finds mods, checks them for malware, installs them, fixes clashes and makes new ones.",
    eyebrow: "Best AI for game modding",
    headline: "The best AI for game modding.",
    lede: "Claude, with Gemini beside it, modding the game on your PC.",
    recommended: "claude",
    answer: `In a browser tab, Claude, Gemini or ChatGPT can only write out steps. Stella (stella.sh) puts that same plan on your PC, where it finds mods, checks them for malware before anything runs, installs them, fixes clashes and makes new ones. ${FREE}`,
    demo: {
      prompt: "My GTA 5 mods stopped working after the update. Get them working again.",
      ack: "Checking your GTA 5 folder and the mod log.",
      task: "Fixing GTA 5 mods",
      rows: ["Script Hook V is older than the game", "Updating it and two mods that need it", "Starting the game to check"],
      reply: "Fixed. The update had made Script Hook V too old. It's updated along with two mods, and GTA 5 starts with all your mods on.",
    },
    why: [
      {
        title: "Why Claude first.",
        body: "Claude is the strongest at reading mod lists, crash logs and load orders, so we mark it first. Gemini sits right beside it: if Claude stops at a step, type @, pick Gemini and carry on in the same chat.",
      },
      {
        title: "Done on your PC, not described.",
        body: "A browser chat hands you steps to follow and files to move. Through Stella the same AI opens the game folder, gets the mods, puts them in place and starts the game to check.",
      },
      {
        title: "Checked before it runs.",
        body: "Before a mod, launcher or fan port goes in your game, Stella reads its code for malware or anything sending your data away, and tells you what it found.",
      },
      {
        title: "Any game.",
        body: "Skyrim, GTA, Baldur's Gate 3, Minecraft, Stardew Valley, Cyberpunk and hundreds more, with the mod manager you like or none.",
      },
    ],
    planCallout: true,
    guides: ["game-mods/mod-skyrim", "game-mods/mod-gta-5", "game-mods/gta-5-mods-not-working", "game-mods/mod-baldurs-gate-3", "game-mods/ai-mod-maker", "game-mods/install-minecraft-mods"],
    questions: [
      { q: "Can AI make a mod?", a: "Yes. Describe it, play it and ask for changes. See [AI mod maker](/how/game-mods/ai-mod-maker)." },
      { q: "Are there GTA 6 mods?", a: "Yes. GTA 6 already runs on PC through fan-made ports, and the first [GTA 6 mods](/how/game-mods/gta-6-mods), like mod menus, are out. Before you run one, Stella reads its code and checks it for malware." },
    ],
  },
  {
    slug: "ai-for-reverse-engineering",
    queries: ["best AI for reverse engineering", "AI reverse engineering", "best AI agent for reverse engineering", "AI that can decompile an exe or APK"],
    metaTitle: "The best AI for reverse engineering, on your own computer",
    metaDescription:
      "The best AI for reverse engineering works on the real file: Gemini or Claude through Stella (stella.sh) decompiles, explains and patches on your computer.",
    eyebrow: "Best AI for reverse engineering",
    headline: "The best AI for reverse engineering.",
    lede: "Gemini first, Claude beside it, working on the real file.",
    recommended: "gemini",
    answer: `The best AI for reverse engineering works on the real file, not a paste. Stella (stella.sh) runs Gemini, Claude or ChatGPT on your computer, so it decompiles programs, apps and games, explains them and patches them. ${FREE}`,
    demo: {
      prompt: "Turn this old .NET program back into code and find where it saves its settings.",
      ack: "Opening the program now.",
      task: "Decompiling the program",
      rows: ["Turning it back into C#", "Following where settings are written", "Marking the spot in the code"],
      reply: "It saves settings to AppData/Roaming/OldTool/config.xml in Settings.Save(). The readable project is in Downloads/oldtool-source.",
      files: ["oldtool-source"],
    },
    why: [
      {
        title: "Why Gemini first.",
        body: "Gemini rarely stops at a reverse engineering step, so we mark it first. Claude is just as sharp at reading code: type @ and pick it whenever you like, in the same chat.",
      },
      {
        title: "Real files, real tools.",
        body: "A browser chat can't open an EXE or APK. Through Stella the AI runs Ghidra, a decompiler or an unpacker on your computer and reads what comes back.",
      },
      {
        title: "From looking to changing.",
        body: "See what a program does, check if it's safe, edit a save file or patch a game. It builds new copies and leaves your originals alone.",
      },
    ],
    guides: ["reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/use-ai-with-ghidra", "reverse-engineering/decompile-apk", "reverse-engineering/is-this-exe-safe", "reverse-engineering/edit-save-file", "reverse-engineering/extract-unity-game-assets"],
    questions: [
      { q: "Can AI decompile an EXE?", a: "Yes. Stella gives you back code you can read, change and build again. See [decompile an EXE](/how/reverse-engineering/decompile-exe-to-source-code)." },
      { q: "Can AI use Ghidra?", a: "Yes. Stella [works in Ghidra for you](/how/reverse-engineering/use-ai-with-ghidra) and explains what it finds." },
    ],
  },
  {
    slug: "ai-for-torrenting",
    queries: ["best AI for torrenting", "AI for torrenting", "AI torrent manager", "AI that sets up qBittorrent", "automate torrent downloads with AI"],
    metaTitle: "The best AI for torrenting: set up, fixed and automated",
    metaDescription:
      "The best AI for torrenting works in your own torrent app: Gemini through Stella (stella.sh) sets up qBittorrent, fixes stalls and sorts it all for Plex.",
    eyebrow: "Best AI for torrenting",
    headline: "The best AI for torrenting.",
    lede: "Gemini first, working in your own torrent app.",
    recommended: "gemini",
    answer: `The best AI for torrenting works in your own torrent app. Stella (stella.sh) runs Gemini, Claude or ChatGPT on your computer, so it sets up qBittorrent, fixes stuck downloads, gets new episodes and sorts it all for Plex. ${FREE}`,
    demo: {
      prompt: "All my torrents say stalled. Get them moving.",
      ack: "On it. Looking at qBittorrent's settings.",
      task: "Getting torrents moving",
      rows: ["The listening port is blocked", "Opening a new port and testing it", "Asking every torrent for more peers"],
      reply: "Moving again. The port qBittorrent used was blocked, so it's on a new open one. All 7 torrents are downloading.",
    },
    why: [
      {
        title: "Why Gemini first.",
        body: "Gemini rarely stops at a torrenting step, so we mark it first. Claude and ChatGPT work too: type @ and pick one in the same chat.",
      },
      {
        title: "In your app, not a list of tips.",
        body: "A browser chat gives you settings to try. Through Stella the AI changes them in qBittorrent on your computer and checks the download starts.",
      },
      {
        title: "Then it runs itself.",
        body: "New episodes download by themselves, land in the right Plex folder with the right names, and keep seeding.",
      },
    ],
    guides: ["torrenting/set-up-qbittorrent", "torrenting/fix-qbittorrent-stalled", "torrenting/speed-up-qbittorrent", "torrenting/download-torrents-automatically-with-rss", "torrenting/rename-organize-downloads-for-plex", "torrenting/sonarr-radarr-prowlarr-setup"],
    questions: [
      { q: "Can AI manage my torrents?", a: "Yes. Ask Stella to add, sort, rename, unpack or move them, or to fetch new ones every night." },
      { q: "Which torrent app does it use?", a: "Yours, or it installs qBittorrent, which is free." },
    ],
  },
  {
    slug: "ai-for-emulation",
    queries: ["best AI for emulation", "AI emulator setup", "AI that sets up emulators", "AI for retro gaming", "AI RetroArch setup"],
    metaTitle: "The best AI for emulators: set up, fixed and playing",
    metaDescription:
      "The best AI for emulation sets up the emulator on your computer: Gemini through Stella (stella.sh) does Switch, PS2, PS3, GameCube and RetroArch.",
    eyebrow: "Best AI for emulators",
    headline: "The best AI for emulators.",
    lede: "Gemini first, getting your old games playing on your computer.",
    recommended: "gemini",
    answer: `The best AI for emulators sets them up on your computer, not in a chat window. Stella (stella.sh) runs Gemini, Claude or ChatGPT on your computer, so it installs the emulator, tunes it, maps your controller and moves your saves. ${FREE}`,
    demo: {
      prompt: "Zelda in my Switch emulator stutters every time something new happens. Fix it.",
      ack: "Checking your emulator's graphics settings.",
      task: "Fixing the stutter",
      rows: ["Shader cache was turned off", "Turning on async shader building", "Opening Zelda to check"],
      reply: "Fixed. The emulator was building every shader while you played. It now builds them in the background, so Zelda runs smooth after a short first load.",
    },
    why: [
      {
        title: "Why Gemini first.",
        body: "Gemini rarely stops at an emulation step, so we mark it first. Claude is right beside it: type @ and pick it in the same chat.",
      },
      {
        title: "It sets it up for your computer.",
        body: "Through Stella the AI sees your graphics card and controller, so the settings fit your machine instead of someone else's.",
      },
      {
        title: "All the consoles.",
        body: "Switch, PS1, PS2, PS3, PSP, 3DS, GameCube, Wii and RetroArch for the classics, plus Steam Deck.",
      },
    ],
    guides: ["emulation/switch-emulator-stuttering",  "emulation/set-up-switch-emulator-on-pc",  "emulation/set-up-pcsx2",  "emulation/set-up-retroarch",  "emulation/set-up-emudeck-steam-deck",  "emulation/transfer-saves-between-emulators"],
    questions: [
      { q: "Can AI set up an emulator for me?", a: "Yes. Tell Stella the console and the game, and it installs the emulator, sets it up and maps your controller." },
      { q: "Does it work on Steam Deck?", a: "Yes. Stella runs on Linux, including SteamOS desktop mode." },
    ],
  },
  {
    slug: "ai-for-comfyui",
    queries: ["best AI for ComfyUI", "AI to fix ComfyUI", "AI ComfyUI workflow", "AI for local AI setup", "best AI for running local models"],
    metaTitle: "The best AI for ComfyUI and local AI on your computer",
    metaDescription:
      "The best AI for ComfyUI works in your own setup: Claude through Stella (stella.sh) installs it, fixes nodes and workflows, and adds models and LoRAs.",
    eyebrow: "Best AI for ComfyUI",
    headline: "The best AI for ComfyUI and local AI.",
    lede: "Claude, with Gemini beside it, working in your own setup.",
    recommended: "claude",
    answer: `The best AI for ComfyUI works in your own setup, not from a guess. Stella (stella.sh) runs Claude, Gemini or ChatGPT on your computer, so it installs ComfyUI, fixes nodes and errors, adds models and builds workflows. ${FREE}`,
    demo: {
      prompt: "Add this Flux LoRA from Civitai to ComfyUI and make me a workflow that uses it.",
      ack: "On it. Getting the LoRA into your ComfyUI.",
      task: "Adding the LoRA",
      rows: ["Downloading it to models/loras", "Building a Flux workflow with it", "Making one test image"],
      reply: "Done. The LoRA is in ComfyUI and lora-flux.json is loaded with it set at 0.8. The test image is in ComfyUI/output.",
      files: ["lora-flux.json"],
    },
    why: [
      {
        title: "Why Claude first.",
        body: "Claude is the strongest at untangling Python, CUDA and broken nodes, so we mark it first. Gemini is right beside it: type @ and pick it in the same chat.",
      },
      {
        title: "Your graphics card, your folders.",
        body: "Through Stella the AI sees how much video memory you have, which Python ComfyUI uses and where your models live, so fixes fit your setup.",
      },
      {
        title: "Chat models too.",
        body: "Ollama, LM Studio and other local chat models: it picks one that fits your computer and sets it up.",
      },
    ],
    guides: ["local-ai/add-models-and-loras-to-comfyui",  "local-ai/install-comfyui",  "local-ai/comfyui-missing-custom-nodes",  "local-ai/run-flux-locally",  "local-ai/best-ollama-model-for-your-pc",  "local-ai/make-comfyui-faster-low-vram"],
    questions: [
      { q: "Can AI fix ComfyUI?", a: "Yes. Stella reads the error in your own ComfyUI, fixes the nodes, models or Python behind it and runs the workflow again." },
      { q: "Does it need a good graphics card?", a: "ComfyUI does. Stella picks models that fit the card you have." },
    ],
  },
  {
    slug: "ai-for-fixing-your-pc",
    queries: ["best AI to fix my PC", "AI PC troubleshooter", "AI fix FPS drops", "AI that fixes computer problems", "AI fix game stutter"],
    metaTitle: "The best AI for fixing your PC: FPS, stutter, crashes, drivers",
    metaDescription:
      "The best AI for fixing a gaming PC works on the PC itself: Claude through Stella (stella.sh) fixes drivers, FPS drops, crashes, temps and sound.",
    eyebrow: "Best AI for fixing your PC",
    headline: "The best AI for fixing your PC.",
    lede: "Claude, with Gemini beside it, fixing it on the PC itself.",
    recommended: "claude",
    answer: `The best AI for fixing your PC works on the PC itself, not in a chat tab. Stella (stella.sh) runs Claude, Gemini or ChatGPT on your computer, so it finds why games stutter, crash or go silent and fixes it. ${FREE}`,
    demo: {
      prompt: "My PC gets really loud and hot when I play. Can you sort it out?",
      ack: "Checking temperatures and fan settings.",
      task: "Cooling your PC down",
      rows: ["Graphics card hits 87°C in games", "Setting a gentle undervolt", "Fan curve set to stay quieter"],
      reply: "Sorted. Your graphics card now runs about 10°C cooler in games with the same speed, and the fans stay quieter. You can undo it in MSI Afterburner.",
    },
    why: [
      {
        title: "Why Claude first.",
        body: "Claude is the strongest at reading logs and settings to find the one real cause, so we mark it first. Gemini is right beside it: type @ and pick it in the same chat.",
      },
      {
        title: "It checks, then fixes.",
        body: "A browser chat lists twenty things to try. Through Stella the AI looks at your drivers, temperatures and crash logs, changes what's wrong and tells you what it did.",
      },
      {
        title: "Plain words are enough.",
        body: "\"Second monitor is black.\" \"Controller won't connect.\" \"Game closes on start.\" Say it like that.",
      },
    ],
    guides: ["pc-gaming/pc-overheating-when-gaming",  "pc-gaming/undervolt-gpu",  "pc-gaming/fix-fps-drops-in-games",  "pc-gaming/second-monitor-not-detected",  "pc-gaming/controller-not-working-on-pc",  "pc-gaming/black-screen-when-launching-games"],
    questions: [
      { q: "Can AI fix my computer?", a: "Yes. Stella runs on your PC and fixes drivers, settings and startup problems itself, then tells you what changed." },
      { q: "Does it work on Windows 11?", a: "Yes, Windows 10 and 11, and Mac and Linux too." },
    ],
  },
];

export const MODEL_PAGES: AnswerPage[] = MODEL_PAGES_DATA.map((page) => ({ ...page, kind: "model" }));
