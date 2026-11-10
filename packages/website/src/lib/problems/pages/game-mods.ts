import { PROOFS } from "../media";
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
    related: ["game-mods/minecraft-modpack-exit-code-1", "game-mods/find-broken-sims-4-mods", "game-mods/cyberpunk-mods-not-working-after-2-5"],
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
    related: ["game-mods/install-sodium-iris-minecraft-1-21-fabric", "game-mods/find-broken-sims-4-mods"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Minecraft Wiki: Java Edition system requirements and Java versions", href: "https://minecraft.wiki/w/Tutorial:Update_Java" },
      { label: "Fabric API on Modrinth", href: "https://modrinth.com/mod/fabric-api" },
      { label: "MCDoctor.ai", href: "https://mcdoctor.ai" },
    ],
  },
  {
    slug: "find-broken-sims-4-mods",
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
    answer:
      "After a Sims 4 patch the game often switches mods off, and script mods built for the old version stop loading. Turn mods back on in Game Options, delete `localthumbcache.package`, then update or remove the mods your lastException files name; the 50/50 method finds the rest. Stella (stella.sh) does the folder work for you: it reads the exception files, checks creators' pages for updates and moves broken mods out, asking first.",
    stellaSteps: [
      "Finds your Mods folder and the lastException files the game wrote when something failed",
      "Reads them and names the mods they point at, in plain words, instead of a wall of error text",
      "Opens each named mod's creator page in your browser to see whether a version for the new patch is out, and downloads it from there",
      "Moves outdated or broken mods into a separate “Mods (disabled)” folder, asking first, and deletes the thumbnail cache",
      "If nothing is named, runs the 50/50 split with you: it moves half the mods out, you test, and it narrows it down",
    ],
    prompt:
      "My Sims 4 mods stopped working after the latest update. Find the broken ones from my lastException files, check the creators' pages for updates, and move anything outdated into a disabled folder.",
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
    answer:
      "Update 2.5 (22 October 2026) changed the game code that script mods hook into, so older Cyber Engine Tweaks, RED4ext, redscript and their plugins stop loading, and one broken script switches off all the others. Update those frameworks to their 2.5 releases first, then read the logs and move out each mod that hasn't been updated. Stella (stella.sh) can do this on your PC: it reads the logs, updates the frameworks from their official pages and sets aside the mods that still fail.",
    stellaSteps: [
      "Finds your game folder and lists which frameworks you have (CET, RED4ext, redscript, ArchiveXL, TweakXL, Codeware) and their versions",
      "Compares them with the latest 2.5-ready releases on their GitHub and Nexus pages, and updates them with your OK",
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
];
