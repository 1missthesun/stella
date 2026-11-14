import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const GAME_MOD_PAGES: ProblemPage[] = [
  {
    slug: "install-sodium-iris-minecraft-1-21-fabric",
    niche: "game-mods",
    searchPhrases: [
      "install sodium and iris minecraft 1.21 fabric",
      "how to install iris shaders 1.21",
      "sodium iris mod menu fabric install",
      "how to install fabric mods 1.21",
      "iris requires sodium crash fix",
    ],
    title: "Install Sodium and Iris on Minecraft 1.21 (Fabric)",
    description:
      "Install Fabric, Sodium, Iris shaders and Mod Menu on Minecraft Java 1.21: the manual steps with matching versions, or let Stella (stella.sh) do it for you.",
    h1: "Install Sodium and Iris on Minecraft 1.21 (Fabric)",
    short: "Sodium, Iris and Mod Menu on 1.21",
    lede: "Fabric, Sodium, Iris and Mod Menu in matching versions, ready to play.",
    answer:
      "Install the Fabric loader for your exact 1.21 version, then put Sodium, Iris, Mod Menu and Fabric API (Mod Menu needs it) into your `.minecraft/mods` folder, every file built for that same version, and start the game from the Fabric profile. Most crashes come from one file built for a different version. Stella (stella.sh) can do the whole install on your computer: it picks versions that match, downloads them from Modrinth, checks each file and sets up a Fabric profile ready to play.",
    stellaSteps: [
      "Looks for Minecraft, the launcher and Java; on a computer without them it installs the official Minecraft Launcher and Java 21 first",
      "Picks one game version (1.21.1 in the recording) that Sodium, Iris, Mod Menu and Fabric API all support",
      "Downloads the mods, plus the libraries they depend on, from Modrinth, and checks every file against Modrinth's published checksums",
      "Runs Fabric's official installer and creates a named profile, leaving your other profiles and worlds alone",
      "Stops before signing in: you open the launcher, sign in with your Microsoft account, pick the profile and press Play",
    ],
    prompt: "Install Fabric for Minecraft 1.21.1 and add Sodium, Iris and Mod Menu so my game runs faster.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "A launcher profile named “Fabric 1.21.1 - Sodium + Iris” (Fabric Loader 0.20.1), with `sodium-fabric-0.8.13+mc1.21.1.jar`, `iris-fabric-1.8.14-beta.1+mc1.21.1.jar`, `modmenu-11.0.5.jar`, `fabric-api-0.116.18+1.21.1.jar` and `placeholder-api-2.4.2+1.21.jar` (a Mod Menu dependency) in the mods folder, each checked against Modrinth’s SHA-512. The computer had no launcher or Java, so Stella installed the official Minecraft Launcher and Temurin Java 21 too.",
      note: "Stella didn’t sign in or launch the game, because the test computer had no Minecraft account. The recording shows the chat; the work happened in the background.",
      video: {
        src: `${PROOFS}/minecraft/install-sodium-iris-fabric-1-21/proof.mp4`,
        cuts: webCuts("minecraft/install-sodium-iris-fabric-1-21"),
        poster: `${PROOFS}/minecraft/install-sodium-iris-fabric-1-21/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 49.1,
        realDuration: 424,
      },
      moments: [
        { at: 0, text: "The prompt, typed into Stella on a Linux computer." },
        { at: 8, text: "Sent. Stella starts the install as a task and keeps the chat free." },
        { at: 13, text: "Stella says it’s setting up a Fabric 1.21.1 profile, checking each mod matches, and leaving existing profiles and worlds alone." },
        { at: 21, text: "No Minecraft Launcher or Java on this computer, so Stella installs the official launcher and Java 21 first." },
        { at: 24, text: "About five minutes of background work, sped up 30×: downloads, checksum checks and the Fabric installer." },
        { at: 36, text: "Done: the “Fabric 1.21.1 - Sodium + Iris” profile with Sodium, Iris, Mod Menu and their dependencies. Signing in and pressing Play are left to you." },
      ],
    },
    manualTitle: "Do it yourself (about 15 minutes)",
    manualSteps: [
      {
        title: "Run 1.21 once without mods",
        body: "Open the official Minecraft Launcher, pick the 1.21 release you want under Installations, and start a world once. This downloads the game files Fabric builds on. Close the game afterwards.",
      },
      {
        title: "Install the Fabric loader",
        body: "Download the installer from [fabricmc.net/use/installer](https://fabricmc.net/use/installer/) (an .exe on Windows, a .jar everywhere else). Choose Client, the same Minecraft version, the newest loader, and click Install. A new `fabric-loader-1.21.x` profile appears in the launcher.",
      },
      {
        title: "Download the four mods for that exact version",
        body: "On [Modrinth](https://modrinth.com), open [Sodium](https://modrinth.com/mod/sodium), [Iris](https://modrinth.com/mod/iris), [Mod Menu](https://modrinth.com/mod/modmenu) and [Fabric API](https://modrinth.com/mod/fabric-api). On each, filter by Fabric and your game version and download the .jar. Iris needs a matching Sodium release, so take the newest of both for the same version.",
      },
      {
        title: "Put the files in your mods folder",
        body: "Open the mods folder: `%appdata%\\.minecraft\\mods` on Windows (paste it into the Run box with Win+R), `~/Library/Application Support/minecraft/mods` on Mac, `~/.minecraft/mods` on Linux. Create the folder if it doesn't exist, then drop the four .jar files in. Remove older copies of the same mods.",
      },
      {
        title: "Launch the Fabric profile and check",
        body: "Start the game from the Fabric profile. The title screen gains a Mods button (that's Mod Menu) listing Sodium and Iris, and Video Settings switches to Sodium's menu. If it crashes, open `logs/latest.log` and look for a line naming a mod and the version it needs.",
      },
      {
        title: "Add a shader pack",
        body: "Download a shader pack .zip (Complementary or BSL are common picks), then go to Options, Video Settings, Shader Packs, click Open Shader Pack Folder, drop the .zip in and select it. Don't unzip it. Lower the render distance if frames drop.",
      },
    ],
    limits: [
      "Java Edition only. Bedrock (the Microsoft Store and console version) uses add-ons, not Fabric mods.",
      "Stella only downloads from Modrinth, CurseForge and the projects' own sites. It won't fetch mods or cracked launchers from re-upload sites.",
      "It won't touch server anti-cheat or install mods a server bans. Check a server's rules before joining with mods.",
      "On Linux, Stella can't click inside the Minecraft Launcher. It installs Fabric with the official installer from the terminal instead, and you press Play yourself.",
      "It won't sign in to your Microsoft account for you. Signing in and pressing Play stay with you.",
      "Shaders cost real graphics power. On a weak or older laptop GPU, Stella can pick lighter settings, but it can't make shaders run smoothly on hardware that can't handle them.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Do I need Fabric API for Sodium and Iris?",
        a: "Sodium and Iris don't need it on their own, but Mod Menu does, and most other Fabric mods do too. Putting the matching Fabric API in your mods folder avoids a crash later.",
      },
      {
        q: "Why does the game say “Iris requires Sodium” or crash at startup?",
        a: "Your Iris and Sodium files don't match each other or your game version. Delete both, download the newest of each for exactly your Minecraft version, and launch again. `logs/latest.log` names the version it wanted.",
      },
      {
        q: "Can I use OptiFine with Sodium and Iris?",
        a: "No. OptiFine doesn't run on Fabric and conflicts with Sodium. Iris loads most OptiFine shader packs, so you usually don't need it.",
      },
      {
        q: "Will mods get me banned?",
        a: "Sodium, Iris and Mod Menu only change graphics and menus on your side, and they're allowed on most servers. Some servers ban client mods outright, so read their rules first.",
      },
    ],
    related: ["game-mods/minecraft-modpack-exit-code-1", "pc-cleanup/organize-downloads-folder", "game-mods/install-minecraft-resource-pack", "game-mods/install-minecraft-shaders"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Fabric installer", href: "https://fabricmc.net/use/installer/" },
      { label: "Sodium on Modrinth", href: "https://modrinth.com/mod/sodium" },
      { label: "Iris on Modrinth", href: "https://modrinth.com/mod/iris" },
      { label: "Mod Menu on Modrinth", href: "https://modrinth.com/mod/modmenu" },
    ],
  },
  {
    slug: "minecraft-modpack-exit-code-1",
    niche: "game-mods",
    searchPhrases: [
      "minecraft modpack crashing exit code 1",
      "curseforge modpack crashing on startup",
      "minecraft exit code 1 curseforge",
      "minecraft exit code 1 fabric",
      "how to add more ram to minecraft curseforge",
    ],
    title: "Minecraft modpack crashing with exit code 1? Fix it",
    description:
      "Exit code 1 only means Minecraft quit with an error. Find the real cause in the log (a missing or wrong mod, Java, RAM) and fix it, or let Stella (stella.sh) do it.",
    h1: "Minecraft modpack crashing with exit code 1? Find the real error",
    short: "Modpack crash, exit code 1",
    lede: "The log already says what broke. Here's how to read it, and the fix.",
    answer:
      "Exit code 1 only says Minecraft stopped with an error; the reason is in the pack's logs/latest.log or crash-reports folder. Usually it's a missing library mod such as Fabric API, a mod built for another Minecraft version, the wrong Java, or too little RAM. Read the last error, fix that one thing and launch again. Stella (stella.sh) reads the log and every mod's version, swaps the right files in and tests the pack before handing it back.",
    stellaSteps: [
      "Reads `logs/latest.log` and the newest crash report, then opens each mod jar to see which Minecraft version and libraries it needs",
      "Names the cause in plain words; in the recording, Fabric API was missing and Lithium was built for Minecraft 1.20.1 instead of 1.21.1",
      "Downloads the matching versions from Modrinth and checks each file's SHA-512 against the one Modrinth lists",
      "Moves the wrong jar into a dated `backups` folder instead of deleting it, and leaves the world and settings alone",
      "Starts a copy of the server as a test and reads its log until it says Done, then removes the test copy",
    ],
    prompt:
      "My modpack crashes on startup with exit code 1, can you find what's wrong and fix it? It's the server in Desktop/Fabric Friends SMP.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "Both causes found and fixed on the first try, with no follow-up: Stella added Fabric API 0.116.18 and swapped Lithium 0.11.4 (built for 1.20.1) for 0.15.4 for 1.21.1, keeping the old jar in a backup folder. Started afterwards with the pack's own start script, the server loaded 50 mods and reached “Done”.",
      note: "The pack is a small Fabric 1.21.1 server made for this run from real mods, with Fabric API left out and the wrong Lithium on purpose. Stella took 1 minute 52 seconds; the wait is sped up 10×.",
      video: {
        src: `${PROOFS}/game-mods/minecraft-modpack-exit-code-1/proof.mp4`,
        cuts: webCuts("game-mods/minecraft-modpack-exit-code-1"),
        poster: `${PROOFS}/game-mods/minecraft-modpack-exit-code-1/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 48.8,
        realDuration: 125,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The modpack server crashed earlier with exit code 1." },
        { at: 8, text: "The prompt is sent, with the folder the server is in." },
        { at: 13, text: "Stella replies that it's checking the server logs and mod files, and will keep the originals before changing anything." },
        { at: 14, text: "Reading the log and each mod, downloading the right versions and test-starting a copy, sped up 10×." },
        { at: 28, text: "Done: Fabric API was missing and Lithium was built for Minecraft 1.20.1. Both fixed, a test copy reached “Done”, and the old Lithium jar is in a backup folder." },
      ],
      shots: [
        {
          src: `${PROOFS}/game-mods/minecraft-modpack-exit-code-1/log.png`,
          alt: "Server log lines before and after. Before: Incompatible mods found, AppleSkin requires fabric-api which is missing, Lithium 0.11.4 requires Minecraft 1.20.1. After: Loading 50 mods, Starting minecraft server version 1.21.1, Done.",
          width: 1400,
          height: 570,
          caption: "The crash before, and our own start of the fixed server after the run.",
        },
      ],
    },
    manualTitle: "Fix it yourself",
    manualSteps: [
      {
        title: "Open the pack's own folder",
        body: "In the CurseForge app, open My Modpacks, click the pack's ⋮ menu and choose Open Folder. For a server, it's the folder with start.bat or start.sh. Everything you need is in `logs` and `crash-reports` inside it.",
      },
      {
        title: "Read the last real error",
        body: "Open `logs/latest.log` (or the newest file in `crash-reports`) in Notepad or TextEdit and search for ERROR, “requires” or “Caused by”. Fabric spells it out (“Mod AppleSkin requires any version of fabric-api, which is missing!”); Forge buries it near the bottom of a long stack trace.",
      },
      {
        title: "Add or swap the mod it names",
        body: "Download the missing library (Fabric API, Architectury, Cloth Config…) or the right version of the named mod from CurseForge or Modrinth. Pick the file for your exact Minecraft version and loader, put it in `mods`, and move the old one out rather than deleting it.",
      },
      {
        title: "Check Java and memory",
        body: "Minecraft 1.20.5 and newer need Java 21; 1.18 to 1.20.4 need Java 17. In CurseForge, Settings, Minecraft, Java Settings sets memory for every pack, and a pack's Profile Options can override it. Most packs want 6 to 8 GB, never more than two-thirds of your RAM.",
      },
      {
        title: "Launch again, one change at a time",
        body: "Start the pack after each fix and read the new log; fixing one error often reveals the next. If a pack updated itself and broke, CurseForge's ⋮ menu can switch it back to the previous version.",
      },
    ],
    limits: [
      "The recording is a Fabric server on Linux, where the log named both problems. A CurseForge client on Windows works the same way in the files, but Stella hasn't been recorded doing it there, and it doesn't sign in to your Minecraft account or launch the game for you.",
      "Forge and NeoForge crashes (mixin conflicts, client-only mods on a server, out-of-memory) are harder to read, and may take a few rounds of launch, read, fix.",
      "Stella doesn't say how to start the server again unless you ask; it's the same start.bat or start.sh as before.",
      "If the crash is in your graphics driver (an `hs_err_pid` file, or exit code -1073741819), mods aren't the cause; update the driver first.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What does exit code 1 mean in Minecraft?",
        a: "Only that Java exited with an error. It's the same code for a missing mod, a wrong Java version or a bad setting, which is why the log matters more than the number.",
      },
      {
        q: "Will more RAM fix exit code 1?",
        a: "Only when the log says the game ran out of memory. Too much RAM can cause stutters of its own, so read the error before raising the slider.",
      },
      {
        q: "What about MCDoctor and other crash log readers?",
        a: "MCDoctor.ai reads a pasted log and explains it, with a few free analyses a month. That helps you understand the crash; you still download and swap the mods yourself. Stella does both on your computer, and it's free with the ChatGPT or Claude plan you already have.",
      },
      {
        q: "I'm starting from a plain game. Where do I begin?",
        a: "Install a loader first, then add mods made for the same Minecraft version. The guide to [install Fabric, Sodium and Iris](/how/game-mods/install-sodium-iris-minecraft-1-21-fabric) walks through it, and Stella can do it in the same chat.",
      },
    ],
    related: ["game-mods/install-sodium-iris-minecraft-1-21-fabric", "pc-cleanup/organize-downloads-folder", "game-mods/allocate-more-ram-to-minecraft", "game-mods/install-minecraft-mods"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Minecraft Wiki: Java Edition system requirements and Java versions", href: "https://minecraft.wiki/w/Tutorial:Update_Java" },
      { label: "Fabric API on Modrinth", href: "https://modrinth.com/mod/fabric-api" },
      { label: "MCDoctor.ai", href: "https://mcdoctor.ai" },
    ],
  },
  {
    slug: "find-broken-sims-4-mods",
    // Held back from stella.sh until there's a recorded run (steps-only).
    draft: true,
    niche: "game-mods",
    searchPhrases: [
      "how to find broken mods sims 4",
      "sims 4 mod conflict detector",
      "sims 4 mods not working after update",
      "sims 4 lastexception",
      "sims 4 script mods not working",
    ],
    title: "Find broken Sims 4 mods after an update (free)",
    description:
      "Find the Sims 4 mods that broke after a patch: lastException files, a mod conflict detector, the 50/50 method, or Stella (stella.sh) reading the logs for you.",
    h1: "Find broken Sims 4 mods after an update",
    short: "Find broken Sims 4 mods",
    lede: "Find the mods a patch broke, update them, and get back in the game.",
    answer:
      "After a Sims 4 patch the game often switches mods off, and script mods built for the old version stop loading. Turn mods back on in Game Options, delete `localthumbcache.package`, then update or remove the mods your lastException files name; the 50/50 method finds the rest. Stella (stella.sh) does the folder work for you: it reads the exception files, checks creators' pages for updates, shows you the list and moves broken mods out when you say yes, because the prompt asks it to.",
    stellaSteps: [
      "Finds your Mods folder and the lastException files the game wrote when something failed",
      "Reads them and names the mods they point at, in plain words, instead of a wall of error text",
      "Opens each named mod's creator page in your browser to see whether a version for the new patch is out, and downloads it from there",
      "Shows you the list, then moves outdated or broken mods into a separate “Mods (disabled)” folder once you say yes, because the prompt asks for that, and deletes the thumbnail cache",
      "If nothing is named, runs the 50/50 split with you: it moves half the mods out, you test, and it narrows it down",
    ],
    prompt:
      "My Sims 4 mods stopped working after the latest update. Find the broken ones from my lastException files, check the creators' pages for updates, and move anything outdated into a disabled folder. Show me the list and ask before moving anything.",
    proof: {
      kind: "steps-only",
      reason: "We haven't recorded this one yet: it needs a Windows or Mac computer with The Sims 4 and a real broken Mods folder.",
    },
    manualSteps: [
      {
        title: "Turn mods back on",
        body: "Start the game, open Game Options, then Other, and tick both “Enable Custom Content and Mods” and “Script Mods Allowed”. Click Apply and restart the game. Patches often untick these, which looks exactly like every mod breaking at once.",
      },
      {
        title: "Delete the thumbnail cache",
        body: "With the game closed, open `Documents\\Electronic Arts\\The Sims 4` (`Documents/Electronic Arts/The Sims 4` on a Mac) and delete `localthumbcache.package`. The game rebuilds it on the next start, and it clears stale thumbnails that make custom content look missing.",
      },
      {
        title: "Read the lastException files",
        body: "In the same folder, open the newest `lastException` or `lastUIException` text file in Notepad or TextEdit. Look for mod names or file names ending in `.ts4script`. The free Better Exceptions mod rewrites these into plain advice and is worth installing first.",
      },
      {
        title: "Update the big script mods first",
        body: "Script mods such as MC Command Center, UI Cheats Extension and WickedWhims break most often after a patch. Get each new version from the creator's own site, Patreon or CurseForge page, delete the old files, then add the new ones. A status list like [Sarah Simmerxo's mod checker](https://sarahsimmerxo.com/mods/) shows which mods are confirmed broken or fixed.",
      },
      {
        title: "Check the folder depth",
        body: "Script files (`.ts4script`) only load from the Mods folder itself or one subfolder down. Package files (`.package`) can sit up to five folders deep. A mod buried too deep simply doesn't load, with no error at all.",
      },
      {
        title: "Run a mod conflict detector",
        body: "The free Mod Conflict Detector on Mod The Sims (Windows) scans your Mods folder for duplicate packages and mods that change the same thing. It hasn't been updated since 2018, so it won't spot a script mod that's outdated for the new patch; use it for clashes, and the steps above for breakage.",
      },
      {
        title: "Use the 50/50 method for the rest",
        body: "Move half of your Mods folder to the desktop and test. If the problem is gone, the culprit is in the half you moved; if not, it's in the half that stayed. Keep halving the guilty half until one file is left. Twelve rounds narrow down thousands of files.",
      },
    ],
    limits: [
      "Stella can't fix a mod its creator hasn't updated yet. Until then the right move is to take it out, and it says so rather than guessing at a patch.",
      "It downloads only from the creator's own pages, CurseForge or the links creators post. It won't fetch early-access Patreon mods from re-upload sites.",
      "It doesn't play-test for you. You start the game and say what happened; Stella reads the new exception files and goes on from there.",
      "If all you ever fix is The Sims, a dedicated scanner like the free [SimSweep](https://simsweep.com) or [TS4 Mod Hound](https://app.ts4modhound.com) may be all you need. Stella's difference is that it reads the logs, checks the pages and moves the files in one go, and handles your next problem that isn't about The Sims too.",
    ],
    platforms: ["windows", "mac"],
    faq: [
      {
        q: "What is a lastException file?",
        a: "It's a text file The Sims 4 writes when something goes wrong in the game's code, often because of a mod. It lists the error and, usually, the script file involved. Several can pile up; the newest one matters most.",
      },
      {
        q: "Do I have to delete all my mods after every patch?",
        a: "No. Most custom content (hair, clothes, furniture) keeps working. Script mods and mods that change game behaviour are the ones that break, so update or remove those and leave the rest.",
      },
      {
        q: "Why is my custom content not showing up in Create a Sim?",
        a: "Usually mods are switched off in Game Options, the thumbnail cache is stale, or the files are too many folders deep. Fix those three first; a broken script mod can also stop the menus from loading properly.",
      },
      {
        q: "Is there a tool that finds broken Sims 4 mods automatically?",
        a: "Yes, several: SimSweep has a free scanner, TS4 Mod Hound checks your folder against its list, and Sims 4 Mod Fixer is a dedicated desktop app. They're good at spotting known-broken files. Stella is a general assistant that does the same folder work alongside reading your logs and creators' pages.",
      },
    ],
    related: ["game-mods/cyberpunk-mods-not-working-after-2-5", "game-mods/install-sodium-iris-minecraft-1-21-fabric"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Sarah Simmerxo's mod checker", href: "https://sarahsimmerxo.com/mods/" },
      { label: "TS4 Mod Hound", href: "https://app.ts4modhound.com/" },
      { label: "SimSweep", href: "https://simsweep.com/" },
      { label: "Sims 4 Mod Fixer", href: "https://sims4modfixer.com/" },
      { label: "Mod Conflict Detector (Mod The Sims)", href: "https://modthesims.info/d/561550/mod-conflict-detector-update-03-03-2018.html" },
    ],
  },
  {
    slug: "cyberpunk-mods-not-working-after-2-5",
    // Held back from stella.sh until there's a recorded run (steps-only).
    draft: true,
    niche: "game-mods",
    searchPhrases: [
      "cyberpunk mods not working after update 2.5",
      "cyberpunk 2077 2.5 mods",
      "redscript compilation has failed",
      "cyber engine tweaks not working",
      "cyberpunk crashing on startup mods",
    ],
    title: "Cyberpunk 2077 mods not working after update 2.5? Fix it",
    description:
      "Cyberpunk 2077 mods broke with update 2.5? Update CET, RED4ext and redscript, read the logs, move out the mods that fail, or let Stella (stella.sh) do it on your PC.",
    h1: "Cyberpunk 2077 mods not working after update 2.5",
    short: "Cyberpunk mods after update 2.5",
    lede: "Update the frameworks, read the logs, and move out the mods that fail.",
    answer:
      "Update 2.5 (22 October 2026) changed the game code that script mods hook into, so older Cyber Engine Tweaks, RED4ext, redscript and their plugins stop loading, and one broken script switches off all the others. Update those frameworks to their 2.5 releases first, then read the logs and move out each mod that hasn't been updated. Stella (stella.sh) can do this on your PC: it reads the logs, updates the frameworks from their official pages and sets aside the mods that still fail.",
    stellaSteps: [
      "Finds your game folder and lists which frameworks you have (CET, RED4ext, redscript, ArchiveXL, TweakXL, Codeware) and their versions",
      "Compares them with the latest 2.5-ready releases on their GitHub and Nexus pages, and updates them from those official pages",
      "Reads `r6\\logs\\redscript.log` and the newest file in `red4ext\\logs` to find the mods that fail to load",
      "Moves those mods into a quarantine folder outside the game, with a note of where each came from, so they're easy to put back",
      "Has you start the game, then reads the logs again until redscript reports “Output successfully saved”",
    ],
    prompt:
      "My Cyberpunk 2077 mods stopped working after update 2.5. Update CET, RED4ext and redscript to their 2.5 versions, read the logs, and move out any mod that still breaks so the game starts.",
    proof: {
      kind: "steps-only",
      reason: "We haven't recorded this one yet: it needs a PC with Cyberpunk 2077 and a modded install that broke on 2.5.",
    },
    manualSteps: [
      {
        title: "Back up first",
        body: "Copy your saves from `%USERPROFILE%\\Saved Games\\CD Projekt Red\\Cyberpunk 2077` somewhere safe, and note which mods you use. In Steam, set the game to update only when you launch it, so the next patch doesn't surprise you again.",
      },
      {
        title: "Update the frameworks",
        body: "Install the 2.5 releases of the core tools over your game folder: Cyber Engine Tweaks 1.38.0 or later, RED4ext 1.31.0, redscript 0.5.32, then ArchiveXL, TweakXL and Codeware (which need RED4ext). Get them from their own GitHub or Nexus pages, and read each one's requirements.",
      },
      {
        title: "Game closes a few seconds after starting?",
        body: "A RED4ext plugin isn't ready for 2.5. Open the newest file in `red4ext\\logs`; the last lines name the plugin it was loading. Move that plugin's folder out of `red4ext\\plugins` and try again.",
      },
      {
        title: "“REDScript compilation has failed”?",
        body: "One incompatible script switches off every script mod. The message lists the files; move those mods out of `r6\\scripts`. When everything compiles, `r6\\logs\\redscript.log` ends with “Output successfully saved”.",
      },
      {
        title: "“Invalid native definitions”?",
        body: "A script mod needs a RED4ext plugin that's missing or out of date. Install the requirement listed on the mod's page, or move those scripts out of `r6\\scripts` until the plugin is updated.",
      },
      {
        title: "REDmod deploy stuck at script compilation?",
        body: "Since 2.5, REDmod deploys that include scripts fail at stage 2 of 5 even with an empty test mod. The community [REDmod 2.5 Deploy Fix](https://www.nexusmods.com/cyberpunk2077/mods/36429) addresses it. For simple mods, the game's new built-in Mods menu (run with mod.io) is another route.",
      },
    ],
    limits: [
      "Stella can't update a mod its author hasn't updated. It parks it in quarantine and tells you, so the rest of your mods work in the meantime.",
      "It only downloads from the frameworks' and mods' own GitHub and Nexus pages. No re-uploads, no paid early-access mods for free, and nothing that unlocks DLC you don't own.",
      "You launch the game and say how far it got. Stella reads the logs between tries; it doesn't play the game.",
      "On consoles, the in-game Mods menu is the only route, and Stella runs on your computer, so it can't help there. On Linux (Proton) it works with the files and logs only.",
    ],
    platforms: ["windows"],
    faq: [
      {
        q: "What changed for mods in Cyberpunk 2077 2.5?",
        a: "The update added official mod support through a Mods menu run with mod.io, with curated mods on PC, Mac and consoles. Nexus mods still work on PC, but mods that hook into the game's code broke until their authors updated them.",
      },
      {
        q: "Do I need to reinstall the game?",
        a: "Usually not. Move your mods out and start the game. If it still crashes with no mods at all, verify the game files in Steam or GOG; only then think about a reinstall.",
      },
      {
        q: "Where are the Cyberpunk mod logs?",
        a: "In the game folder: `r6\\logs\\redscript.log` for script mods, `red4ext\\logs` for plugins. If the Cyber Engine Tweaks overlay opens in game, CET itself is working.",
      },
      {
        q: "Will this happen again with the next patch?",
        a: "Probably. Script mods break whenever the game's code changes. Turning off automatic updates in Steam and waiting a few days for the frameworks to update avoids most of it.",
      },
    ],
    related: ["game-mods/find-broken-sims-4-mods", "game-mods/install-sodium-iris-minecraft-1-21-fabric"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "FMTweak: installing Cyberpunk mods after 2.5", href: "https://fmtweak.com/how-to-install-cyberpunk-2077-mods/" },
      { label: "REDmod 2.5 Deploy Fix (Nexus)", href: "https://www.nexusmods.com/cyberpunk2077/mods/36429" },
      { label: "Cyber Engine Tweaks", href: "https://github.com/maximegmd/CyberEngineTweaks" },
      { label: "redscript", href: "https://github.com/jac3km4/redscript" },
    ],
  },
  {
    slug: "install-minecraft-resource-pack",
    niche: "game-mods",
    searchPhrases: [
      "how to install resource packs minecraft",
      "how to install texture packs minecraft",
      "minecraft resource pack not showing up",
      "resource pack not showing in minecraft list",
      "texture pack zip inside folder minecraft",
    ],
    title: "Install a Minecraft resource pack (not showing up? Fix it)",
    description:
      "Put a resource or texture pack in the right folder and fix the usual reason it doesn't appear, a zip with an extra folder inside, or let Stella (stella.sh) do it.",
    h1: "How to install a Minecraft resource pack that isn't showing up",
    short: "Install a Minecraft resource pack",
    lede: "A pack that wouldn't appear, unpacked properly and switched on.",
    answer:
      "In Minecraft Java, go to Options, Resource Packs, Open Pack Folder, drop the pack's .zip in and move it to Selected. If it doesn't appear, open the zip: when pack.mcmeta sits inside another folder, Minecraft ignores the pack, so move that inner folder into resourcepacks instead. A pack made for another version shows as incompatible. Stella (stella.sh) finds the download, fixes the folder, installs the pack and switches it on.",
    stellaSteps: [
      "Finds the downloaded zip, still sitting in Downloads, and the game folder, and checks which Minecraft version you have (1.21.4 in the test)",
      "Opens the zip and spots the problem: everything was inside an extra folder, so pack.mcmeta wasn't at the top",
      "Checks the pack is only images and a settings file, with nothing that runs, and that it's made for your version",
      "Puts the pack in the resourcepacks folder with pack.mcmeta at its top level",
      "Backs up options.txt, then adds the pack to the enabled list, layered over the default textures, leaving every other setting alone",
    ],
    prompt:
      "I downloaded the Mossy Stone texture pack but it doesn't show up in Minecraft's resource pack list. Can you install it properly and turn it on?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The pack installed and switched on in about 1 minute 20 seconds. Checked afterwards against an answer key written before the run, at file level: the pack sits in resourcepacks with pack.mcmeta at its top, pack format 46 and all 8 textures intact, and options.txt lists it after vanilla with every other line unchanged. The download in Downloads was left as it was.",
      note: "Checked in the files only. The test computer has a Minecraft folder for version 1.21.4 but no copy of the game, so Minecraft wasn't launched and the pack wasn't seen in game. The pack is a small one made for this run. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/game-mods/install-minecraft-resource-pack/proof.mp4`,
        cuts: webCuts("game-mods/install-minecraft-resource-pack"),
        poster: `${PROOFS}/game-mods/install-minecraft-resource-pack/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 49.1,
        realDuration: 83,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The Mossy Stone pack zip is in Downloads, and Minecraft doesn't list it." },
        { at: 2.1, text: "The prompt: install it properly and turn it on." },
        { at: 16.9, text: "Stella replies with the usual causes (a folder too deep, the wrong version, the wrong game folder) and asks for the game to be closed first." },
        { at: 22.8, text: "Finding and installing the pack, sped up 2×." },
        { at: 35.1, text: "Done: two problems fixed, the zip was never moved and had an extra folder inside. The pack is installed and on, with settings backed up." },
      ],
    },
    manualTitle: "Install it yourself",
    manualSteps: [
      {
        title: "Open the resource pack folder",
        body: "Start Minecraft Java, go to Options, Resource Packs, and click Open Pack Folder. It opens `%APPDATA%\\.minecraft\\resourcepacks` on Windows, `~/Library/Application Support/minecraft/resourcepacks` on a Mac and `~/.minecraft/resourcepacks` on Linux.",
      },
      {
        title: "Drop the pack in",
        body: "Drag the downloaded .zip into that folder without unzipping it. Back in the game it appears under Available; click its arrow to move it to Selected, then Done. Packs higher in the Selected list win over those below.",
      },
      {
        title: "Not listed? Look inside the zip",
        body: "Open the zip. pack.mcmeta and the assets folder must be at the top. If you see a single folder that contains them, the pack is nested: unzip it and move that inner folder, the one holding pack.mcmeta, into resourcepacks. Minecraft loads folders as well as zips.",
      },
      {
        title: "“Made for an older or newer version”",
        body: "That warning comes from the pack format number in pack.mcmeta. Download the release made for your game version. Editing the number hides the warning but doesn't make missing or renamed textures appear.",
      },
      {
        title: "Still nothing? Check which game folder",
        body: "Launchers like CurseForge, Prism or Modrinth keep each instance in its own folder with its own resourcepacks. Use Open Pack Folder from inside the game you actually play, so the pack lands in the right place.",
      },
    ],
    limits: [
      "Checked in the files only: the test computer had no copy of Minecraft, so the game wasn't started and the textures weren't seen in game.",
      "Java Edition only. Bedrock packs (.mcpack files) install by opening them, and weren't covered.",
      "If Minecraft is open while options.txt is edited, the game can overwrite the change when it quits. Close it first, or switch the pack on in the menu yourself.",
      "Stella installs packs you've already downloaded, and checked this one held only images and a settings file. Get packs from the creator's page or a site like Modrinth or CurseForge.",
      "Recorded on Linux, where the game folder is ~/.minecraft. On a Mac or Windows PC the folder is different, as listed above, but the fix is the same.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is my resource pack not showing up in Minecraft?",
        a: "Most often the zip has an extra folder inside, so pack.mcmeta isn't at the top. Otherwise it's in another launcher instance's folder, or it's a Bedrock .mcpack. Packs for the wrong version still show, marked incompatible.",
      },
      {
        q: "Should I unzip resource packs?",
        a: "Not normally: Minecraft reads the zip directly. Unzip only to fix a nested pack, then move the inner folder that holds pack.mcmeta.",
      },
      {
        q: "Is a texture pack the same as a resource pack?",
        a: "Yes. Texture packs were renamed resource packs in Java 1.6, and they can change sounds, fonts and models as well as textures. Shader packs are different and need a mod such as Iris.",
      },
      {
        q: "Can Stella install shaders or mods too?",
        a: "Yes. See [install Sodium and Iris on 1.21](/how/game-mods/install-sodium-iris-minecraft-1-21-fabric) for shaders and performance mods, or [give Minecraft more RAM](/how/game-mods/allocate-more-ram-to-minecraft) if a modpack runs out of memory.",
      },
    ],
    related: ["game-mods/install-sodium-iris-minecraft-1-21-fabric", "game-mods/allocate-more-ram-to-minecraft", "game-mods/minecraft-modpack-exit-code-1", "game-mods/install-minecraft-shaders"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Minecraft Wiki: Tutorial: Loading a resource pack", href: "https://minecraft.wiki/w/Tutorial:Loading_a_resource_pack" },
      { label: "Minecraft Wiki: Pack format", href: "https://minecraft.wiki/w/Pack_format" },
    ],
  },
  {
    slug: "allocate-more-ram-to-minecraft",
    niche: "game-mods",
    searchPhrases: [
      "how to allocate more ram to minecraft",
      "minecraft out of memory error",
      "allocate more ram to minecraft modpack",
      "how to allocate more ram to minecraft curseforge",
      "minecraft java heap space crash",
    ],
    title: "Allocate more RAM to Minecraft for a modpack",
    description:
      "Fix a modpack that crashes out of memory: raise -Xmx in the launcher's JVM arguments or CurseForge's memory slider, or let Stella (stella.sh) set a safe amount.",
    h1: "How to allocate more RAM to Minecraft and stop out of memory crashes",
    short: "Allocate more RAM to Minecraft",
    lede: "A modpack's memory raised from 2 GB to 6 GB, every other launcher setting kept.",
    answer:
      "In the official Minecraft Launcher, go to Installations, hover the modpack, click the three dots, Edit, More Options, and change `-Xmx2G` in JVM Arguments to `-Xmx6G`. In CurseForge, use Settings, Minecraft, Java Settings, Allocated Memory. 6 to 8 GB suits most modpacks; never give it more than half your computer's memory. Stella (stella.sh) reads the crash log to confirm memory is the cause, then raises it to a safe amount.",
    stellaSteps: [
      "Finds the launcher that runs the modpack and reads the crash report: the pack hit its 2 GB cap while loading the world",
      "Checks how much memory the computer has (about 62 GB on the test computer) and how big the pack is (20 mods) before choosing a number",
      "Changes `-Xmx2G` to `-Xmx6G` on the modpack's profile only, keeping its other Java flags and every other profile as they were",
      "Backs up the launcher settings first, so the change is easy to undo",
      "Doesn't start the game, and tells you to keep the launcher closed until you play, because it can overwrite the change when it closes",
    ],
    prompt: "Minecraft keeps crashing with an out of memory error when I play my modpack. Can you give it more RAM?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The modpack's profile raised from 2 GB to 6 GB in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run, at file level: launcher_profiles.json is still valid, the modpack profile has exactly one -Xmx, at 6 GB, with its original G1 flags kept, and the other profiles and launcher settings are unchanged.",
      note: "Checked in the files only. The test computer has a realistic launcher folder with a 20-mod pack, a crash report and an out-of-memory log, but no copy of the game, so Minecraft wasn't launched to confirm the crash is gone. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/game-mods/allocate-more-ram-to-minecraft/proof.mp4`,
        cuts: webCuts("game-mods/allocate-more-ram-to-minecraft"),
        poster: `${PROOFS}/game-mods/allocate-more-ram-to-minecraft/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 57.7,
        realDuration: 87,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer, with a Minecraft folder whose modpack crashed out of memory." },
        { at: 2.1, text: "The prompt: it keeps crashing with an out of memory error, give it more RAM." },
        { at: 25.7, text: "Stella replies: it'll check the crash log to confirm low memory is the cause, raise the limit to a safe amount, and not start the game." },
        { at: 31.6, text: "Reading the crash log and editing the launcher profile, sped up 2×." },
        { at: 43.7, text: "Done: 2 GB to 6 GB for the modpack, why 6 GB, what to do before playing, and what a crash at 6 GB would mean." },
      ],
    },
    manualTitle: "Change it yourself",
    manualSteps: [
      {
        title: "Make sure it's really memory",
        body: "Open the newest file in the pack's crash-reports folder, or logs/latest.log, and search for OutOfMemoryError or “Java heap space”. If the crash names a mod or a missing dependency instead, more RAM won't help.",
      },
      {
        title: "Official launcher: edit the JVM arguments",
        body: "Open the Minecraft Launcher, choose Installations, hover over the modpack's installation, click the three dots, Edit, then More Options. In JVM Arguments, change the number in `-Xmx2G` to `-Xmx6G`, leave the rest of the line alone, and click Save.",
      },
      {
        title: "CurseForge, Prism and other launchers",
        body: "In the CurseForge app, go to Settings, Minecraft, Java Settings and move the Allocated Memory slider; it applies to all its modpacks. Prism Launcher and the Modrinth app set memory per instance in that instance's settings.",
      },
      {
        title: "Pick a sensible amount",
        body: "About 4 GB is plenty for unmodded play and 6 to 8 GB for most modpacks; go higher only for very large packs. Leave at least half your computer's memory for everything else: on an 8 GB laptop, 4 GB is the ceiling. Far too much can cause longer stutters.",
      },
      {
        title: "Test it",
        body: "Start the modpack and load the world that crashed. Press F3: the Mem line shows the new maximum. If it still crashes with memory to spare, a mod is probably leaking memory; check that mod's issue tracker.",
      },
    ],
    limits: [
      "Checked in the files only: the test computer had no copy of Minecraft, so the game wasn't launched and the fix wasn't play-tested.",
      "More RAM only fixes out-of-memory crashes. Stella read the crash log first for that reason; a crash from a broken or mismatched mod needs a different fix.",
      "It edits the official launcher's settings file, which the launcher can overwrite if it's open at the time. Close it before asking.",
      "Recorded on Linux, where the game folder is ~/.minecraft. On Windows it's %APPDATA%\\.minecraft and on a Mac ~/Library/Application Support/minecraft; other launchers keep their own settings, which this run didn't cover.",
      "The crash log and launcher settings go to the AI model you use in Stella while it reads them.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How much RAM should I give Minecraft?",
        a: "About 2 to 4 GB for unmodded play, 6 to 8 GB for most modpacks, and never more than half your computer's memory. Past that point more isn't better: it can make the game pause for longer.",
      },
      {
        q: "Why does it still run out of memory after I added RAM?",
        a: "Either the change didn't stick (the launcher was open and overwrote it), it went on a different installation, or a mod is leaking memory. The F3 screen's Mem line tells you whether the new limit is in effect.",
      },
      {
        q: "Do I need 64-bit Java?",
        a: "Only if you set a custom Java path: 32-bit Java can't use more than about 1.5 GB. The official launcher's bundled Java is 64-bit, so most players never need to think about it.",
      },
      {
        q: "What if the modpack crashes with exit code 1 instead?",
        a: "Then it's usually a missing or mismatched mod, not memory. See [modpack crashing with exit code 1](/how/game-mods/minecraft-modpack-exit-code-1). Textures not loading is a different fix: [install a resource pack](/how/game-mods/install-minecraft-resource-pack).",
      },
    ],
    related: ["game-mods/minecraft-modpack-exit-code-1", "game-mods/install-minecraft-resource-pack", "game-mods/install-sodium-iris-minecraft-1-21-fabric"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Nodecraft: How to allocate more RAM to Minecraft launchers", href: "https://nodecraft.com/support/games/minecraft/how-to-allocate-more-ram-to-minecraft-launchers" },
      { label: "CurseForge: How to allocate more RAM to Minecraft", href: "https://blog.curseforge.com/how-to-allocate-more-ram-to-minecraft/" },
    ],
  },
  // ---- batch 3 (writer 2) ----
  {
    slug: "install-minecraft-mods",
    niche: "game-mods",
    searchPhrases: [
      "how to install minecraft mods",
      "minecraft mods not showing up",
      "how to install fabric mods",
      "minecraft mods folder",
      "minecraft duplicate mods found",
    ],
    title: "Install Minecraft mods (and why they don't show up)",
    description:
      "Mods only load from the mods folder, built for your loader and game version, one copy each. Sort the jars by hand or let Stella (stella.sh) install the ones that work.",
    h1: "How to install Minecraft mods, and why yours don't show up",
    short: "Install Minecraft mods",
    lede: "A Downloads folder of mixed jars sorted: what installs, what can't, and why.",
    answer:
      "Minecraft only loads mods from the `mods` folder of the profile you launch, and only jars built for that profile's loader (Fabric or Forge) and exact game version. Put each mod in once, remove older copies, and add the library mods they need. Stella (stella.sh) reads every jar in your Downloads, installs the ones that match your Fabric version, moves out the duplicates and tells you which ones can't work and why.",
    stellaSteps: [
      "Opens each downloaded jar and reads its built-in description (`fabric.mod.json` or Forge's `mods.toml`) for the loader, Minecraft version and required mods",
      "Installs the five that fit Fabric 1.21.4, one copy each: AppleCore HUD had been downloaded twice",
      "Moves the old Swift Render 0.5.1 into a backup folder so it doesn't clash with the new 0.6.2, which would stop Fabric from starting",
      "Spots that one zip is a texture pack, not a mod, and puts it with your resource packs",
      "Leaves out the Forge-only mod and the one built for 1.20.1, says why for each, and reminds you to launch the Fabric profile",
    ],
    prompt:
      "I downloaded a bunch of Minecraft mods into my Downloads for my Fabric 1.21.4 game but they don't show up. Install the ones that will work and tell me which ones won't.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Sorted in under a minute and a half. Checked afterwards against an answer key written before the run, by reading the mods folder: exactly one jar each of Fabric API, Swift Render (0.6.2 only), Lantern Lights, Cloth Config, Hearth Menu and AppleCore HUD; the Forge mod, the 1.20.1 mod and the resource pack kept out of it. Stella named both mods that won't work and why.",
      note: "File-level check only: the test computer had no Minecraft account and the game was never launched. The mods are fictitious stand-ins with real mod metadata inside, made for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/game-mods/install-minecraft-mods/proof.mp4`,
        cuts: webCuts("game-mods/install-minecraft-mods"),
        poster: `${PROOFS}/game-mods/install-minecraft-mods/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.9,
        realDuration: 88,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Downloads holds a mix of mod jars, a duplicate and a texture pack." },
        { at: 1.7, text: "The prompt: install the mods that work with Fabric 1.21.4 and say which won't." },
        { at: 12.7, text: "Stella replies that it will check each mod against Fabric 1.21.4 first." },
        { at: 19.4, text: "Reading every jar and installing, sped up 3×." },
        { at: 31.2, text: "Done: five mods and the texture pack installed, the old Swift Render moved aside, and the Forge and 1.20.1 mods explained." },
      ],
    },
    manualTitle: "Install them yourself",
    manualSteps: [
      {
        title: "Know your loader and version",
        body: "Open the Minecraft Launcher, Installations, and look at the profile you play: it says something like `fabric-loader-1.21.4`. Every mod you add must say Fabric (or Quilt) and 1.21.4 on its download page. A Forge or NeoForge mod won't load on Fabric, and the reverse.",
      },
      {
        title: "Open the mods folder",
        body: "Windows: press Win+R and paste `%appdata%\\.minecraft\\mods`. Mac: in Finder, Go, Go to Folder, `~/Library/Application Support/minecraft/mods`. Linux: `~/.minecraft/mods`. Create the folder if it's missing. Launchers like Prism or CurseForge have their own mods folder per instance.",
      },
      {
        title: "Copy in one jar per mod",
        body: "Drag in the right jars from Downloads. Files named `something (1).jar` are second downloads; leave them out. If you're updating a mod, delete or move its old version out first: two copies stop Fabric with a “Duplicate mods found” error.",
      },
      {
        title: "Add what they depend on",
        body: "Most Fabric mods need Fabric API, and many need a library such as Cloth Config. The mod's page lists these under Dependencies. Download the versions for the same game version.",
      },
      {
        title: "Launch the right profile",
        body: "Pick the Fabric profile in the launcher, not the plain Latest release one, and press Play. If it stops with “Incompatible mods found”, the message names the mod and what it wanted; remove or replace that one and try again.",
      },
    ],
    limits: [
      "This was checked at file level only: no Minecraft account was used and the game wasn't launched, so a mod that is broken inside would only show when you play.",
      "Forge-only mods can't run on Fabric. Stella says so instead of forcing them in; you need a Fabric build or a Forge profile.",
      "Stella installs the files you downloaded. To fetch new mods, it uses Modrinth, CurseForge or the project's own site, never re-upload sites.",
      "Recorded on Linux, where the game folder is `~/.minecraft`. On Windows it's `%appdata%\\.minecraft`, on a Mac `~/Library/Application Support/minecraft`; Stella finds it either way.",
      "Only file names and the mods' built-in descriptions go to the AI model you use in Stella.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why don't my Minecraft mods show up?",
        a: "Usually they're still in Downloads, in the wrong profile's folder, or you launched the plain profile instead of Fabric or Forge. A jar for another loader or game version is also skipped or stops the game.",
      },
      {
        q: "What does “Duplicate mods found” mean?",
        a: "Two jars with the same mod inside are in the mods folder, often an old and a new version or a `(1)` second download. Keep one.",
      },
      {
        q: "Can I use Forge mods with Fabric?",
        a: "No. They're built for different loaders. Look for a Fabric version of the mod, or make a separate Forge profile for it.",
      },
      {
        q: "Do I need Sodium and Iris too?",
        a: "Only for better performance and shaders. See [Sodium and Iris on 1.21](/how/game-mods/install-sodium-iris-minecraft-1-21-fabric), and if the game crashes at start, [exit code 1](/how/game-mods/minecraft-modpack-exit-code-1).",
      },
    ],
    related: ["game-mods/install-sodium-iris-minecraft-1-21-fabric", "game-mods/minecraft-modpack-exit-code-1", "game-mods/install-minecraft-shaders"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Fabric documentation: Installing mods", href: "https://docs.fabricmc.net/players/installing-mods" },
      { label: "Minecraft Wiki: .minecraft folder", href: "https://minecraft.wiki/w/.minecraft" },
    ],
  },
  {
    slug: "install-minecraft-shaders",
    niche: "game-mods",
    searchPhrases: [
      "how to install minecraft shaders",
      "minecraft shaders not showing up",
      "shaders not showing up in shader packs iris",
      "minecraft shaderpacks folder",
      "minecraft shaders not working",
    ],
    title: "Minecraft shaders not showing up? Install them right",
    description:
      "A shader pack only appears in Iris if its zip sits in the shaderpacks folder, not resourcepacks, with shaders/ at the top. Fix it by hand or let Stella (stella.sh) do it.",
    h1: "Minecraft shaders not showing up in the Shader Packs list",
    short: "Install Minecraft shaders",
    lede: "A shader zip in the wrong folder, moved where Iris looks and switched on.",
    answer:
      "Shader packs go in `.minecraft/shaderpacks` as the zip you downloaded, not in `resourcepacks` and not unzipped one folder too deep. Iris lists a pack only when the `shaders` folder is at the top of the zip. In the game: Options, Video Settings, Shader Packs, Open Shader Pack Folder, drop the zip in, select it and Apply. Stella (stella.sh) finds where the pack ended up, moves it, and switches it on in Iris's settings file.",
    stellaSteps: [
      "Looks for the Lumen pack and finds it in the resource packs folder, where Iris never looks",
      "Checks the zip has the `shaders` folder at its top level, so it doesn't need re-packing",
      "Moves it into `shaderpacks` and removes the stray copy from resource packs",
      "Edits Iris's settings file to select Lumen and turn shaders on, leaving the other settings and your mods alone",
      "Tells you to start the game with the Fabric profile, and that it hasn't launched the game to see it running",
    ],
    prompt:
      "I put the Lumen shaders zip in Minecraft but it doesn't show up in the Shader Packs list. Iris is already installed. Can you fix it and turn the shader on?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Fixed in about 75 seconds. Checked afterwards against an answer key written before the run: the pack in `shaderpacks` with `shaders/` at its top and all 7 shader files; Iris set to use it with shaders switched on and its other settings kept; mods and game options untouched; the stray copy gone from resource packs.",
      note: "File-level check only: no Minecraft account was used and the game was never launched, so the shader wasn't seen rendering. The Lumen pack is a stand-in made for this run. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/game-mods/install-minecraft-shaders/proof.mp4`,
        cuts: webCuts("game-mods/install-minecraft-shaders"),
        poster: `${PROOFS}/game-mods/install-minecraft-shaders/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.1,
        realDuration: 78,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer with a Fabric 1.21.4 setup and Iris installed." },
        { at: 2.2, text: "The prompt: the Lumen shader doesn't appear in Shader Packs; fix it and turn it on." },
        { at: 17.2, text: "Stella replies that it's looking into why Iris doesn't list the pack." },
        { at: 23, text: "Finding and moving the pack, sped up 2×." },
        { at: 32.9, text: "Done: the zip was in resource packs; it's now in shaderpacks and switched on for the next launch." },
      ],
    },
    manualTitle: "Fix it yourself",
    manualSteps: [
      {
        title: "Make sure Iris (or OptiFine) is running",
        body: "Shaders need a shader mod. In the game, Options, Video Settings should have a Shader Packs button. If it doesn't, you launched a profile without Iris: pick the Fabric profile, or [install Sodium and Iris](/how/game-mods/install-sodium-iris-minecraft-1-21-fabric) first.",
      },
      {
        title: "Open the shaderpacks folder from the game",
        body: "Options, Video Settings, Shader Packs, Open Shader Pack Folder. This opens the right folder for the profile you're in, which matters with launchers that keep separate instances.",
      },
      {
        title: "Drop the zip in, unopened",
        body: "Move the shader .zip from Downloads (or from `resourcepacks`, if you put it there) into this folder. Don't unzip it. If you did unzip it, the folder you keep must contain a `shaders` folder directly inside it, not another folder first.",
      },
      {
        title: "Check what's inside an odd download",
        body: "Some sites wrap the real pack in a second zip or folder with a readme. Open it: if you see `shaders` at the top, that's the pack. If you see another folder or zip, that inner one is the pack to use.",
      },
      {
        title: "Select it and apply",
        body: "Back in Shader Packs, click the pack name, then Apply and Done. If it's still missing, press the refresh by closing and reopening the menu. Lower render distance or shader quality if frames drop.",
      },
    ],
    limits: [
      "Checked at file level only: no Minecraft account was used and the game wasn't launched, so we didn't see the shader render.",
      "Shaders need a capable graphics card. Stella can switch a pack on and choose lighter settings, but it can't make a weak laptop run one smoothly.",
      "Iris rewrites its settings file when the game closes, so quit Minecraft before asking Stella to change shader settings.",
      "Recorded on Linux (`~/.minecraft`). On Windows the folder is `%appdata%\\.minecraft\\shaderpacks`, on a Mac `~/Library/Application Support/minecraft/shaderpacks`.",
      "Only folder and file names and Iris's small settings file go to the AI model you use in Stella.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is my shader in the resource packs list instead?",
        a: "You put it in `resourcepacks`. Resource packs change textures; shader packs change lighting and need Iris or OptiFine. Move the zip to `shaderpacks`.",
      },
      {
        q: "Do I need to unzip shaders?",
        a: "No. Leave the zip as it is. Iris reads zips directly, as long as `shaders` is the first folder inside.",
      },
      {
        q: "Why is there no Shader Packs button?",
        a: "Iris isn't loaded: you launched the plain profile, or Iris doesn't match your game version. See [install Minecraft mods](/how/game-mods/install-minecraft-mods) for how loaders and versions must match.",
      },
      {
        q: "What's the difference between shaders and resource packs?",
        a: "Resource packs swap textures and sounds and need no mods: see [install a resource pack](/how/game-mods/install-minecraft-resource-pack). Shaders add lighting, shadows and water effects and need a shader mod.",
      },
    ],
    related: ["game-mods/install-sodium-iris-minecraft-1-21-fabric", "game-mods/install-minecraft-resource-pack", "game-mods/install-minecraft-mods"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Iris Shaders", href: "https://irisshaders.dev/" },
      { label: "Iris on GitHub", href: "https://github.com/IrisShaders/Iris" },
    ],
  },
  {
    slug: "install-minecraft-map",
    niche: "game-mods",
    searchPhrases: [
      "how to install minecraft maps",
      "how to download minecraft maps",
      "how to import minecraft worlds",
      "minecraft world download not showing up",
      "how to install minecraft worlds java",
    ],
    title: "Install a downloaded Minecraft map (Java) so it shows up",
    description:
      "A downloaded map only appears in Singleplayer when its folder with level.dat sits directly in saves. Unzip it the right way by hand, or let Stella (stella.sh) put it in.",
    h1: "Install a downloaded Minecraft map so it shows up in Singleplayer",
    short: "Install a Minecraft map",
    lede: "A Skyblock map zipped one folder too deep, put where Singleplayer lists it.",
    answer:
      "Unzip the download and find the folder that contains `level.dat`: that folder, not the one around it, goes into `.minecraft/saves`. Many map zips wrap it in an extra folder with a readme (and a `__MACOSX` folder from a Mac), so the game never lists it. Stella (stella.sh) unpacks the map, finds the real world folder, copies just that into saves, and tells you which game version the map was made for.",
    stellaSteps: [
      "Finds the Skyblock Classic zip in Downloads and looks inside: the world sits a folder deeper than the game expects, next to a readme and Mac junk files",
      "Finds your game folder; with more than one Minecraft install, it uses the one played most recently",
      "Copies only the real world folder (the one holding `level.dat`) into saves, without the wrapper, readme or `__MACOSX` files",
      "Reads the map's level.dat for the version it was made for (Java 1.21.4) and checks your launcher has it",
      "Leaves your existing worlds and the original zip as they were",
    ],
    prompt:
      "I downloaded a Minecraft map called Skyblock Classic. It's in my Downloads. Can you put it in so it shows up in my singleplayer worlds?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Installed in about 70 seconds. Checked afterwards against an answer key written before the run: the map sits one level below saves with its level.dat, all 8 map files intact, the two existing worlds untouched, no `__MACOSX` junk and no empty wrapper folder in saves.",
      note: "File-level check only: no Minecraft account was used and the game was never launched. The map is a stand-in made for this run, zipped the way many map sites ship them. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/game-mods/install-minecraft-map/proof.mp4`,
        cuts: webCuts("game-mods/install-minecraft-map"),
        poster: `${PROOFS}/game-mods/install-minecraft-map/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.1,
        realDuration: 72,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A downloaded map zip is in Downloads." },
        { at: 1.7, text: "The prompt: put Skyblock Classic in so it shows up in Singleplayer." },
        { at: 15.7, text: "Stella replies that it will unpack it, copy the world into saves and say which version it's for." },
        { at: 21.5, text: "Unpacking and installing, sped up 2×." },
        { at: 30.8, text: "Done: the map will show as “Skyblock Classic”, made for 1.21.4, and the other worlds weren't changed." },
      ],
    },
    manualTitle: "Install it yourself",
    manualSteps: [
      {
        title: "Unzip the download",
        body: "Windows: right-click the zip, Extract All. Mac: double-click it. You get a folder; open it.",
      },
      {
        title: "Find the folder with level.dat",
        body: "Keep opening folders until you see `level.dat` alongside a `region` folder. The folder that holds those is the world. Ignore readme files, changelogs and any `__MACOSX` folder.",
      },
      {
        title: "Open your saves folder",
        body: "Windows: Win+R, `%appdata%\\.minecraft\\saves`. Mac: Finder, Go, Go to Folder, `~/Library/Application Support/minecraft/saves`. Linux: `~/.minecraft/saves`. Launchers with instances (Prism, CurseForge) have a `saves` folder inside each instance.",
      },
      {
        title: "Copy in the world folder",
        body: "Drag the folder that contains `level.dat` into saves. If a world with the same folder name already exists, rename the new one first so nothing is overwritten.",
      },
      {
        title: "Open Singleplayer",
        body: "Start the game (or go back to the title screen) and open Singleplayer. The map is listed by its own name. If the game warns the world was made in a newer version, update the game or choose a version of the map that matches.",
      },
    ],
    limits: [
      "Checked at file level only: no Minecraft account was used and the game wasn't launched.",
      "Java maps only. Bedrock maps come as `.mcworld` files, which you open by double-clicking.",
      "A map built for a newer version may not load in an older game. Stella reads the version from the map and tells you.",
      "Only download maps from sites you trust. Stella installs the file you give it; it doesn't vet the map maker.",
      "Recorded on Linux. On Windows and Mac the saves folder is in a different place (above); Stella looks in the usual places for each.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why doesn't my downloaded map show up in Minecraft?",
        a: "Almost always it's one folder too deep: saves contains a folder that contains the world folder. Move the inner folder, the one with `level.dat`, directly into saves.",
      },
      {
        q: "Do I need to unzip a Minecraft map?",
        a: "Yes, for Java. The game reads world folders, not zips. (Bedrock's `.mcworld` files are the exception: double-click to import.)",
      },
      {
        q: "Can I play a map made for an older version?",
        a: "Usually yes; the game upgrades it when you open it. Make a [backup of the world](/how/game-mods/back-up-minecraft-worlds) first, because you can't go back to the older version after.",
      },
      {
        q: "How do I turn on cheats in a downloaded map?",
        a: "Most adventure maps want cheats off. If you want them on for good, see [turn on cheats in an existing world](/how/game-mods/turn-on-cheats-in-minecraft-world).",
      },
    ],
    related: ["game-mods/back-up-minecraft-worlds", "game-mods/turn-on-cheats-in-minecraft-world", "game-mods/install-minecraft-resource-pack"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Minecraft Wiki: Tutorial: Map downloads", href: "https://minecraft.wiki/w/Tutorial:Map_downloads" },
      { label: "Minecraft Wiki: .minecraft folder", href: "https://minecraft.wiki/w/.minecraft" },
    ],
  },
  {
    slug: "back-up-minecraft-worlds",
    niche: "game-mods",
    searchPhrases: [
      "how to backup minecraft worlds",
      "how to transfer minecraft worlds from pc to pc",
      "minecraft saves folder",
      "how to restore minecraft world from backup",
      "back up minecraft worlds java",
    ],
    title: "Back up Minecraft worlds and move them to a new PC",
    description:
      "Back up every Minecraft Java world, including ones inside Prism or CurseForge instances, as zips you can move to a new computer: by hand, or with Stella (stella.sh).",
    h1: "Back up all your Minecraft worlds and move them to a new computer",
    short: "Back up Minecraft worlds",
    lede: "Every world zipped, including the modded one hidden inside a launcher instance.",
    answer:
      "Close Minecraft, open your saves folder, and zip each world folder (right-click, Send to, Compressed folder on Windows; Compress on a Mac). Don't forget launchers like Prism, CurseForge or the Modrinth App: each instance has its own saves folder, which is where modded worlds live. Stella (stella.sh) finds every world on the computer, zips each one, checks the zips open, and leaves the originals alone.",
    stellaSteps: [
      "Searches for worlds in the regular game folder and in other launchers' instances; it found three regular worlds and a modded one inside a Prism instance",
      "Zips each world on its own, so you can restore one without the others, into a dated Minecraft Backups folder in your home folder",
      "Opens each zip again to check it isn't damaged, and leaves the original worlds unchanged",
      "Because the new computer wasn't connected to Stella yet, also uploads the zips to your Stella Drive and checks the uploaded copies match",
      "Explains where each world goes on the new computer, including that the modded world needs an instance with the same mods",
    ],
    prompt: "Back up all my Minecraft worlds so I don't lose them. I want to copy the backups to my new computer.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Four worlds backed up in about 90 seconds. Checked afterwards against an answer key written before the run: each of the four worlds, including the one inside the Prism instance, is in a zip outside the game folders with every file byte-identical to the original, and the original worlds are unchanged.",
      note: "File-level check only: no Minecraft account was used and the game was never launched. The worlds are stand-ins made for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/game-mods/back-up-minecraft-worlds/proof.mp4`,
        cuts: webCuts("game-mods/back-up-minecraft-worlds"),
        poster: `${PROOFS}/game-mods/back-up-minecraft-worlds/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 49.6,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer with three regular Minecraft worlds and a modded one in a Prism instance." },
        { at: 1.7, text: "The prompt: back up all my worlds; I want to copy them to my new computer." },
        { at: 17.7, text: "Stella replies that it will look in every launcher, and that the backups will also go to the Stella Drive for the new computer." },
        { at: 23.7, text: "Finding, zipping and checking the worlds, sped up 3×." },
        { at: 35.4, text: "Done: four worlds, one zip each, on this computer and in the Drive, with steps for the new computer." },
      ],
    },
    manualTitle: "Back them up yourself",
    manualSteps: [
      {
        title: "Quit Minecraft",
        body: "Close the game completely so no world is half-saved while you copy it.",
      },
      {
        title: "Open the saves folder",
        body: "Windows: Win+R, paste `%appdata%\\.minecraft\\saves`. Mac: Finder, Go, Go to Folder, `~/Library/Application Support/minecraft/saves`. Linux: `~/.minecraft/saves`. Each folder in there is one world.",
      },
      {
        title: "Zip each world",
        body: "Windows: right-click a world folder, Send to, Compressed (zipped) folder. Mac: right-click, Compress. Zipping each world separately lets you restore just one later.",
      },
      {
        title: "Check your launchers",
        body: "Prism, CurseForge, the Modrinth App and others keep worlds per instance. In the launcher, right-click the instance and open its folder; the worlds are in `saves` (or `minecraft/saves`). Zip those too, and note which instance each came from.",
      },
      {
        title: "Copy to the new computer",
        body: "Put the zips on a USB stick or cloud drive. On the new computer, unzip each into the saves folder there, so `saves/<world>/level.dat` exists. Modded worlds go into an instance with the same mods and game version.",
      },
    ],
    limits: [
      "Checked at file level only: no Minecraft account was used and the game wasn't launched.",
      "In this run Stella uploaded the backup zips to the user's own Stella Drive so the new computer could download them. If you'd rather keep them local, say “only on this computer” or name a USB drive.",
      "Close Minecraft first. A world that's open while it's copied can be caught mid-save.",
      "Stella copies backups between your own computers once both are signed in to Stella; it can't reach a computer that isn't.",
      "Recorded on Linux; on Windows and Mac the game folder is elsewhere (above). Only folder names go to the AI model; the world files themselves aren't read by it.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Where are my Minecraft worlds saved?",
        a: "In the `saves` folder inside `.minecraft` (paths above), plus a separate `saves` folder in each launcher instance if you use Prism, CurseForge or the Modrinth App.",
      },
      {
        q: "How do I restore a world from a backup?",
        a: "Quit the game, unzip the backup into saves so the folder with `level.dat` sits directly inside, and open Singleplayer. The same steps as [installing a downloaded map](/how/game-mods/install-minecraft-map).",
      },
      {
        q: "Can Bedrock worlds be backed up the same way?",
        a: "Bedrock worlds export from the game itself: Edit world, Export World, which makes a `.mcworld` file. This page covers Java Edition.",
      },
      {
        q: "My world won't load. Will a backup help?",
        a: "If you have one, yes. If not, the game keeps its own backup of the world's settings file, which fixes most crashes after a power cut: see [fix a corrupted Minecraft world](/how/game-mods/fix-corrupted-minecraft-world).",
      },
    ],
    related: ["game-mods/fix-corrupted-minecraft-world", "game-mods/install-minecraft-map", "game-mods/turn-on-cheats-in-minecraft-world"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Minecraft Wiki: .minecraft folder (saves)", href: "https://minecraft.wiki/w/.minecraft" },
      { label: "Prism Launcher wiki", href: "https://prismlauncher.org/wiki/" },
    ],
  },
  {
    slug: "fix-corrupted-minecraft-world",
    niche: "game-mods",
    searchPhrases: [
      "minecraft world corrupted",
      "how to fix corrupted minecraft world",
      "minecraft world won't load after crash",
      "minecraft level.dat_old",
      "how to restore minecraft world to previous save",
    ],
    title: "Fix a corrupted Minecraft world after a crash",
    description:
      "World won't load after a crash or power cut? Usually level.dat was wiped mid-save; swap in level.dat_old by hand, or let Stella (stella.sh) back it up and repair it.",
    h1: "Fix a Minecraft world that won't load after a crash",
    short: "Fix a corrupted Minecraft world",
    lede: "A world wiped mid-save by a dead battery, restored from the game's own backup.",
    answer:
      "When a laptop dies while Minecraft is saving, the world's `level.dat` (its main settings file) is often left empty, and the world won't open. The game keeps the previous version as `level.dat_old` in the same folder. Quit Minecraft, back up the world folder, rename the broken `level.dat`, and copy `level.dat_old` to `level.dat`. Your builds live in separate region files and are usually fine. Stella (stella.sh) backs up the world, finds what broke and does this swap for you.",
    stellaSteps: [
      "Copies the whole Riverbend world to a backup folder before changing anything, named so it doesn't appear as an extra world in the game",
      "Looks at the world's files and the game log, and finds the settings file was wiped (all zeros) while the region files with your builds look full-sized and intact",
      "Swaps in the backup copy Minecraft keeps from the previous save, and keeps the broken file and `level.dat_old` too",
      "Checks the restored file reads correctly: the same world name and seed, not a new world",
      "Says what you may lose (about the last five minutes of play) and that it couldn't open the game to test",
    ],
    prompt:
      "My Minecraft world Riverbend won't load since my laptop died while I was playing. Can you fix it without losing my builds?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Repaired in under 4 minutes. Checked afterwards against an answer key written before the run: level.dat loads again, it is Riverbend's with the original seed, region, player and data files untouched, the other world untouched, the broken level.dat kept as a copy and level.dat_old still there.",
      note: "File-level check only: no Minecraft account was used and the game was never launched. The world is a stand-in made for this run, broken the way a power cut mid-save breaks one. The work is sped up 16×.",
      video: {
        src: `${PROOFS}/game-mods/fix-corrupted-minecraft-world/proof.mp4`,
        cuts: webCuts("game-mods/fix-corrupted-minecraft-world"),
        poster: `${PROOFS}/game-mods/fix-corrupted-minecraft-world/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.7,
        realDuration: 235,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The world Riverbend won't load after the laptop died mid-game." },
        { at: 1.7, text: "The prompt: fix it without losing my builds." },
        { at: 15.7, text: "Stella replies that it will copy the whole world first, then find what broke." },
        { at: 21.7, text: "Backing up, diagnosing and repairing, sped up 16×." },
        { at: 33.7, text: "Done: the wiped settings file replaced with Minecraft's own backup, builds untouched, about five minutes of play lost." },
      ],
    },
    manualTitle: "Repair it yourself",
    manualSteps: [
      {
        title: "Quit Minecraft and back up the world",
        body: "Close the game. Open your saves folder (Windows `%appdata%\\.minecraft\\saves`, Mac `~/Library/Application Support/minecraft/saves`, Linux `~/.minecraft/saves`) and copy the whole world folder somewhere else first.",
      },
      {
        title: "Show file extensions",
        body: "On Windows, in File Explorer choose View, Show, File name extensions, so you can tell `level.dat` from `level.dat_old`. On a Mac, Finder, Settings, Advanced, Show all filename extensions.",
      },
      {
        title: "Look at level.dat",
        body: "Open the world folder. A `level.dat` of 0 KB, or much smaller than `level.dat_old`, is the broken one. The `logs/latest.log` file in `.minecraft` may also say “Not in GZIP format” for that world.",
      },
      {
        title: "Swap in level.dat_old",
        body: "Rename `level.dat` to `level.dat.broken`. Copy `level.dat_old`, and rename the copy to `level.dat`. Keep the original `level.dat_old` where it is.",
      },
      {
        title: "Open the world",
        body: "Start Minecraft and load the world. You'll be where you were at the previous save, a few minutes earlier. If chunks are missing or the game still crashes, the region files are damaged too: a region tool such as the free MCA Selector can remove the broken chunks so they regenerate.",
      },
    ],
    limits: [
      "Checked at file level only: no Minecraft account was used and the game wasn't launched to load the world.",
      "You lose whatever happened between the last two saves, usually a few minutes.",
      "If the region files themselves are damaged, some chunks can still be missing. That needs a region tool; Stella checks they look intact but can't vouch for every block.",
      "Recorded on Linux. The saves folder is elsewhere on Windows and Mac (above); the fix is the same.",
      "Only file names, sizes and the game log go to the AI model you use in Stella.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is level.dat_old?",
        a: "Minecraft's copy of the world's settings file from the previous save. When the current `level.dat` is wiped or cut short, the old one restores the world with only a few minutes lost.",
      },
      {
        q: "Will I lose my builds?",
        a: "Usually not. Builds are stored in the region files, separate from `level.dat`. You lose your position, inventory and anything built since the last autosave.",
      },
      {
        q: "There's no level.dat_old. What now?",
        a: "Use a backup if you have one. Without one, an NBT editor can make a new `level.dat` with the same seed, but player data and some settings are lost. Then [set up regular backups](/how/game-mods/back-up-minecraft-worlds).",
      },
      {
        q: "Can I stop this happening again?",
        a: "Quit the world before closing the laptop, keep it plugged in for long sessions, and keep zipped backups of worlds you care about.",
      },
    ],
    related: ["game-mods/back-up-minecraft-worlds", "game-mods/minecraft-modpack-exit-code-1", "game-mods/turn-on-cheats-in-minecraft-world"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Minecraft Wiki: level.dat", href: "https://minecraft.wiki/w/Level.dat" },
      { label: "Minecraft Wiki: Java Edition level format", href: "https://minecraft.wiki/w/Java_Edition_level_format" },
    ],
  },
  {
    slug: "turn-on-cheats-in-minecraft-world",
    niche: "game-mods",
    searchPhrases: [
      "how to turn on cheats in minecraft",
      "how to enable cheats in minecraft",
      "how to turn on cheats in minecraft java after creating world",
      "minecraft level.dat editor allowcommands",
      "how to change hardcore to survival",
    ],
    title: "Turn on cheats in an existing Minecraft world, for good",
    description:
      "Open to LAN turns cheats on only until you quit. To keep them, set allowCommands in level.dat with an NBT editor, or let Stella (stella.sh) change that one setting.",
    h1: "Turn on cheats in a Minecraft world you already made, permanently",
    short: "Turn on cheats in a world",
    lede: "Cheats switched on for one survival world, every other setting left alone.",
    answer:
      "The quick way: open the world, press Esc, Open to LAN, set Allow Commands to On and start the LAN world. It lasts until you quit, so you redo it every session. To keep cheats on, close Minecraft and set `allowCommands` to 1 in the world's `level.dat` with an NBT editor such as the free NBTExplorer. Stella (stella.sh) backs up that file and changes just that one setting.",
    stellaSteps: [
      "Finds Maple Hollow among your worlds",
      "Backs up its `level.dat` in the world folder, with a name that says what it's for",
      "Changes only the cheats setting (`allowCommands`) to on, leaving the game mode, difficulty, seed, your inventory and the game rules as they were",
      "Leaves your other two worlds untouched",
      "Tells you how to undo it, and to close the world first if it's open, because the game can overwrite the change when it saves",
    ],
    prompt:
      "I made a survival world called Maple Hollow in Minecraft without turning cheats on. Can you turn cheats on for that world for good? Don't touch my other worlds.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Done in under 1½ minutes. Checked afterwards against an answer key written before the run: Maple Hollow's level.dat still loads with cheats on, every other setting unchanged (game mode, hardcore, seed, player, rules), region, player and data files untouched, the other two worlds untouched, and a copy of the original level.dat kept.",
      note: "File-level check only: no Minecraft account was used and the game was never launched. The worlds are stand-ins with real level.dat files, made for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/game-mods/turn-on-cheats-in-minecraft-world/proof.mp4`,
        cuts: webCuts("game-mods/turn-on-cheats-in-minecraft-world"),
        poster: `${PROOFS}/game-mods/turn-on-cheats-in-minecraft-world/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.3,
        realDuration: 88,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer with three Minecraft worlds." },
        { at: 1.7, text: "The prompt: turn cheats on for good in Maple Hollow, and don't touch the other worlds." },
        { at: 17.7, text: "Stella replies that it will back up the settings file first and the world stays survival." },
        { at: 23.7, text: "Making the change, sped up 3×." },
        { at: 34.1, text: "Done: cheats on in Maple Hollow, still survival on Normal, the other worlds untouched, with how to undo it." },
      ],
    },
    manualTitle: "Do it yourself",
    manualSteps: [
      {
        title: "For one session: Open to LAN",
        body: "Load the world, press Esc, choose Open to LAN, set Allow Commands to On and click Start LAN World. Commands work until you leave the world. Next time, do it again.",
      },
      {
        title: "Permanent: close Minecraft and back up",
        body: "Quit the game completely, then copy the world's `level.dat` (in `saves/<world name>`) somewhere safe. Minecraft rewrites this file on exit, so an edit made with the game open is lost.",
      },
      {
        title: "Open level.dat in an NBT editor",
        body: "On Windows, the free NBTExplorer (from its GitHub page) opens it directly. On a Mac, NBTExplorer's build is old; a web NBT editor that runs in your browser is the usual choice. The file is gzip-compressed; the editor handles that.",
      },
      {
        title: "Set allowCommands to 1",
        body: "Expand Data and find `allowCommands`. Change it from 0 to 1 and keep its type (a byte). Change nothing else. Save, keeping gzip compression.",
      },
      {
        title: "Open the world",
        body: "Start Minecraft and load the world. Type `/time set day` to check. If the world won't load, put your backup `level.dat` back.",
      },
    ],
    limits: [
      "Checked at file level only: no Minecraft account was used and the game wasn't launched.",
      "Turning cheats on in a survival world disables advancements and achievements for that world. That's the game's rule.",
      "Java Edition only. Bedrock has a cheats switch in the world's settings, so no file edit is needed.",
      "Minecraft must be closed (or the world quit) when the change is made; the game rewrites level.dat when it saves.",
      "Recorded on Linux. On Windows and Mac the saves folder is elsewhere; the file and the setting are the same. Only world names and the settings file's values go to the AI model.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I turn on cheats after creating a world in Java?",
        a: "Yes. Open to LAN does it for one session; changing `allowCommands` in level.dat does it for good.",
      },
      {
        q: "Will turning on cheats stop achievements?",
        a: "Yes. Once a world has cheats on, the game stops granting advancements and achievements there, even if you turn them off again.",
      },
      {
        q: "Can I change a hardcore world to survival?",
        a: "The same file holds a `hardcore` setting. Ask Stella to set it to off (or change it in an NBT editor), and back the world up first: [back up Minecraft worlds](/how/game-mods/back-up-minecraft-worlds).",
      },
      {
        q: "My world won't open after editing level.dat. What now?",
        a: "Put your backup back. If you don't have one, the game's own `level.dat_old` usually works: see [fix a corrupted Minecraft world](/how/game-mods/fix-corrupted-minecraft-world).",
      },
    ],
    related: ["game-mods/back-up-minecraft-worlds", "game-mods/fix-corrupted-minecraft-world", "game-mods/install-minecraft-map"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Minecraft Wiki: Java Edition level format", href: "https://minecraft.wiki/w/Java_Edition_level_format" },
      { label: "Minecraft Wiki: Commands", href: "https://minecraft.wiki/w/Commands" },
      { label: "NBTExplorer on GitHub", href: "https://github.com/jaquadro/NBTExplorer" },
    ],
  },
];
