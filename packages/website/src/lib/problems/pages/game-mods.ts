import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const GAME_MOD_PAGES: ProblemPage[] = [
  shortGuide({
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
      "Install Sodium and Iris on Minecraft 1.21 with Fabric, every version matched. Ask Stella (stella.sh) and it sets up the mods and a profile on your computer.",
    h1: "Install Sodium and Iris on Minecraft 1.21 (Fabric)",
    short: "Sodium, Iris and Mod Menu on 1.21",
    lede: "Faster Minecraft with shaders, installed and ready to play.",
    answer:
      "Install Fabric for your exact 1.21 version, then put Sodium and Iris built for that version in your mods folder. Stella (stella.sh) does it all and sets up a profile to play.",
    gets: [
      "All the mods built for one version",
      "A Fabric profile ready to play",
      "Other profiles and worlds left alone",
    ],
    prompt:
      "Install Fabric for Minecraft 1.21.1 and add Sodium, Iris and Mod Menu so my game runs faster.",
    demo: {
      ack: "On it. Matching every version.",
      task: "Installing Sodium and Iris",
      rows: ["Installing Fabric for 1.21.1", "Downloading Sodium, Iris and Mod Menu", "Creating a Fabric profile"],
      reply:
        "Done. In the Minecraft Launcher, pick **Fabric 1.21.1 - Sodium + Iris** and press Play. Sodium's menu and Shader Packs are under Video Settings.",
      files: [
        "sodium-fabric-0.8.13+mc1.21.1.jar",
        "iris-fabric-1.8.14-beta.1+mc1.21.1.jar",
        "fabric-api-0.116.18+1.21.1.jar",
      ],
    },
    faq: [
      ["Does Sodium need Fabric API?", "No, but Mod Menu does, with placeholder-api-2.4.2+1.21.jar, and so do most other Fabric mods."],
      ["Why does it say Iris requires Sodium, which is missing?", "Get the newest of both for your exact version, like Sodium 0.8.13 with Iris 1.8.14 on 1.21.1."],
      ["How do I open the Sodium menu?", "Options, then Video Settings. With Sodium installed, that screen is its menu."],
      ["Does it work on 1.21.10 or 1.21.11?", "Yes. Stella picks the newest builds for the version you play."],
    ],
    byHand: [
      "Run the installer from [fabricmc.net/use/installer](https://fabricmc.net/use/installer/): Client, your exact version, newest loader. Run it again to update Fabric.",
      "On Modrinth, get [Sodium](https://modrinth.com/mod/sodium), [Iris](https://modrinth.com/mod/iris), [Mod Menu](https://modrinth.com/mod/modmenu) and [Fabric API](https://modrinth.com/mod/fabric-api) for Fabric and your version.",
      "Put the .jar files in %appdata%\\.minecraft\\mods (Windows) or ~/Library/Application Support/minecraft/mods (Mac), and start the Fabric profile.",
    ],
    related: [
      "game-mods/minecraft-modpack-exit-code-1",
      "pc-cleanup/organize-downloads-folder",
      "game-mods/install-minecraft-resource-pack",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Minecraft modpack crashing with exit code 1? Stella (stella.sh) reads the log on your computer, swaps in the right mods and starts the pack again for you.",
    h1: "Minecraft modpack crashing with exit code 1? Find the real error",
    short: "Modpack crash, exit code 1",
    lede: "A modpack that crashes on start, running again.",
    answer:
      "Exit code 1 only means Minecraft stopped with an error. The cause is in the pack's latest.log, usually a missing or mismatched mod. Stella (stella.sh) reads the log, swaps in the right files and starts the pack.",
    gets: [
      "The real reason it crashed, in plain words",
      "The right mods swapped in",
      "The old files kept in a backup folder",
    ],
    prompt:
      "My Fabric Friends modpack server crashes on startup with exit code 1. Find what's wrong and fix it.",
    demo: {
      ack: "On it. Reading the crash log first.",
      task: "Fixing exit code 1",
      rows: ["Reading the log and crash report", "Checking every mod's version", "Starting the server to be sure"],
      reply:
        "Fixed. Fabric's core library mod was missing, and Lithium was built for 1.20.1, not 1.21.1. The server now starts with all 50 mods.",
    },
    faq: [
      ["What does exit code 1 mean in Minecraft?", "Only that Java stopped with an error. A missing mod, the wrong Java or a bad setting give the same code, so read the log."],
      ["What does Incompatible mods found mean?", "One mod needs another, or a different version of one. The message names both."],
      ["Will more RAM fix exit code 1?", "Only when the log says the game ran out of memory."],
    ],
    byHand: [
      "In CurseForge, open My Modpacks, click the pack's ⋮ menu → Open Folder, and open logs/latest.log.",
      "Search it for ERROR, “requires” or “Caused by”, then download the missing mod, often Fabric API, for your exact version.",
      "Minecraft 1.20.5 and newer need Java 21. Launch after each fix, since one error can hide the next.",
    ],
    related: [
      "game-mods/install-sodium-iris-minecraft-1-21-fabric",
      "pc-cleanup/organize-downloads-folder",
      "game-mods/allocate-more-ram-to-minecraft",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Sims 4 mods broken after an update? Stella (stella.sh) reads your lastException files, finds the broken mods, gets updates and moves the rest out of the way.",
    h1: "Find broken Sims 4 mods after an update",
    short: "Find broken Sims 4 mods",
    lede: "Your Sims 4 mods working again after a patch.",
    answer:
      "After a patch, the game often switches mods off. Stella (stella.sh) turns them back on, reads your lastException files, updates what it can and moves broken mods aside.",
    gets: [
      "The broken mods named, in plain words",
      "Updates from each creator's own page",
      "The rest moved to a separate folder",
    ],
    prompt:
      "My Sims 4 mods broke after the latest update. Find the broken ones, update what you can and move the rest out.",
    demo: {
      ack: "On it. Looking through your Mods folder.",
      task: "Finding broken Sims 4 mods",
      rows: ["Turning mods back on", "Reading your lastException files", "Checking creators' pages for updates"],
      reply:
        "Done. Mods are back on and the cache is cleared. Script mods with a new version are updated, and the broken ones are in Mods (disabled).",
    },
    faq: [
      ["What is a lastException file?", "A text file the game writes when something goes wrong, often because of a mod. The newest one usually names it."],
      ["Do I have to delete all my mods after every patch?", "No. Hair, clothes and furniture usually keep working. Script mods are the ones that break."],
      ["Is there a Sims 4 mod conflict detector?", "Yes, a free one on Mod The Sims finds duplicates and clashes, but not mods a patch made outdated."],
    ],
    byHand: [
      "In Game Options → Other, tick Enable Custom Content and Mods and Script Mods Allowed, then restart.",
      "With the game closed, delete localthumbcache.package from Documents\\Electronic Arts\\The Sims 4.",
      "Update the mods the newest lastException file names. For the rest, move half your mods out and test, halving each time.",
    ],
    related: ["game-mods/cyberpunk-mods-not-working-after-2-5", "game-mods/install-sodium-iris-minecraft-1-21-fabric"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Cyberpunk 2077 mods broken by update 2.5? Stella (stella.sh) finds which ones broke, updates everything it can and sets aside the rest.",
    h1: "Cyberpunk 2077 mods not working after update 2.5",
    short: "Cyberpunk mods after update 2.5",
    lede: "Your Cyberpunk mods loading again after update 2.5.",
    answer:
      "Update 2.5 broke what many mods rely on, and one broken mod can switch off all the others. Stella (stella.sh) updates what it can and moves out each mod that still fails.",
    gets: ["Your mods updated for 2.5", "The ones that still fail, set aside", "The game starting again"],
    prompt:
      "My Cyberpunk 2077 mods stopped working after update 2.5. Update them and move out any that still break.",
    demo: {
      ack: "On it. Finding what the update broke.",
      task: "Fixing Cyberpunk mods for 2.5",
      rows: ["Updating your mods", "Starting the game", "Setting aside the ones that fail"],
      reply:
        "Cyberpunk starts and your mods are back. Two have no 2.5 version yet, so they're in a folder called **Mods set aside**.",
    },
    faq: [
      ["Why does it say REDScript compilation has failed?", "One script mod isn't ready for 2.5, and it stops all the others. The message lists the files to move out."],
      ["Why is Cyber Engine Tweaks not working?", "Update 2.5 needs version 1.38.0 or later."],
      ["Do I need to reinstall the game?", "Usually not. If it still crashes with no mods, verify the game files in Steam or GOG."],
    ],
    byHand: [
      "Install Cyber Engine Tweaks 1.38.0 or later, RED4ext 1.31.0 and redscript 0.5.32, then ArchiveXL, TweakXL and Codeware.",
      "Game closes after a few seconds? The newest file in red4ext\\logs names the plugin to move out.",
      "REDScript compilation failed? Move the listed mods out of r6\\scripts until r6\\logs\\redscript.log says “Output successfully saved”.",
    ],
    related: ["game-mods/find-broken-sims-4-mods", "game-mods/install-sodium-iris-minecraft-1-21-fabric"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Minecraft resource pack not showing up? Stella (stella.sh) finds the download, fixes the folder inside the zip, installs the pack and switches it on for you.",
    h1: "How to install a Minecraft resource pack that isn't showing up",
    short: "Install a Minecraft resource pack",
    lede: "A resource pack that finally shows up, switched on.",
    answer:
      "Drop the pack's zip into the folder that Options, Resource Packs, Open Pack Folder opens. If it doesn't show up, it's usually wrapped in an extra folder. Stella (stella.sh) fixes that, installs it and switches it on.",
    gets: [
      "The pack in the right folder, fixed if needed",
      "Switched on, over the default look",
      "Your other settings left alone",
    ],
    prompt:
      "My Mossy Stone texture pack doesn't show up in Minecraft's resource pack list. Install it properly and turn it on.",
    demo: {
      ack: "On it. Looking inside the zip.",
      task: "Installing Mossy Stone",
      rows: ["Finding the download", "Spotting an extra folder inside", "Switching it on"],
      reply:
        "Done. Mossy Stone was wrapped in an extra folder, so Minecraft couldn't see it. It's now in your resource packs and switched on. Start Minecraft to see it.",
    },
    faq: [
      ["Why is my resource pack not showing up in Minecraft?", "Usually the zip holds an extra folder, so pack.mcmeta isn't at the top. Or it's in another launcher's folder."],
      ["Should I unzip resource packs?", "No. Minecraft reads the zip as it is."],
      ["Is a texture pack the same as a resource pack?", "Yes. Texture packs were renamed resource packs in Java 1.6. Shaders are different and need Iris."],
    ],
    byHand: [
      "Go to Options → Resource Packs → Open Pack Folder, drag the .zip in, then move it to Selected and click Done.",
      "Not listed? Open the zip. If pack.mcmeta sits inside another folder, move that inner folder into resourcepacks.",
      "Marked incompatible? Get the release for your version. With CurseForge or Prism, use Open Pack Folder from the game you play.",
    ],
    related: [
      "game-mods/install-sodium-iris-minecraft-1-21-fabric",
      "game-mods/allocate-more-ram-to-minecraft",
      "game-mods/minecraft-modpack-exit-code-1",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Minecraft running out of memory? Stella (stella.sh) checks the crash log, then gives your modpack more RAM on your computer, a safe amount for your machine.",
    h1: "How to allocate more RAM to Minecraft and stop out of memory crashes",
    short: "Allocate more RAM to Minecraft",
    lede: "More memory for your modpack, and no more out of memory crashes.",
    answer:
      "In the Minecraft Launcher, edit the modpack's installation, open More Options and raise the memory from 2G to 6G. Stella (stella.sh) checks the crash log and sets a safe amount for you.",
    gets: [
      "Memory confirmed as the cause first",
      "More RAM on that modpack only",
      "Your other profiles left as they were",
    ],
    prompt:
      "Minecraft keeps crashing with an out of memory error when I play my modpack. Can you give it more RAM?",
    demo: {
      ack: "On it. Checking the crash log first.",
      task: "Giving Minecraft more RAM",
      rows: ["Reading the crash report", "Raising the modpack to 6 GB"],
      reply:
        "Done. Your modpack hit its 2 GB limit loading the world, so it now has **6 GB**, on that modpack only. Keep the launcher closed until you play.",
    },
    faq: [
      ["How much RAM should I give Minecraft?", "2 to 4 GB for plain Minecraft, 6 to 8 GB for most modpacks, never more than half your computer's memory."],
      ["What does “not enough RAM available to launch this instance” mean?", "You set more memory than the computer can spare. Lower it, to at most half your RAM."],
      ["Why does it still run out of memory after I added RAM?", "The launcher was open and wrote over it, or it went on another installation. F3 in game shows the limit."],
    ],
    byHand: [
      "Minecraft Launcher: Installations, hover the modpack, three dots, Edit, More Options. In JVM Arguments change -Xmx2G to -Xmx6G and Save.",
      "CurseForge: Settings → Minecraft → Java Settings → Allocated Memory. Prism and the Modrinth app set it per instance.",
      "Load the world and press F3. The Mem line shows the new maximum.",
    ],
    related: [
      "game-mods/minecraft-modpack-exit-code-1",
      "game-mods/install-minecraft-resource-pack",
      "game-mods/install-sodium-iris-minecraft-1-21-fabric",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Minecraft mods not showing up? Stella (stella.sh) checks every mod you downloaded, installs the ones that fit your game and tells you which won't work and why.",
    h1: "How to install Minecraft mods, and why yours don't show up",
    short: "Install Minecraft mods",
    lede: "Your downloaded mods installed, and the ones that won't work named.",
    answer:
      "Minecraft only loads mods from your profile's mods folder, built for its Fabric or Forge and exact version. Stella (stella.sh) checks each download, installs what fits and names what won't.",
    gets: [
      "Every mod that fits, installed once",
      "Duplicates and old versions moved out",
      "Which mods won't work, and why",
    ],
    prompt:
      "My mods for Fabric 1.21.4 don't show up in Minecraft. Install the ones that will work and tell me which won't.",
    demo: {
      ack: "On it. Checking each mod you downloaded.",
      task: "Installing your mods",
      rows: ["Reading what each mod is made for", "Installing the ones that fit", "Moving an older copy aside"],
      reply:
        "Done. Six mods are installed, one copy each. One is made for Forge and one for 1.20.1, so they won't work. Start the Fabric profile to play.",
    },
    faq: [
      ["Why don't my Minecraft mods show up?", "They're still in Downloads, in another profile's folder, or you started the plain profile instead of Fabric or Forge."],
      ["What does “Duplicate mods found” mean?", "Two copies of one mod are in the mods folder, often an old and new version. Keep one."],
      ["Can I use Forge mods with Fabric?", "No. Find the Fabric version, or make a separate Forge profile."],
    ],
    byHand: [
      "Open the mods folder: Win+R and %appdata%\\.minecraft\\mods on Windows, ~/Library/Application Support/minecraft/mods on a Mac.",
      "Drag in one .jar per mod for your profile's version, such as fabric-loader-1.21.4, plus mods they need, like Fabric API.",
      "Pick the Fabric profile, not Latest release. If it says Incompatible mods found, replace the mod it names.",
    ],
    related: [
      "game-mods/install-sodium-iris-minecraft-1-21-fabric",
      "game-mods/minecraft-modpack-exit-code-1",
      "game-mods/install-minecraft-shaders",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Minecraft shaders not showing up in the Shader Packs list? Stella (stella.sh) moves the pack to the right folder on your computer and turns it on in Iris.",
    h1: "Minecraft shaders not showing up in the Shader Packs list",
    short: "Install Minecraft shaders",
    lede: "Your shader pack showing up and switched on.",
    answer:
      "Shader packs go in the shaderpacks folder, still zipped, not in resourcepacks. Open it from Options, Video Settings, Shader Packs. Stella (stella.sh) finds where your pack ended up, moves it and switches it on.",
    gets: ["The pack in the shaderpacks folder", "Shaders switched on in Iris", "Your mods and settings left alone"],
    prompt:
      "My Lumen shaders don't show up in the Shader Packs list, and Iris is installed. Fix it and turn the shader on.",
    demo: {
      ack: "On it. Looking for the Lumen pack.",
      task: "Turning on Lumen shaders",
      rows: ["Finding Lumen among your resource packs", "Moving it to shaderpacks", "Switching it on in Iris"],
      reply:
        "Done. Lumen was in your resource packs folder, where Iris never looks. It's now in shaderpacks and switched on. Start the Fabric profile to see it.",
    },
    faq: [
      ["Where is the shaders folder in Minecraft?", "%appdata%\\.minecraft\\shaderpacks on Windows, ~/Library/Application Support/minecraft/shaderpacks on a Mac."],
      ["Why is there no Shader Packs button?", "Iris isn't running: you started the plain profile, or Iris doesn't match your game version."],
      ["Do I need to unzip shaders?", "No. Iris reads the zip, as long as the shaders folder is the first thing inside."],
    ],
    byHand: [
      "No Shader Packs button in Video Settings? [Install Sodium and Iris](/how/game-mods/install-sodium-iris-minecraft-1-21-fabric) first.",
      "In Shader Packs, click Open Shader Pack Folder, drop the .zip in still zipped, then click the pack and Apply.",
      "Still missing? Open the zip. If you see another folder or zip instead of shaders, that inner one is the pack.",
    ],
    related: [
      "game-mods/install-sodium-iris-minecraft-1-21-fabric",
      "game-mods/install-minecraft-resource-pack",
      "game-mods/install-minecraft-mods",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Downloaded a Minecraft map that won't show up? Stella (stella.sh) unpacks it, finds the real world folder and puts it in your saves so it appears in Singleplayer.",
    h1: "Install a downloaded Minecraft map so it shows up in Singleplayer",
    short: "Install a Minecraft map",
    lede: "A downloaded map showing up in your worlds.",
    answer:
      "Unzip the map and find the folder holding level.dat: that folder goes in .minecraft/saves. Many zips add an extra folder, so the game never lists it. Stella (stella.sh) puts just the real world in place for you.",
    gets: ["The map in your Singleplayer list", "Readme and junk files left out", "Which game version it was made for"],
    prompt:
      "I downloaded a Minecraft map called Skyblock Classic. It's in my Downloads. Can you put it in so it shows up in my singleplayer worlds?",
    demo: {
      ack: "On it. Unpacking Skyblock Classic.",
      task: "Installing Skyblock Classic",
      rows: ["Looking inside the download", "Finding the real world folder", "Copying it into your saves"],
      reply:
        "Done. Skyblock Classic is in your Singleplayer list. It sat a folder too deep, next to a readme and Mac junk files, which I left out. It's made for Java 1.21.4, which your launcher has.",
    },
    faq: [
      ["Why doesn't my downloaded map show up in Minecraft?", "It's almost always one folder too deep. Move the inner folder, the one with level.dat, straight into saves."],
      ["Do I need to unzip a Minecraft map?", "Yes, for Java. Bedrock .mcworld files are different: double-click them to import."],
    ],
    byHand: [
      "Unzip the download, then keep opening folders until you see level.dat next to a region folder. That folder is the world.",
      "Open saves: Win+R and %appdata%\\.minecraft\\saves on Windows, or ~/Library/Application Support/minecraft/saves on a Mac.",
      "Drag the world folder in, renaming it first if a world with that name exists, then open Singleplayer.",
    ],
    related: [
      "game-mods/back-up-minecraft-worlds",
      "game-mods/turn-on-cheats-in-minecraft-world",
      "game-mods/install-minecraft-resource-pack",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Want your Minecraft worlds safe or moved to a new PC? Stella (stella.sh) finds every world, launchers included, zips each one and checks the backups open.",
    h1: "Back up all your Minecraft worlds and move them to a new computer",
    short: "Back up Minecraft worlds",
    lede: "Every Minecraft world zipped and ready for a new computer.",
    answer:
      "Close Minecraft, open your saves folder and zip each world. Launchers like Prism and CurseForge keep their own saves too. Stella (stella.sh) finds every world, zips each one and checks the zips open.",
    gets: [
      "Every world zipped on its own",
      "Worlds from other launchers included",
      "Backups ready for your new computer",
    ],
    prompt:
      "Back up all my Minecraft worlds so I don't lose them. I want to copy the backups to my new computer.",
    demo: {
      ack: "On it. Looking for every world.",
      task: "Backing up your worlds",
      rows: ["Finding worlds in every launcher", "Zipping each world on its own", "Checking each zip opens"],
      reply:
        "Done. Four worlds, including the modded one in Prism, are zipped in a dated **Minecraft Backups** folder, and in your Stella Drive for the new computer.",
      files: ["Minecraft Backups"],
    },
    faq: [
      ["Where are my Minecraft worlds saved?", "In the saves folder inside .minecraft, plus a separate saves folder in each Prism, CurseForge or Modrinth App instance."],
      ["Where is the Prism Launcher world folder?", "Right-click the instance, choose Folder, then open minecraft/saves. Each instance keeps its own."],
      ["How do I restore a world from a backup?", "Quit the game, unzip the backup into saves so level.dat sits one folder down, then open Singleplayer."],
    ],
    byHand: [
      "Quit Minecraft, press Win+R and paste %appdata%\\.minecraft\\saves. On a Mac, go to ~/Library/Application Support/minecraft/saves.",
      "Right-click each world folder → Send to → Compressed (zipped) folder. On a Mac, right-click → Compress.",
      "Zip worlds from your launchers' instances too, then copy the zips to the new computer and unzip them into its saves.",
    ],
    related: [
      "game-mods/fix-corrupted-minecraft-world",
      "game-mods/install-minecraft-map",
      "game-mods/turn-on-cheats-in-minecraft-world",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Minecraft world won't load after a crash or power cut? Stella (stella.sh) backs it up, finds what broke and restores it from the copy the game keeps.",
    h1: "Fix a Minecraft world that won't load after a crash",
    short: "Fix a corrupted Minecraft world",
    lede: "A world that won't load, back with your builds.",
    answer:
      "A crash mid-save often empties level.dat, the world's main settings file. Minecraft keeps the previous one as level.dat_old. Stella (stella.sh) backs up the world and swaps the old copy in, so your builds come back.",
    gets: ["Your world loading again", "Your builds kept", "A backup taken before any change"],
    prompt:
      "My Minecraft world Riverbend won't load since my laptop died while I was playing. Can you fix it without losing my builds?",
    demo: {
      ack: "On it. Backing up Riverbend first.",
      task: "Repairing Riverbend",
      rows: ["Backing up the whole world", "Finding the wiped settings file", "Swapping in the game's previous copy"],
      reply:
        "Fixed. Riverbend's settings file was wiped when the laptop died, but your builds were fine. I restored the copy the game keeps, with the same name and seed. You'll be where you were a few minutes before the crash.",
    },
    faq: [
      ["What is level.dat_old?", "Minecraft's copy of the world's settings file from the previous save. It restores the world with only a few minutes lost."],
      ["Will I lose my builds?", "Usually not. Builds live in separate region files. You lose only what changed since the last save."],
    ],
    byHand: [
      "Quit Minecraft and copy the whole world folder from saves somewhere safe.",
      "Turn on file extensions. A level.dat of 0 KB, or much smaller than level.dat_old, is the broken one.",
      "Rename level.dat to level.dat.broken, copy level.dat_old, name the copy level.dat, then open the world.",
    ],
    related: [
      "game-mods/back-up-minecraft-worlds",
      "game-mods/minecraft-modpack-exit-code-1",
      "game-mods/turn-on-cheats-in-minecraft-world",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Forgot to allow cheats when you made your Minecraft world? Stella (stella.sh) turns them on for that world permanently, leaving everything else as it was.",
    h1: "Turn on cheats in a Minecraft world you already made, permanently",
    short: "Turn on cheats in a world",
    lede: "Cheats on in a world you already made, for good.",
    answer:
      "Open to LAN with Allow Commands on only lasts until you quit. To keep cheats on, the world's level.dat needs allowCommands set to 1. Stella (stella.sh) backs up that file and changes just that one setting.",
    gets: ["Cheats on in that world, for good", "Game mode, seed and inventory unchanged", "Your other worlds untouched"],
    prompt:
      "I made a survival world called Maple Hollow without cheats. Turn cheats on for that world for good and leave my other worlds alone.",
    demo: {
      ack: "On it. Finding Maple Hollow.",
      task: "Turning on cheats in Maple Hollow",
      rows: ["Backing up the world's settings file", "Switching cheats on", "Leaving everything else as it was"],
      reply:
        "Done. Cheats are on in Maple Hollow for good. Your game mode, seed, inventory and other worlds are unchanged. Type /time set day to try it.",
    },
    faq: [
      ["Can I turn on cheats after creating a world in Java?", "Yes. Open to LAN does it for one session. Changing allowCommands in level.dat does it for good."],
      ["Will turning on cheats stop achievements?", "Yes. Once a world has cheats on, it stops granting advancements and achievements, even if you turn them off."],
      ["Can I change a hardcore world to survival?", "Yes. The same file has a hardcore setting Stella can switch off."],
    ],
    byHand: [
      "For one session: in the world, press Esc → Open to LAN, set Allow Commands to On and click Start LAN World.",
      "For good: quit Minecraft and copy saves/<world>/level.dat somewhere safe.",
      "Open level.dat in NBTExplorer or a web NBT editor, set allowCommands under Data from 0 to 1, and save.",
    ],
    related: [
      "game-mods/back-up-minecraft-worlds",
      "game-mods/fix-corrupted-minecraft-world",
      "game-mods/install-minecraft-map",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-minecraft-datapacks",
    niche: "game-mods",
    searchPhrases: [
      "how to install minecraft datapacks",
      "minecraft datapacks",
      "how to install datapacks",
      "how to add datapacks to existing world",
      "minecraft datapack not working",
    ],
    title: "Install Minecraft datapacks in an existing world (and fix them)",
    description:
      "Datapack not working in Minecraft? Stella (stella.sh) checks each download, fixes wrapped and bundled packs, and installs the ones that work in your world.",
    h1: "How to install Minecraft datapacks in an existing world",
    short: "Install Minecraft datapacks",
    lede: "Datapacks added to your world, the broken ones sorted out.",
    answer:
      "Quit Minecraft and drop each datapack's zip into your world's datapacks folder. It only loads if pack.mcmeta sits at the top and it suits your version. Stella (stella.sh) checks every download, fixes them and installs the ones that work.",
    gets: ["Working packs installed once each", "Wrapped and bundled packs fixed", "Which ones won't work, and why"],
    prompt:
      "I downloaded some datapacks into my Downloads for my Minecraft world Maple Hollow (Java 1.21.4). Install the ones that will work in that world and tell me which ones won't.",
    demo: {
      ack: "On it. Opening each download.",
      task: "Adding datapacks to Maple Hollow",
      rows: [
        "Checking each pack's version",
        "Unwrapping packs inside extra folders",
        "Splitting out a bundled texture pack",
      ],
      reply:
        "Done. Four datapacks are in Maple Hollow: Graves Plus, Treecapitator, Mob Heads and Glow Ores. Sky Islands Generator is for 1.16.5, so I left it out. Glow Ores' textures went to your resource packs.",
    },
    faq: [
      ["Why is my datapack not working?", "The zip usually has an extra folder, so pack.mcmeta isn't at the top. Or it's for another version, or in another world."],
      ["Can I add datapacks to an existing world?", "Yes. Packs that change terrain only affect new chunks, so explore somewhere new to see them."],
    ],
    byHand: [
      "Quit Minecraft and open saves/<world>/datapacks inside .minecraft (%APPDATA%\\.minecraft on Windows).",
      "Open each zip: pack.mcmeta and a data folder must be right there. If you see one folder, copy that inner folder in.",
      "In the world, run /datapack list to see them, and /reload if one is missing.",
    ],
    related: [
      "game-mods/install-minecraft-resource-pack",
      "game-mods/back-up-minecraft-worlds",
      "game-mods/install-minecraft-mods",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-all-minecraft-screenshots",
    niche: "game-mods",
    searchPhrases: [
      "minecraft screenshots folder",
      "where are minecraft screenshots saved",
      "minecraft screenshots location",
      "find minecraft screenshots",
      "prism launcher screenshots folder",
    ],
    title: "Where Minecraft screenshots are saved, from every launcher",
    description:
      "Can't find your Minecraft screenshots? Stella (stella.sh) gathers them from the game folder and every launcher into one folder in Pictures, oldest first.",
    h1: "Where are Minecraft screenshots saved? Find them all",
    short: "Find all Minecraft screenshots",
    lede: "Every Minecraft screenshot in one folder, oldest first.",
    answer:
      "Screenshots taken with F2 go in the screenshots folder inside .minecraft, and each Prism, Modrinth or CurseForge instance has its own. Stella (stella.sh) finds all of them and copies them into one folder.",
    gets: ["Every screenshot from every launcher", "One folder, oldest first", "Same-named pictures both kept"],
    prompt:
      "Find all my Minecraft screenshots and put copies in one folder in my Pictures, oldest first. I've played with a few different launchers.",
    demo: {
      ack: "On it. Looking in every launcher.",
      task: "Gathering your screenshots",
      rows: ["Searching every Minecraft folder", "Skipping icons and textures", "Copying them in date order"],
      reply:
        "Done. **13 screenshots** are in Minecraft Screenshots in your Pictures: 6 from Minecraft, 4 from Prism and 3 from Modrinth. Two had the same name, so both were kept with the launcher's name added.",
      files: ["Minecraft Screenshots"],
    },
    faq: [
      ["Where does Minecraft save screenshots?", "In .minecraft/screenshots: %APPDATA%\\.minecraft\\screenshots on Windows, ~/Library/Application Support/minecraft/screenshots on a Mac."],
      ["I pressed F2 but there's no screenshot.", "Some laptops need Fn+F2. With another launcher, look in that instance's own folder."],
    ],
    byHand: [
      "Windows: press Win+R and type %APPDATA%\\.minecraft\\screenshots. Mac: Finder → Go → Go to Folder → ~/Library/Application Support/minecraft/screenshots.",
      "In Prism, right-click an instance → Folder → minecraft/screenshots. Modrinth and CurseForge have Open folder on each profile.",
      "Copy them all into one folder and choose Keep Both when names clash. Sorting by name puts them oldest first.",
    ],
    related: [
      "game-mods/back-up-minecraft-worlds",
      "photos-files/separate-screenshots-from-photos",
      "photos-files/sort-photos-into-folders-by-date",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "gta-6-mods",
    niche: "game-mods",
    searchPhrases: [
      "gta 6 mods",
      "gta 6 pc",
      "gta 6 pc port",
      "gta 6 mod menu",
      "gta 6 pc release date",
      "gta 6 mod support",
    ],
    title: "GTA 6 mods: play and mod GTA 6 on your PC",
    description:
      "GTA 6 already runs on PC through fan-made ports, and the first mods are out. Stella (stella.sh) sets one up with your copy of the game and adds the mods you want.",
    h1: "GTA 6 mods: play and mod GTA 6 on PC",
    short: "GTA 6 mods on PC",
    lede: "GTA 6 on your PC through a fan-made port, with the first mods in.",
    answer:
      "GTA 6 has no official PC version yet, but a fan-made PC port already runs it, and the first mods are out. Stella (stella.sh) sets it up with your copy of the game and adds the mods.",
    gets: [
      "GTA 6 running on your PC from your own copy",
      "The mods you pick, like a mod menu, put in for you",
      "A message when the official PC version is announced",
    ],
    prompt:
      "Set up GTA 6 on my PC with the fan-made port and my copy of the game, add a mod menu, and tell me when the official PC version is announced.",
    demo: {
      ack: "On it. Setting up the PC port first.",
      task: "Setting up GTA 6 on your PC",
      rows: ["Getting the newest fan-made port", "Bringing in your game files", "Adding the mod menu"],
      reply:
        "Done. GTA 6 opens from the new desktop shortcut, mod menu in. I'll message you when the PC version is announced.",
    },
    faq: [
      ["Is GTA 6 on PC?", "Not officially yet. It came out on 19 November 2026 for PS5 and Xbox Series X|S, and reports point to a PC version in 2027."],
      ["What GTA 6 mods are there?", "Mod menus and launchers so far, with more every week."],
      ["How well does it run?", "Around 25 to 30 FPS on a strong gaming PC for now, and smoother with each update of the port."],
    ],
    byHand: [
      "Find the most active fan-made GTA 6 PC port and follow its readme to bring in the game files from your copy.",
      "Add mods one at a time, starting the game in between.",
    ],
    related: ["game-mods/mod-gta-5", "pc-gaming/fix-fps-drops-in-games", "game-mods/install-fivem-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-27",
  }),
  shortGuide({
    slug: "mod-gta-5",
    niche: "game-mods",
    searchPhrases: [
      "how to mod gta 5",
      "gta 5 mods",
      "how to install gta 5 mods",
      "how to mod gta 5 enhanced",
      "how to mod gta 5 pc",
      "gta 5 mods pc",
    ],
    title: "How to mod GTA 5 on PC (Legacy and Enhanced)",
    description:
      "Want mods in GTA 5? Tell Stella (stella.sh) which ones. It installs them for your version, Legacy or Enhanced, and keeps the original game safe.",
    h1: "How to mod GTA 5",
    short: "Mod GTA 5",
    lede: "Pick the mods you want. They're in the game when you start it.",
    answer:
      "To mod GTA 5, ask Stella (stella.sh) for the mods you want in story mode. It works out whether you have Legacy or Enhanced, installs everything they need and puts them in.",
    gets: [
      "The mods you picked, working in story mode",
      "Everything they need, added for you",
      "A clean copy to go back to",
    ],
    prompt:
      "Install a trainer and a realistic graphics mod in my GTA 5 and make sure they work.",
    demo: {
      ack: "Sure. Checking which GTA 5 you have, then adding both.",
      task: "Modding GTA 5",
      rows: ["Checking your GTA 5 version", "Getting the two mods", "Adding what they need"],
      reply:
        "Both mods are in. Press F4 in the game for the trainer; the graphics load by themselves. The unmodded game is kept, so you can switch back anytime.",
    },
    faq: [
      ["Can I mod GTA 5 Enhanced?", "Yes. Many mods have an Enhanced version, and Stella picks the right one."],
      ["Where do GTA 5 mods go?", "Mostly in the folder the game is installed in. Stella finds it for you."],
      ["Can I still play GTA Online?", "Yes. Ask Stella to switch to the clean copy first."],
    ],
    byHand: [
      "Find the game folder: in Steam, right-click GTA V, Manage, Browse local files.",
      "Copy Script Hook V from [dev-c.com](http://www.dev-c.com/gtav/scripthookv/) into it, then the mod's files, following its readme.",
      "Start story mode and open the mod with the key its page names.",
    ],
    related: ["game-mods/install-script-hook-v", "game-mods/gta-5-mods-not-working", "game-mods/gta-5-car-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "gta-5-mods-not-working",
    niche: "game-mods",
    searchPhrases: [
      "gta 5 mods not working",
      "gta 5 mods not working after update",
      "gta 5 enhanced mods not working",
      "gta 5 mods not loading",
      "gta v mods not working",
    ],
    title: "GTA 5 mods not working after an update? Fix it",
    description:
      "GTA 5 mods stopped working? Stella (stella.sh) finds which one broke, updates it or takes it out, and gets the game starting with your mods again.",
    h1: "GTA 5 mods not working",
    short: "GTA 5 mods not working",
    lede: "Find the mod that broke and get back to playing.",
    answer:
      "Game updates are the usual reason GTA 5 mods stop working. Stella (stella.sh) finds which ones no longer fit, updates them and leaves the rest of your setup as it was.",
    gets: ["The mod that broke, by name", "Updated versions put in", "The game starting again"],
    prompt:
      "GTA 5 updated and now none of my mods work. Fix it.",
    demo: {
      ack: "Looking at what the update broke now.",
      task: "Fixing your GTA 5 mods",
      rows: ["Reading what the game says went wrong", "Updating Script Hook V", "Setting aside one old mod"],
      reply:
        "Your mods work again. Script Hook V was too old for the update, so I updated it. One car pack had no new version, so it's in a folder called Mods set aside.",
    },
    faq: [
      ["Why do mods break after every update?", "Mods are made for one version of the game. A new version needs a new mod."],
      ["What does “unknown game version” mean?", "Script Hook V is older than your game. Updating it fixes that."],
    ],
    byHand: [
      "Update Script Hook V and any mod you use to their newest versions.",
      "Move all other mods out of the game folder, start the game, then put them back one at a time.",
      "When it stops again, the last one you put back is the cause.",
    ],
    related: ["game-mods/install-script-hook-v", "game-mods/mod-gta-5", "game-mods/gta-5-car-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-script-hook-v",
    niche: "game-mods",
    searchPhrases: [
      "script hook v",
      "script hook v gta 5 enhanced",
      "script hook v download",
      "script hook v dot net",
      "script hook v not working",
    ],
    title: "Script Hook V: install it for GTA 5 and keep it working",
    description:
      "Need Script Hook V for a GTA 5 mod? Stella (stella.sh) gets the right version, puts it in the game and updates it when the game changes.",
    h1: "Script Hook V for GTA 5",
    short: "Install Script Hook V",
    lede: "The piece most GTA 5 mods need, put in the right place.",
    answer:
      "Script Hook V is what most GTA 5 story mods run on. Stella (stella.sh) gets the version that matches your game, installs it and adds the .NET one if your mods want it.",
    gets: ["Script Hook V, matching your game", "The extra pieces your mods ask for", "An update whenever GTA 5 changes"],
    prompt:
      "Install Script Hook V for my GTA 5, and Script Hook V .NET too if my mods need it.",
    demo: {
      ack: "Getting the ones that match your game.",
      task: "Installing Script Hook V",
      rows: ["Checking your game's version", "Getting Script Hook V", "Checking which mods need .NET"],
      reply:
        "Script Hook V is in and matches your game. Two of your mods need the .NET one, so I added that too. Start story mode to use them.",
    },
    faq: [
      ["Is Script Hook V for Enhanced too?", "Yes, the newer releases cover both GTA 5 Legacy and Enhanced."],
      ["Why does it say critical error?", "It's usually an old copy after a game update. Ask Stella to update it."],
    ],
    byHand: [
      "Download it from [dev-c.com](http://www.dev-c.com/gtav/scripthookv/) and open the zip.",
      "Copy the two files inside its bin folder into your GTA 5 folder.",
      "Mods that ask for Script Hook V .NET need that one copied there as well.",
    ],
    related: ["game-mods/mod-gta-5", "game-mods/gta-5-mods-not-working", "game-mods/gta-5-car-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "gta-5-car-mods",
    niche: "game-mods",
    searchPhrases: [
      "gta 5 car mods",
      "how to install car mods in gta 5",
      "gta 5 add on cars",
      "gta 5 real cars mod",
      "gta 5 vehicle mods",
    ],
    title: "GTA 5 car mods: add real cars to your game",
    description:
      "Add real cars to GTA 5: tell Stella (stella.sh) which car mods you want and it puts them in the game, ready to spawn and drive.",
    h1: "GTA 5 car mods, installed for you",
    short: "GTA 5 car mods",
    lede: "The car you want, parked in Los Santos.",
    answer:
      "Car mods either replace a car in GTA 5 or add a new one. Stella (stella.sh) adds yours as new cars, so the originals stay, and tells you the name to spawn each.",
    gets: ["Your cars in the game", "The original cars still there", "The name to type to get each one"],
    prompt:
      "Add the three car mods in my Downloads to GTA 5 without replacing any cars, and tell me how to spawn them.",
    demo: {
      ack: "Adding all three as new cars.",
      task: "Adding your cars to GTA 5",
      rows: ["Opening the three downloads", "Adding them to a copy of the game files", "Listing the spawn names"],
      reply:
        "All three are in. Spawn them from your trainer with **r34gtr**, **m3e46** and **rx7fd**. Nothing was replaced.",
    },
    faq: [
      ["What's the difference between add-on and replace?", "Replace swaps a car the game has. Add-on puts in an extra one."],
      ["How many cars can I add?", "Plenty. If the game starts to struggle, Stella can raise its limits."],
    ],
    byHand: [
      "Make a copy of the game's update folder inside a folder called mods.",
      "Use OpenIV (Legacy) to add the car's pack and its name to the game's list of packs, as its readme says.",
      "Open your trainer, choose spawn by name and type the car's name.",
    ],
    related: ["game-mods/mod-gta-5", "game-mods/install-fivem-mods", "game-mods/install-script-hook-v"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-fivem-mods",
    niche: "game-mods",
    searchPhrases: ["fivem mods", "how to install fivem", "fivem cars", "fivem mods install", "how to install fivem mods"],
    title: "FiveM: install it and add mods, cars and scripts",
    description:
      "Set up FiveM and FiveM mods with Stella (stella.sh): join a server, or add cars, maps and scripts to your own without touching a file.",
    h1: "FiveM and FiveM mods, set up for you",
    short: "FiveM mods",
    lede: "Get on a server, or add cars and scripts to your own.",
    answer:
      "Ask Stella (stella.sh) to install FiveM and it's ready to join servers. Running your own? It adds cars, maps and scripts to it and makes sure they start.",
    gets: ["FiveM ready to play", "Cars, maps and scripts on your own server", "Graphics or sound packs for you alone"],
    prompt:
      "Install FiveM and add this car and this police station map to my server.",
    demo: {
      ack: "Installing FiveM, then adding both to your server.",
      task: "Setting up FiveM",
      rows: ["Installing FiveM", "Turning the car into a server pack", "Adding the map"],
      reply:
        "FiveM is installed, and your server now has the car and the station. Spawn the car with **bison2**.",
    },
    faq: [
      ["Do I need GTA 5 for FiveM?", "Yes, the PC version on Steam, Epic or Rockstar."],
      ["Can I put GTA 5 car mods on FiveM?", "Yes. Stella converts them so everyone on your server can see and drive them."],
      ["Do players have to download the mods?", "No. The server sends them by itself."],
    ],
    byHand: [
      "Install FiveM from [fivem.net](https://fivem.net) and start it once.",
      "On your server, give each mod its own folder inside the resources folder.",
      "Add a line that starts it to the server's settings, then restart the server.",
    ],
    related: ["game-mods/gta-5-car-mods", "game-mods/mod-gta-5", "game-mods/mod-rdr2"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-gta-san-andreas",
    niche: "game-mods",
    searchPhrases: [
      "gta san andreas mods",
      "how to mod gta san andreas",
      "gta san andreas mods pc",
      "gta sa mod loader",
      "gta san andreas widescreen mod",
    ],
    title: "GTA San Andreas mods: install them the easy way",
    description:
      "Mod GTA San Andreas on PC: ask Stella (stella.sh) for widescreen, fixes, cars or a whole remaster pack and it gets the old game running with them.",
    h1: "GTA San Andreas mods, made easy",
    short: "GTA San Andreas mods",
    lede: "The classic with sharper looks, new cars and fewer bugs.",
    answer:
      "Old GTA San Andreas needs a few fixes before mods behave. Stella (stella.sh) adds those first, then the mods you want, and each one can be taken out again.",
    gets: ["Widescreen and smooth play on a new PC", "The mods you want", "Each mod easy to remove"],
    prompt:
      "Get GTA San Andreas running in widescreen on my PC and add this car pack.",
    demo: {
      ack: "Fixing the widescreen first, then the cars.",
      task: "Modding San Andreas",
      rows: ["Getting your game ready for mods", "Adding widescreen and fixes", "Adding the car pack"],
      reply:
        "San Andreas fills your screen now and runs smoothly, and the car pack is in. To remove the cars, delete their folder in modloader.",
    },
    faq: [
      ["Does it work with the Steam version?", "Yes. Stella gets it ready for mods first."],
      ["Does this work for Vice City and GTA 3?", "Yes, the same way. Just name the game."],
    ],
    byHand: [
      "Most mods want version 1.0 of the game; Steam copies need a downgrade first.",
      "Add an ASI loader, then Mod Loader, to the game folder.",
      "Put each mod in its own folder inside the modloader folder.",
    ],
    related: ["game-mods/mod-gta-5", "game-mods/gta-6-mods", "game-mods/mod-rdr2"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-rdr2",
    niche: "game-mods",
    searchPhrases: ["rdr2 mods", "how to mod rdr2", "rdr2 mods pc", "rdr2 mods not working", "red dead redemption 2 mods"],
    title: "RDR2 mods: how to mod Red Dead Redemption 2 on PC",
    description:
      "Mod Red Dead Redemption 2: name the RDR2 mods you want and Stella (stella.sh) installs them in the right order, with everything they need.",
    h1: "RDR2 mods, installed and working",
    short: "RDR2 mods",
    lede: "Your Red Dead story, with the mods you always wanted.",
    answer:
      "RDR2 mods need a couple of helpers before they run. Stella (stella.sh) adds those and your mods to the story game, and sorts it out when one doesn't load.",
    gets: ["Your mods in story mode", "The helpers they need", "Help when one won't load"],
    prompt:
      "Install these RDR2 mods from my Downloads and make the game start with them.",
    demo: {
      ack: "Sorting out what each one needs first.",
      task: "Modding Red Dead Redemption 2",
      rows: ["Checking what each mod needs", "Adding what they need", "Putting in your mods"],
      reply:
        "All five mods are in and the game starts with them. One needed the Rampage trainer, so I added it: open it with F5.",
    },
    faq: [
      ["Why are my RDR2 mods not loading?", "One of the helpers is usually missing or out of date. Stella checks them all."],
      ["Can I use mods in Red Dead Online?", "They're for story mode. Stella can keep a clean copy for playing online."],
    ],
    byHand: [
      "Add Script Hook RDR2 and an ASI loader to the game folder.",
      "Add Lenny's Mod Loader and put mods made for it in its lml folder.",
      "Start story mode, adding one mod at a time.",
    ],
    related: ["game-mods/mod-gta-5", "game-mods/mod-witcher-3", "game-mods/install-nexus-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-skyrim",
    niche: "game-mods",
    searchPhrases: ["how to mod skyrim", "skyrim mods", "how to mod skyrim special edition", "skyrim mods pc", "best skyrim mods"],
    title: "How to mod Skyrim: your mods picked, installed and sorted",
    description:
      "Mod Skyrim without the homework: tell Stella (stella.sh) the kind of game you want and it picks the mods, installs them and puts them in order.",
    h1: "How to mod Skyrim",
    short: "Mod Skyrim",
    lede: "Describe the Skyrim you want and play it tonight.",
    answer:
      "Tell Stella (stella.sh) what you want Skyrim to feel like, or which mods. It sets up a mod manager, adds the mods and what they need, and sorts their order.",
    gets: ["A modded Skyrim that starts", "Mods picked for what you asked", "Your original game left clean"],
    prompt:
      "Make my Skyrim Special Edition prettier and harder, about 20 mods, nothing that crashes.",
    demo: {
      ack: "Good one. Picking about 20 that work well together.",
      task: "Modding Skyrim",
      rows: ["Picking mods that fit your version", "Setting up Mod Organizer", "Installing and sorting them"],
      reply:
        "Skyrim has 22 mods: new weather, textures, combat and tougher enemies. Start it from the **Skyrim modded** icon. The normal game is untouched.",
    },
    faq: [
      ["What's the best mod manager for Skyrim?", "Mod Organizer 2 keeps the game folder clean, and Vortex is the simplest. Stella can use either."],
      ["Where do I get Skyrim mods?", "Mostly from Nexus Mods. Stella uses your own account in your browser."],
      ["Can I mod Skyrim on Xbox or PS5?", "Yes, from the in-game Creations menu. Stella mods the PC game."],
    ],
    byHand: [
      "Install Mod Organizer 2 or Vortex and point it at Skyrim.",
      "Add SKSE, then a few mods at a time from [Nexus Mods](https://www.nexusmods.com/skyrimspecialedition).",
      "Sort the order with LOOT and start the game through the manager.",
    ],
    related: ["game-mods/install-skse", "game-mods/skyrim-load-order", "game-mods/mod-organizer-2"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-skse",
    niche: "game-mods",
    searchPhrases: ["skse", "how to install skse", "skse64", "skse skyrim special edition", "skse not working"],
    title: "SKSE: install the right version for your Skyrim",
    description:
      "Need SKSE for Skyrim? Stella (stella.sh) checks which Skyrim you have, installs the SKSE that fits and makes the game start with it.",
    h1: "SKSE, installed for your Skyrim",
    short: "Install SKSE",
    lede: "The one most Skyrim mods ask for, matched to your game.",
    answer:
      "SKSE only works when it matches your exact Skyrim. Stella (stella.sh) checks your version, installs the right one and sets the game to start with it.",
    gets: ["The SKSE that fits your Skyrim", "The game starting with it", "Mods that need it, working"],
    prompt:
      "Install SKSE for my Skyrim and make the game launch with it.",
    demo: {
      ack: "Checking your Skyrim version first.",
      task: "Installing SKSE",
      rows: ["Checking which Skyrim you have", "Getting the matching SKSE", "Making a new start icon"],
      reply:
        "SKSE is in and matches your Skyrim. Use the **Skyrim (SKSE)** icon on your desktop from now on.",
    },
    faq: [
      ["Which SKSE do I need?", "It depends on your Skyrim: Steam and GOG copies differ. Stella checks for you."],
      ["How do I know SKSE is working?", "Its version shows in the corner of the game's System menu."],
      ["Skyrim updated and SKSE broke. Now what?", "Ask Stella. It gets the new SKSE or steps the game back."],
    ],
    byHand: [
      "Right-click SkyrimSE.exe, Properties, Details, and note the version, such as 1.6.1170.",
      "Get the SKSE made for it from [skse.silverlock.org](https://skse.silverlock.org).",
      "Copy its files next to SkyrimSE.exe and start the game with skse64_loader.",
    ],
    related: ["game-mods/mod-skyrim", "game-mods/skyrim-load-order", "game-mods/skyrim-crash-log"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "skyrim-load-order",
    niche: "game-mods",
    searchPhrases: [
      "skyrim load order",
      "skyrim mod load order",
      "loot load order",
      "skyrim load order guide",
      "loot load order skyrim",
    ],
    title: "Skyrim load order, sorted so your mods get along",
    description:
      "Messy Skyrim load order? Stella (stella.sh) sorts your mods, finds the ones that clash or miss something, and fixes them for you.",
    h1: "Skyrim load order, sorted for you",
    short: "Skyrim load order",
    lede: "Your mods in an order that works, with the clashes gone.",
    answer:
      "The order Skyrim loads mods in decides which one wins. Stella (stella.sh) sorts yours with LOOT, finds clashes and missing pieces, and fixes what it can.",
    gets: ["Mods in the right order", "Clashes and missing pieces found", "A short list of what changed"],
    prompt:
      "Sort my Skyrim load order and tell me if anything is missing or clashing.",
    demo: {
      ack: "Sorting them now and checking for clashes.",
      task: "Sorting your Skyrim mods",
      rows: ["Reading your mod list", "Sorting the order", "Looking for missing pieces"],
      reply:
        "Sorted. Two mods were missing something they need, and I added it. Two weather mods clashed, so I kept the one you put in last.",
    },
    faq: [
      ["Does load order matter?", "Yes. When two mods change the same thing, the later one wins."],
      ["Is LOOT enough?", "It's a great start. Stella also looks at the clashes LOOT leaves to you."],
      ["What about load order on Xbox?", "Ask Stella for a list to copy on your console."],
    ],
    byHand: [
      "Run LOOT and choose Sort, then Apply.",
      "Fix every mod it marks in red: something is missing.",
      "Put patches after the mods they fix.",
    ],
    related: ["game-mods/mod-skyrim", "game-mods/skyrim-crash-log", "game-mods/mod-organizer-2"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "skyrim-crash-log",
    niche: "game-mods",
    searchPhrases: [
      "skyrim crash log",
      "skyrim crash log analyzer",
      "skyrim crash log reader",
      "skyrim crashing on startup",
      "skyrim crash decoder",
    ],
    title: "Skyrim crash log: find the mod that crashes your game",
    description:
      "Skyrim keeps crashing? Give Stella (stella.sh) the crash log. It finds the mod behind it, in plain words, and fixes it.",
    h1: "Skyrim crash log, read and fixed",
    short: "Skyrim crash log",
    lede: "Find out which mod crashes Skyrim, and stop it.",
    answer:
      "A crash log looks like nonsense, but it names the mod behind the crash. Stella (stella.sh) reads yours, tells you in plain words and fixes it.",
    gets: ["The mod behind the crash", "What went wrong, in plain words", "It fixed, so you can play on"],
    prompt:
      "Skyrim crashes every time I enter Whiterun. Find out why and fix it.",
    demo: {
      ack: "Reading your crash logs now.",
      task: "Finding the Skyrim crash",
      rows: ["Reading the last three crash logs", "Checking the mods they share", "Trying the fix"],
      reply:
        "It was a Whiterun lights mod that needs a newer helper mod. I updated the helper. If it crashes again, send me the new log.",
    },
    faq: [
      ["Where are Skyrim crash logs?", "In your Documents, under My Games, Skyrim Special Edition, SKSE. Stella finds them."],
      ["I don't have a crash log. Now what?", "Ask Stella to add a crash logger, then play until it happens again."],
    ],
    byHand: [
      "Add a crash logger mod, such as Crash Logger, and play until it crashes.",
      "Open the newest log in Documents, My Games, Skyrim Special Edition, SKSE.",
      "Look for mod names that show up again and again near the top, and turn those off.",
    ],
    related: ["game-mods/skyrim-load-order", "game-mods/mod-skyrim", "game-mods/install-skse"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-fallout-4",
    niche: "game-mods",
    searchPhrases: ["how to mod fallout 4", "fallout 4 mods", "fallout 4 mods pc", "fallout 4 mods nexus", "best fallout 4 mods"],
    title: "How to mod Fallout 4 on PC, the easy way",
    description:
      "Mod Fallout 4 on PC: say what you want changed and Stella (stella.sh) picks the mods, installs them and gets the game running smoothly.",
    h1: "How to mod Fallout 4",
    short: "Mod Fallout 4",
    lede: "A better-looking, smoother wasteland, set up for you.",
    answer:
      "Fallout 4 changed a lot with its updates, so mods have to match your version. Stella (stella.sh) checks yours, picks mods that fit and installs them.",
    gets: ["Mods that fit your Fallout 4", "A smoother, steadier game", "Your saves kept"],
    prompt:
      "Add better settlements, weather and combat to my Fallout 4, and stop the stuttering.",
    demo: {
      ack: "Checking your version, then picking mods that fit.",
      task: "Modding Fallout 4",
      rows: ["Checking your Fallout 4", "Installing 14 mods", "Turning on the stutter fixes"],
      reply:
        "Fallout 4 has 14 new mods and runs without the stutter. Your saves are where they were, with a copy in Documents.",
    },
    faq: [
      ["Do old Fallout 4 mods still work?", "Some need the older game. Stella can step your game back or find newer ones."],
      ["Do mods turn off achievements?", "Yes, unless you add the mod that keeps them on. Ask for it."],
    ],
    byHand: [
      "Install Vortex or Mod Organizer 2 and pick Fallout 4.",
      "Add mods that say they work with your game version.",
      "Sort them with LOOT and start the game through the manager.",
    ],
    related: ["game-mods/downgrade-fallout-4", "game-mods/install-f4se", "game-mods/mod-fallout-new-vegas"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "downgrade-fallout-4",
    niche: "game-mods",
    searchPhrases: [
      "fallout 4 downgrade",
      "fallout 4 downgrade to 1.10.163",
      "fallout 4 downgrader",
      "fallout 4 downgrade patcher",
      "fallout 4 old version for mods",
    ],
    title: "Fallout 4 downgrade: go back to the version mods like",
    description:
      "Need to downgrade Fallout 4? Stella (stella.sh) takes the game back to the version your mods need and stops it updating again.",
    h1: "Downgrade Fallout 4 to the version your mods need",
    short: "Downgrade Fallout 4",
    lede: "Your old mods working again, on the Fallout 4 they were made for.",
    answer:
      "Many Fallout 4 mods were made for version 1.10.163. Stella (stella.sh) downgrades your game to it, sets up F4SE to match and stops Steam from updating it again.",
    gets: ["Fallout 4 on the version you need", "F4SE that matches", "No surprise updates"],
    prompt:
      "Put my Fallout 4 back to 1.10.163 so my mods work, and keep it there.",
    demo: {
      ack: "Taking it back now. Your saves stay.",
      task: "Stepping Fallout 4 back",
      rows: ["Copying your saves", "Getting the older game files", "Matching F4SE to it"],
      reply:
        "Fallout 4 is on 1.10.163 with the F4SE that fits, and Steam will leave it alone. Your saves are safe.",
    },
    faq: [
      ["Why 1.10.163?", "It's the version most big mods were built for."],
      ["Can I go back to the newest version?", "Yes. Ask Stella, or verify the game's files in Steam."],
    ],
    byHand: [
      "Use a downgrader from Nexus Mods that matches the version you have now.",
      "In Steam, set the game to update only when you start it.",
      "Install the F4SE made for 1.10.163 and start the game with it.",
    ],
    related: ["game-mods/mod-fallout-4", "game-mods/install-f4se", "game-mods/skyrim-crash-log"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-f4se",
    niche: "game-mods",
    searchPhrases: ["f4se", "f4se fallout 4", "f4se not working", "how to install f4se", "f4se download"],
    title: "F4SE for Fallout 4: install the right one",
    description:
      "Need F4SE? Stella (stella.sh) installs the one that fits your Fallout 4 and fixes it when mods say it isn't running.",
    h1: "F4SE, installed for your Fallout 4",
    short: "Install F4SE",
    lede: "F4SE matched to your game, and the mods that need it working.",
    answer:
      "F4SE has to fit your exact Fallout 4. Stella (stella.sh) installs the matching one, adds Address Library and makes the game start with it.",
    gets: ["F4SE that fits", "Address Library added", "A start icon that uses it"],
    prompt:
      "My Fallout 4 mods say F4SE isn't running. Install the right one and fix it.",
    demo: {
      ack: "Checking your Fallout 4, then fixing F4SE.",
      task: "Installing F4SE",
      rows: ["Comparing F4SE with your game", "Getting the one that fits", "Making a start icon"],
      reply:
        "Fixed. Your F4SE was for an older game, so I put in the right one. Start Fallout 4 from the **F4SE** icon.",
    },
    faq: [
      ["How do I check F4SE works?", "Open the in-game console and type getf4seversion."],
      ["What's the F4SE loader error?", "It means F4SE and the game don't match. Stella gets the pair that does."],
    ],
    byHand: [
      "Note the version of Fallout4.exe in its Properties, Details.",
      "Get the matching F4SE from [f4se.silverlock.org](https://f4se.silverlock.org).",
      "Copy its files next to Fallout4.exe and start the game with f4se_loader.",
    ],
    related: ["game-mods/mod-fallout-4", "game-mods/downgrade-fallout-4", "game-mods/mod-skyrim"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-fallout-new-vegas",
    niche: "game-mods",
    searchPhrases: [
      "how to mod fallout new vegas",
      "fallout new vegas mods",
      "fallout new vegas mods to stop crashing",
      "fallout new vegas mods 2026",
      "fnv mods",
    ],
    title: "Fallout New Vegas mods: stop the crashes, then mod it",
    description:
      "Mod Fallout New Vegas so it stops crashing: Stella (stella.sh) adds the fixes everyone needs, then the mods you want on top.",
    h1: "Fallout New Vegas mods that stop the crashes",
    short: "Fallout New Vegas mods",
    lede: "New Vegas without the crashing, plus the mods you like.",
    answer:
      "New Vegas runs well on today's PCs once a handful of fixes are in. Stella (stella.sh) adds those first, then the mods you ask for.",
    gets: ["A New Vegas that stays up", "The mods you want", "Everything in a mod manager"],
    prompt:
      "Make Fallout New Vegas stop crashing on Windows 11 and add a few visual mods.",
    demo: {
      ack: "Fixes first, then the visuals.",
      task: "Fixing Fallout New Vegas",
      rows: ["Letting the game use more memory", "Adding the stability fixes", "Adding four visual mods"],
      reply:
        "New Vegas starts cleanly now and can use more memory. It has the stability fixes and four visual mods, all in Mod Organizer 2.",
    },
    faq: [
      ["Why does New Vegas crash so much?", "It's an old game that runs out of memory. A small patch lets it use more."],
      ["Can I play Fallout 3 in New Vegas?", "Yes, with Tale of Two Wastelands, if you have both games."],
    ],
    byHand: [
      "Run the 4GB patch, then add xNVSE and the NVTF and JIP fixes.",
      "Use Mod Organizer 2, not the game folder, for everything else.",
      "The [Viva New Vegas](https://vivanewvegas.moddinglinked.com) guide lists a good base.",
    ],
    related: ["game-mods/mod-fallout-4", "game-mods/mod-organizer-2", "game-mods/skyrim-load-order"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-starfield",
    niche: "game-mods",
    searchPhrases: ["starfield mods", "starfield mods pc", "starfield mods not working", "how to mod starfield", "sfse starfield"],
    title: "Starfield mods: install them and get them loading",
    description:
      "Install Starfield mods with Stella (stella.sh): it adds them, SFSE if they need it, and fixes the ones that don't show up.",
    h1: "Starfield mods that load the first time",
    short: "Starfield mods",
    lede: "Starfield the way you'd rather play it.",
    answer:
      "Stella (stella.sh) adds Starfield mods for you, whether they come from Nexus or Creations, installs SFSE when one needs it and sorts out mods that don't load.",
    gets: ["Your Starfield mods, loading", "SFSE, if one needs it", "An order that works"],
    prompt:
      "Add these four mods to Starfield and make sure they really show up in the game.",
    demo: {
      ack: "Adding them and checking each one loads.",
      task: "Adding your Starfield mods",
      rows: ["Checking what each mod needs", "Installing SFSE", "Switching the mods on"],
      reply:
        "All four are in. Two need SFSE, so start Starfield from the new **Starfield (SFSE)** icon.",
    },
    faq: [
      ["Does SFSE work with Game Pass?", "SFSE is for the Steam version. Other mods work on both."],
      ["Why don't my mods show up?", "They're often switched off in the list the game reads. Stella turns them on."],
    ],
    byHand: [
      "Install Vortex or Mod Organizer 2 and choose Starfield.",
      "Add mods, then switch on their plugins in the manager's list.",
      "Start the game through SFSE if a mod asks for it.",
    ],
    related: ["game-mods/mod-skyrim", "game-mods/mod-fallout-4", "game-mods/vortex-mod-manager"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-oblivion-remastered",
    niche: "game-mods",
    searchPhrases: [
      "oblivion remastered mods",
      "oblivion remastered mods pc",
      "how to mod oblivion remastered",
      "oblivion remastered mods not working",
      "oblivion remastered mods nexus",
    ],
    title: "Oblivion Remastered mods: get them into the game",
    description:
      "Mod Oblivion Remastered: Stella (stella.sh) sorts out which mods go where, installs them and turns them on, so they simply work.",
    h1: "Oblivion Remastered mods, put in for you",
    short: "Oblivion Remastered mods",
    lede: "Cyrodiil with your choice of mods.",
    answer:
      "Oblivion Remastered has two kinds of mods that go in different places. Stella (stella.sh) puts each where it belongs and switches them on.",
    gets: ["Each mod in the right place", "All of them switched on", "Help when one doesn't show"],
    prompt:
      "Install the Oblivion Remastered mods in my Downloads and turn them on.",
    demo: {
      ack: "Putting each where it belongs.",
      task: "Modding Oblivion Remastered",
      rows: ["Sorting the two kinds of mods", "Copying them in", "Switching them on"],
      reply:
        "All six are in and on. One needed OBSE64, so start the game from its new icon.",
    },
    faq: [
      ["Do old Oblivion mods work in the Remaster?", "A few simple ones do. Most need a Remastered version; Stella looks for it."],
      ["Where's the mods folder?", "There are two, deep in the game's folder. Stella knows both."],
    ],
    byHand: [
      "Look and sound mods (.pak files) go in a folder called ~mods inside Content, Paks.",
      "Game mods (.esp files) go in the Data folder, and their names in Plugins.txt.",
      "Start the game and check each one.",
    ],
    related: ["game-mods/mod-skyrim", "game-mods/mod-starfield", "game-mods/install-nexus-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-baldurs-gate-3",
    niche: "game-mods",
    searchPhrases: ["how to mod bg3", "bg3 mods", "bg3 mod manager", "baldur's gate 3 mods", "bg3 mods nexus"],
    title: "How to mod BG3: hair, classes, dice and more",
    description:
      "Mod Baldur's Gate 3 with Stella (stella.sh): pick your mods from Nexus or the in-game list and it installs them, in order, with what they need.",
    h1: "How to mod BG3 (Baldur's Gate 3)",
    short: "Mod Baldur's Gate 3",
    lede: "New hair, classes and spells in your Baldur's Gate 3.",
    answer:
      "Choose your BG3 mods and Stella (stella.sh) does the rest: it adds them, anything they rely on, and puts them in an order that loads your saves.",
    gets: ["Your mods in the game", "What they rely on, added", "Your saves kept safe"],
    prompt:
      "Add these hair and class mods to Baldur's Gate 3 and make sure my save still loads.",
    demo: {
      ack: "Copying your saves, then adding the mods.",
      task: "Modding Baldur's Gate 3",
      rows: ["Copying your saves", "Adding seven mods", "Putting them in order"],
      reply:
        "All seven mods are in and in order. One needed ImpUI, so I added it. Your saves are copied to Documents.",
    },
    faq: [
      ["Do BG3 mods turn off achievements?", "Not if you add the mod that keeps them on. Ask Stella to include it."],
      ["Can I mod BG3 on PS5 or Xbox?", "Yes, from the game's own Mod Manager. Stella mods the PC and Mac game."],
      ["What's the BG3 mods folder?", "It's hidden in your user folder, under Larian Studios. Stella finds it."],
    ],
    byHand: [
      "For mods on the in-game list: main menu, Mod Manager, Browse.",
      "For Nexus mods: use BG3 Mod Manager, drag the .pak files in and move them to the active side.",
      "Press Save, then start the game.",
    ],
    related: ["game-mods/bg3-mods-not-working", "game-mods/bg3-script-extender", "game-mods/mod-cyberpunk-2077"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "bg3-script-extender",
    niche: "game-mods",
    searchPhrases: [
      "bg3 script extender",
      "bg3 script extender not working",
      "bg3 script extender install",
      "bg3 script extender update",
      "bg3 script extender mac",
    ],
    title: "BG3 Script Extender: install it or get it working",
    description:
      "Set up BG3 Script Extender with Stella (stella.sh): it installs it, keeps it current and fixes it when your mods say it's missing.",
    h1: "BG3 Script Extender, set up for you",
    short: "BG3 Script Extender",
    lede: "The helper that the biggest BG3 mods ask for, running.",
    answer:
      "Some BG3 mods need Script Extender before they do anything. Stella (stella.sh) installs it, checks it starts with the game and updates it after patches.",
    gets: ["Script Extender installed", "Mods that need it, working", "It updating itself"],
    prompt:
      "My BG3 mods say they need Script Extender. Install it and check it works.",
    demo: {
      ack: "Installing it and checking it starts with the game.",
      task: "Setting up Script Extender",
      rows: ["Getting the latest one", "Putting it next to the game", "Checking the mods that need it"],
      reply:
        "Script Extender is in and starts with the game. Your three mods that need it are happy now.",
    },
    faq: [
      ["Does it work on Steam Deck?", "Yes, with one launch setting in Steam, which Stella fills in for you."],
      ["Does it update by itself?", "Yes, it checks each time the game starts."],
    ],
    byHand: [
      "In BG3 Mod Manager, choose Tools, Download and Extract Script Extender.",
      "On Linux or Steam Deck, add the launch option WINEDLLOVERRIDES=\"DWrite=n,b\" %command% in Steam.",
      "Start the game once so it updates itself.",
    ],
    related: ["game-mods/mod-baldurs-gate-3", "game-mods/bg3-mods-not-working", "game-mods/steam-deck-mods"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "bg3-mods-not-working",
    niche: "game-mods",
    searchPhrases: [
      "bg3 mods not working",
      "bg3 mods not showing up",
      "bg3 mods not loading",
      "bg3 mod manager not working",
      "bg3 mods not showing up in game",
    ],
    title: "BG3 mods not working or not showing up? Fix it",
    description:
      "BG3 mods not showing up or your save won't load? Stella (stella.sh) finds the mod at fault and gets Baldur's Gate 3 running with the rest.",
    h1: "BG3 mods not working",
    short: "BG3 mods not working",
    lede: "Missing mods back in your game, and your save loading again.",
    answer:
      "When BG3 mods don't work, one is usually missing something, doubled up or switched off. Stella (stella.sh) finds which and gets your game and save loading.",
    gets: ["What's wrong, in one line", "Missing pieces added, doubles removed", "Your save loading"],
    prompt:
      "After the patch my BG3 mods disappeared and my save won't load. Get it working again.",
    demo: {
      ack: "Checking your mods against the save.",
      task: "Getting your BG3 mods back",
      rows: ["Comparing the save with your mods", "Finding what's missing", "Putting the list back"],
      reply:
        "Your save loads again. The patch had switched every mod off, and one hair mod was in there twice. Both are sorted.",
    },
    faq: [
      ["Why did my mods vanish after a patch?", "The game cleared its list of active mods. The files are usually still there."],
      ["Can I remove a mod mid-game?", "Looks and interface mods, yes. Stella checks the others before taking them out."],
    ],
    byHand: [
      "Open BG3 Mod Manager and see whether your mods moved to the inactive side.",
      "Keep one copy of each mod and add any it lists as missing.",
      "Save the order again and load your game.",
    ],
    related: ["game-mods/mod-baldurs-gate-3", "game-mods/bg3-script-extender", "game-mods/mod-stardew-valley"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-cyberpunk-2077",
    niche: "game-mods",
    searchPhrases: [
      "how to mod cyberpunk 2077",
      "cyberpunk mods",
      "cyberpunk 2077 mods",
      "cyberpunk mods nexus",
      "cyberpunk 2077 mod manager",
    ],
    title: "How to mod Cyberpunk 2077 the easy way",
    description:
      "Mod Cyberpunk 2077 without the fuss: Stella (stella.sh) installs the mods you pick and the helpers they rely on, all matched to your game.",
    h1: "How to mod Cyberpunk 2077",
    short: "Mod Cyberpunk 2077",
    lede: "Night City with your clothes, cars and rules.",
    answer:
      "Most Cyberpunk mods rely on a few helpers made for your exact version. Stella (stella.sh) adds those and the mods you pick, so they start the first time.",
    gets: ["The mods you picked", "The helpers they rely on, matched", "Easy to take out again"],
    prompt:
      "Add a better clothing store, new cars and a photo mode mod to Cyberpunk 2077.",
    demo: {
      ack: "Getting the helpers first, then the three mods.",
      task: "Modding Cyberpunk 2077",
      rows: ["Checking your version", "Adding the helpers", "Adding your three mods"],
      reply:
        "All three are in, with the four helpers they share. Start the game and look for Virtual Atelier on your computer in V's apartment.",
    },
    faq: [
      ["Does Cyberpunk have its own mods menu?", "Yes, since update 2.5. It has picked mods; Nexus has far more."],
      ["My mods broke after 2.5. What now?", "See [Cyberpunk mods not working after 2.5](/how/game-mods/cyberpunk-mods-not-working-after-2-5)."],
    ],
    byHand: [
      "Try the Mods menu on the title screen first.",
      "For Nexus mods, use Vortex and install Cyber Engine Tweaks, RED4ext, redscript, ArchiveXL and TweakXL.",
      "Add your mods and start the game.",
    ],
    related: ["game-mods/cyberpunk-mods-not-working-after-2-5", "game-mods/mod-witcher-3", "game-mods/vortex-mod-manager"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-witcher-3",
    niche: "game-mods",
    searchPhrases: [
      "witcher 3 mods",
      "how to mod the witcher 3",
      "witcher 3 mods nexus",
      "best witcher 3 mods",
      "witcher 3 mods not working",
    ],
    title: "Witcher 3 mods: add them without the headaches",
    description:
      "Install Witcher 3 mods with Stella (stella.sh). It puts them in place, sorts out clashes between them and keeps the game starting.",
    h1: "Witcher 3 mods, without the headaches",
    short: "Witcher 3 mods",
    lede: "Geralt's world, sharper and fairer, your way.",
    answer:
      "Pick your Witcher 3 mods and Stella (stella.sh) installs them, merges the ones that change the same thing and checks the game still starts.",
    gets: ["Your mods, all working together", "Their menus and keys set up", "The game starting cleanly"],
    prompt:
      "Install these six Witcher 3 mods so they work together.",
    demo: {
      ack: "Installing them and checking for clashes.",
      task: "Modding The Witcher 3",
      rows: ["Putting six mods in place", "Merging two that clash", "Adding their menus"],
      reply:
        "All six work together. Two changed the same part of the game, so I merged them. Their settings are in Options, Mods.",
    },
    faq: [
      ["Do mods work on the next-gen version?", "Yes, when they're made for it. Stella picks those."],
      ["Where's the mods folder?", "It's a folder called mods in the game's main folder. You make it if it isn't there."],
    ],
    byHand: [
      "Make a folder called mods in the game folder and put each mod in it.",
      "Copy any menu files the mod comes with and add its lines to your settings, as its readme says.",
      "Run Script Merger if two mods clash.",
    ],
    related: ["game-mods/witcher-3-script-merger", "game-mods/mod-cyberpunk-2077", "game-mods/mod-rdr2"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "witcher-3-script-merger",
    niche: "game-mods",
    searchPhrases: [
      "witcher 3 script merger",
      "witcher 3 script merger how to resolve conflicts",
      "witcher 3 script merger not mergeable",
      "witcher 3 script merger not working",
      "witcher 3 script compilation errors",
    ],
    title: "Witcher 3 Script Merger: get clashing mods to work together",
    description:
      "Stuck in Witcher 3 Script Merger? Stella (stella.sh) merges clashing mods for you, even the ones it calls not mergeable, so the game starts.",
    h1: "Witcher 3 Script Merger, done for you",
    short: "Witcher 3 Script Merger",
    lede: "Two mods that fight, made to work side by side.",
    answer:
      "When two Witcher 3 mods change the same thing, the game won't start. Stella (stella.sh) merges them by hand, keeping what both do, even the tricky ones.",
    gets: ["Clashing mods merged", "Both still doing their job", "No more errors at the start"],
    prompt:
      "Script Merger says two of my Witcher 3 mods can't be merged. Merge them so both work.",
    demo: {
      ack: "Comparing the two mods now.",
      task: "Merging your Witcher 3 mods",
      rows: ["Finding what both change", "Writing one version that does both", "Checking for errors"],
      reply:
        "Merged. Both mods change how potions work, and now you get the longer timers and the new menu together.",
    },
    faq: [
      ["What does not mergeable mean?", "The tool can't decide which change to keep. Stella reads both and keeps what each is for."],
      ["Do I redo this after a new mod?", "Only if the new one clashes. Ask Stella to check."],
    ],
    byHand: [
      "Open Script Merger and let it list the clashes.",
      "For each one, choose Merge and pick both changes where they don't overlap.",
      "Where they do, decide which to keep, save and start the game.",
    ],
    related: ["game-mods/mod-witcher-3", "game-mods/skyrim-load-order", "game-mods/ai-mod-maker"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-elden-ring",
    niche: "game-mods",
    searchPhrases: [
      "how to mod elden ring",
      "elden ring mods",
      "elden ring mods nexus",
      "elden ring mods not working",
      "elden ring mods pc",
    ],
    title: "How to mod Elden Ring on PC",
    description:
      "Mod Elden Ring with Stella (stella.sh): it sets up the mods you pick, starts the game offline and keeps your normal game and saves apart.",
    h1: "How to mod Elden Ring",
    short: "Mod Elden Ring",
    lede: "An easier, harder or completely different Elden Ring.",
    answer:
      "Tell Stella (stella.sh) which Elden Ring mods you want. It sets them up in their own folder, starts the game offline with them and keeps your normal save separate.",
    gets: ["Your mods, in a folder of their own", "A separate save for modded play", "The normal game unchanged"],
    prompt:
      "Set up the Convergence mod for Elden Ring with its own save.",
    demo: {
      ack: "Setting it up beside your normal game.",
      task: "Modding Elden Ring",
      rows: ["Copying your save", "Setting up the mod", "Making a start icon"],
      reply:
        "Convergence is ready. Start it from the **Elden Ring Convergence** icon; it uses its own save, so your main game stays as it was.",
    },
    faq: [
      ["Will it touch my normal save?", "No. Modded play gets its own."],
      ["Can I use two mods together?", "Often. Stella checks whether they change the same things."],
    ],
    byHand: [
      "Copy your save from %APPDATA%, EldenRing.",
      "Download Mod Engine and put the mod's files in its mod folder.",
      "Start the game with Mod Engine's launch file, which plays offline.",
    ],
    related: ["game-mods/elden-ring-seamless-co-op", "game-mods/mod-monster-hunter-wilds", "game-mods/install-nexus-mods"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "elden-ring-seamless-co-op",
    niche: "game-mods",
    searchPhrases: [
      "elden ring seamless co op",
      "seamless coop elden ring",
      "seamless coop not working",
      "how to install seamless co op",
      "elden ring co op mod",
    ],
    title: "Elden Ring Seamless Co-op: set it up and play together",
    description:
      "Set up Elden Ring Seamless Co-op with Stella (stella.sh): it installs the mod, sets your group's password and moves your save across.",
    h1: "Elden Ring Seamless Co-op, set up for you",
    short: "Elden Ring Seamless Co-op",
    lede: "Play all of Elden Ring with friends, start to finish.",
    answer:
      "Seamless Co-op lets you and friends play the whole of Elden Ring together. Stella (stella.sh) installs it, sets your password and brings your save along.",
    gets: ["Seamless Co-op ready to play", "Your own group password", "Your current save brought over"],
    prompt:
      "Install Seamless Co-op for Elden Ring, set the password to “tarnished4” and let me keep my character.",
    demo: {
      ack: "Installing it and copying your character over.",
      task: "Setting up Seamless Co-op",
      rows: ["Getting the newest version", "Setting the password", "Copying your character"],
      reply:
        "Ready. Start it from the **Seamless Co-op** icon. Your friends need the same version and the password **tarnished4**.",
    },
    faq: [
      ["How do we join each other?", "One of you opens a world with the in-game item, the others join with theirs."],
      ["It says versions don't match. Why?", "Someone has an older copy. Ask Stella to update yours."],
    ],
    byHand: [
      "Download it from [Nexus Mods](https://www.nexusmods.com/eldenring/mods/510) and copy the files into the Game folder.",
      "Open its settings file and write a password you all share.",
      "Start ersc_launcher and use the items it gives you to open or join a world.",
    ],
    related: ["game-mods/mod-elden-ring", "game-mods/mod-baldurs-gate-3", "game-mods/steam-deck-mods"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-hogwarts-legacy",
    niche: "game-mods",
    searchPhrases: [
      "hogwarts legacy mods",
      "hogwarts legacy mods pc",
      "hogwarts legacy mods not working",
      "hogwarts legacy mods nexus",
      "how to mod hogwarts legacy",
    ],
    title: "Hogwarts Legacy mods: add them and make them work",
    description:
      "Add Hogwarts Legacy mods with Stella (stella.sh). It picks the right place for each, adds what they need and removes them cleanly too.",
    h1: "Hogwarts Legacy mods, added and working",
    short: "Hogwarts Legacy mods",
    lede: "Robes, spells and castle tweaks, ready at the next start.",
    answer:
      "Hogwarts Legacy has its own mod menu and an older way through Nexus. Stella (stella.sh) adds mods either way, and can take out ones that won't uninstall.",
    gets: ["Robes, spells and tweaks in the game", "The right place for each mod", "Stubborn mods removed cleanly"],
    prompt:
      "Add these Hogwarts Legacy mods, and get rid of the one that won't uninstall.",
    demo: {
      ack: "Taking out the stubborn one first.",
      task: "Modding Hogwarts Legacy",
      rows: ["Removing the stuck mod", "Adding the new ones", "Checking they're switched on"],
      reply:
        "The stuck mod is gone and the four new ones are in. Look for the robes in your gear menu.",
    },
    faq: [
      ["Why won't a mod uninstall?", "A leftover file keeps it listed. Stella finds and removes it."],
      ["Do mods work on Switch or PS5?", "The console game has no mods folder. Stella mods the PC one."],
    ],
    byHand: [
      "Use the Mods menu on the title screen for mods listed there.",
      "For Nexus mods, put .pak files in a ~mods folder inside Content, Paks.",
      "To remove one, delete its files and start the game once.",
    ],
    related: ["game-mods/mod-oblivion-remastered", "game-mods/mod-palworld", "game-mods/install-nexus-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-monster-hunter-wilds",
    niche: "game-mods",
    searchPhrases: [
      "monster hunter wilds mods",
      "reframework",
      "reframework monster hunter wilds",
      "fluffy mod manager monster hunter wilds",
      "monster hunter wilds mods not working",
    ],
    title: "Monster Hunter Wilds mods with REFramework, set up",
    description:
      "Set up Monster Hunter Wilds mods with Stella (stella.sh): REFramework, a mod manager and your mods, put back in shape after each update.",
    h1: "Monster Hunter Wilds mods and REFramework",
    short: "Monster Hunter Wilds mods",
    lede: "Outfits, menus and performance mods in your hunts.",
    answer:
      "Monster Hunter Wilds mods run through REFramework. Stella (stella.sh) sets it up with a mod manager, adds your mods and updates it when the game does.",
    gets: ["REFramework that matches the game", "Your mods, easy to switch on and off", "Fixes after updates"],
    prompt:
      "Get REFramework and these outfit mods into Monster Hunter Wilds.",
    demo: {
      ack: "Matching REFramework to your game first.",
      task: "Modding Monster Hunter Wilds",
      rows: ["Getting the newest REFramework", "Setting up the mod manager", "Switching on your outfits"],
      reply:
        "REFramework is in and your five outfits are on. Turn any of them off in Fluffy Mod Manager.",
    },
    faq: [
      ["Why is my screen black after an update?", "REFramework is too old for the update. Stella gets the newest one."],
      ["How do I open REFramework?", "Press Insert in the game."],
    ],
    byHand: [
      "Copy the newest REFramework for Wilds into the game folder.",
      "Install Fluffy Mod Manager, choose the game and drop your mods in.",
      "After each game update, get the newest REFramework again.",
    ],
    related: ["game-mods/mod-resident-evil-4", "game-mods/mod-elden-ring", "game-mods/install-nexus-mods"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-resident-evil-4",
    niche: "game-mods",
    searchPhrases: [
      "resident evil 4 mods",
      "resident evil 4 remake mods",
      "resident evil 4 mods pc",
      "re4 remake mods",
      "fluffy mod manager re4",
    ],
    title: "Resident Evil 4 mods: add them to the remake or original",
    description:
      "Add Resident Evil 4 mods with Stella (stella.sh), in the remake or the 2005 game. Pick what you want and it's in when you start.",
    h1: "Resident Evil 4 mods, added for you",
    short: "Resident Evil 4 mods",
    lede: "New outfits, weapons and difficulty for Leon.",
    answer:
      "Say which Resident Evil 4 you play and which mods you like. Stella (stella.sh) adds them to the remake or the original and gets the game starting with them.",
    gets: ["Outfits, weapons or a new challenge", "Each mod easy to switch off", "The right version for your game"],
    prompt:
      "Put these outfit and camera mods in my Resident Evil 4 remake.",
    demo: {
      ack: "Adding them to the remake.",
      task: "Modding Resident Evil 4",
      rows: ["Setting up the mod manager", "Adding the outfits", "Adding the camera mod"],
      reply:
        "The outfits and the wider camera are in. Switch any of them on or off in Fluffy Mod Manager.",
    },
    faq: [
      ["Do mods work on the 2005 version?", "Yes. The HD Project is the big one, and Stella can set it up."],
      ["Can I add mods to Village or Requiem?", "Yes, the same way. Name the game."],
    ],
    byHand: [
      "For the remake, use Fluffy Mod Manager and drop each mod in.",
      "Mods that need REFramework want its file in the game folder.",
      "For the 2005 game, copy the mod's folders over the game's own, after saving a copy.",
    ],
    related: ["game-mods/mod-monster-hunter-wilds", "game-mods/mod-elden-ring", "game-mods/install-nexus-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-stardew-valley",
    niche: "game-mods",
    searchPhrases: [
      "how to mod stardew valley",
      "stardew valley mods",
      "how to install stardew valley mods",
      "smapi",
      "how to install smapi",
    ],
    title: "How to mod Stardew Valley (with SMAPI) on PC or Mac",
    description:
      "Mod Stardew Valley with Stella (stella.sh): it installs SMAPI, adds the mods you like and everything they need, and keeps them up to date.",
    h1: "How to mod Stardew Valley",
    short: "Mod Stardew Valley",
    lede: "New crops, people and places on your farm.",
    answer:
      "Stella (stella.sh) sets up SMAPI, which Stardew Valley mods run on, adds the ones you want and what they need, and your farm stays just as it was.",
    gets: ["SMAPI and your mods, working", "What they need, added", "Your farm kept safe"],
    prompt:
      "Set up mods for Stardew Valley: the big expansion, prettier portraits and automatic watering.",
    demo: {
      ack: "Starting with SMAPI, then your three.",
      task: "Modding Stardew Valley",
      rows: ["Installing SMAPI", "Adding the three mods", "Adding what they need"],
      reply:
        "Your Stardew Valley has Expanded, new portraits and automatic sprinklers, plus the two helpers they need. Press Play in Steam as usual.",
    },
    faq: [
      ["Will mods hurt my save?", "Stella copies your farm first, and most mods work on a farm you already have."],
      ["Can I mod Stardew on Steam Deck?", "Yes. Stella sets it up there too."],
      ["What about on my phone?", "Android has its own SMAPI. Stella mods the computer game."],
    ],
    byHand: [
      "Download SMAPI from [smapi.io](https://smapi.io) and run its installer.",
      "Unzip each mod into the game's Mods folder, one folder per mod.",
      "Start the game; the SMAPI window lists anything missing.",
    ],
    related: ["game-mods/stardew-valley-mods-not-working", "game-mods/steam-deck-mods", "game-mods/mod-terraria"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "stardew-valley-mods-not-working",
    niche: "game-mods",
    searchPhrases: [
      "stardew valley mods not working",
      "stardew mods not working",
      "smapi log",
      "stardew valley mods not showing up",
      "smapi not working",
    ],
    title: "Stardew Valley mods not working? Fix them from the SMAPI log",
    description:
      "Stardew Valley mods not working? Stella (stella.sh) reads the SMAPI log, updates what's old, adds what's missing and gets you farming again.",
    h1: "Stardew Valley mods not working",
    short: "Stardew Valley mods not working",
    lede: "The broken mod found and your farm back to normal.",
    answer:
      "SMAPI writes down why each mod failed. Stella (stella.sh) reads it, updates old mods, adds the missing ones and tells you what it did in a line or two.",
    gets: ["The mods at fault, by name", "Old ones updated, missing ones added", "A game that starts clean"],
    prompt:
      "Half my Stardew mods stopped working after the update. Fix them.",
    demo: {
      ack: "Reading what SMAPI says now.",
      task: "Fixing your Stardew mods",
      rows: ["Reading the SMAPI log", "Updating five mods", "Adding a missing one"],
      reply:
        "Fixed. Five mods were old, so I updated them, and Content Patcher was missing. One mod has no update yet and is set aside.",
    },
    faq: [
      ["What do the red lines mean?", "Those mods couldn't start. Stella sorts each one out."],
      ["Where is the SMAPI log?", "Put it into [smapi.io/log](https://smapi.io/log) to read it, or let Stella do it."],
    ],
    byHand: [
      "Open the SMAPI window and look for red lines.",
      "Update SMAPI and every mod it names.",
      "Add anything listed as missing, then start again.",
    ],
    related: ["game-mods/mod-stardew-valley", "game-mods/bg3-mods-not-working", "game-mods/steam-deck-mods"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-stardew-valley-expanded",
    niche: "game-mods",
    searchPhrases: [
      "how to install stardew valley expanded",
      "stardew valley expanded mod",
      "stardew valley expanded not working",
      "stardew valley expanded frontier farm not showing up",
    ],
    title: "How to install Stardew Valley Expanded (PC, Mac, Deck)",
    description:
      "Install Stardew Valley Expanded with Stella (stella.sh): SMAPI, the mod and every helper it needs, plus Frontier Farm if you want it. Your saves are copied first.",
    h1: "How to install Stardew Valley Expanded",
    short: "Install Stardew Valley Expanded",
    lede: "New villagers, new places and a bigger valley to farm.",
    answer:
      "Stella (stella.sh) installs SMAPI if it's missing, then Stardew Valley Expanded and the helper mods it lists, like Content Patcher and Farm Type Manager. Your farms are copied before anything changes.",
    gets: [
      "Expanded and its helpers, in matching versions",
      "Frontier Farm ready for your next new game",
      "Your current farm still loading, with the new valley",
    ],
    prompt:
      "Install Stardew Valley Expanded for me. I want the Frontier Farm too, but don't lose my current farm.",
    demo: {
      ack: "Copying your farms, then setting up Expanded.",
      task: "Installing Stardew Valley Expanded",
      rows: ["Backing up 2 farms", "Updating SMAPI", "Adding Expanded and the mods it needs", "Adding Frontier Farm"],
      reply:
        "Stardew Valley Expanded is in, with Content Patcher and Farm Type Manager. Your current farm opens into the bigger valley. For Frontier Farm, start a new game and pick it from the farm types. Backups are in Stardew Backups.",
    },
    faq: [
      ["Can I add Expanded to an existing save?", "Yes, most of it works on a farm you already have. Frontier Farm needs a new game, since the farm map is chosen at the start."],
      ["Stardew Valley Expanded not working?", "Usually a helper mod is missing or outdated. The SMAPI window names it; Stella reads that and adds the right version."],
      ["Frontier Farm not showing up?", "It's a separate download from Expanded and only appears when you start a new game. Stella adds it for you."],
    ],
    byHand: [
      "Install SMAPI from [smapi.io](https://smapi.io).",
      "Download Stardew Valley Expanded from Nexus Mods, plus every required mod its page lists.",
      "Unzip each into the game's Mods folder and start the game through SMAPI.",
    ],
    related: ["game-mods/mod-stardew-valley", "game-mods/stardew-valley-recolor-mods", "game-mods/stardew-valley-mods-not-working"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "stardew-valley-recolor-mods",
    niche: "game-mods",
    searchPhrases: [
      "stardew valley recolor mods",
      "vibrant pastoral recolor",
      "earthy recolor stardew valley",
      "stardew valley recolor not working",
    ],
    title: "Stardew Valley recolor mods: Vibrant Pastoral, Earthy and more",
    description:
      "Give Stardew Valley a new look. Stella (stella.sh) installs a recolor like Vibrant Pastoral or Earthy, with matching buildings and the patches for Expanded.",
    h1: "Stardew Valley recolor mods, installed",
    short: "Stardew Valley recolor mods",
    lede: "Your whole valley in a softer, cosier palette.",
    answer:
      "Describe the look you want. Stella (stella.sh) installs a recolor like Vibrant Pastoral or Earthy, adds buildings and animals in colours to match, and turns on the settings that make it fit Expanded or other map mods.",
    gets: [
      "One matching palette across the whole valley",
      "Buildings, animals and furniture to fit",
      "Settings for Expanded and your other mods",
    ],
    prompt:
      "Make my Stardew Valley look pastel and cosy, like the screenshots on Pinterest. I already have Expanded installed.",
    demo: {
      ack: "Pastel it is. Setting up Vibrant Pastoral.",
      task: "Recoloring your Stardew Valley",
      rows: ["Adding Vibrant Pastoral Recolor", "Adding Elle's seasonal buildings to match", "Switching on its Expanded support"],
      reply:
        "Your valley now uses Vibrant Pastoral, with Elle's seasonal buildings set to the same colours and the Expanded areas recoloured too. Fancy something warmer later? Ask for Earthy and I'll swap them.",
    },
    faq: [
      ["Which recolor should I pick?", "Vibrant Pastoral is bright and soft; Earthy is warmer and muted. Stella sets up one and swaps to the other whenever you ask."],
      ["Stardew Valley recolor not working?", "Content Patcher is usually missing or old, or two recolors are fighting. Stella reads the SMAPI log and fixes it."],
      ["Can I use two recolors at once?", "Keep one for the map. Buildings, animals and portraits from other creators can sit on top of it."],
    ],
    byHand: [
      "Install SMAPI and Content Patcher.",
      "Download a recolor from Nexus Mods and unzip it into Mods.",
      "Check its page for Expanded settings and set them in Generic Mod Config Menu or its settings file.",
    ],
    related: ["game-mods/install-stardew-valley-expanded", "game-mods/mod-stardew-valley", "game-mods/cozy-minecraft-texture-packs"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "cozy-minecraft-texture-packs",
    niche: "game-mods",
    searchPhrases: [
      "cozy minecraft texture packs",
      "minecraft cozy shaders",
      "cozy minecraft mods",
      "cozy minecraft modpacks",
    ],
    title: "Make Minecraft cozy: texture packs, shaders and mods",
    description:
      "Make your Minecraft cozy. Stella (stella.sh) sets up soft shaders, a warm texture pack and furniture and cooking mods that all fit your game version.",
    h1: "Cozy Minecraft texture packs, shaders and mods",
    short: "A cozy Minecraft look",
    lede: "Soft light, warm colours and cute furniture in your world.",
    answer:
      "Tell Stella (stella.sh) the vibe. It picks a soft shader like Complementary Reimagined, a warm texture pack and cozy mods such as Farmer's Delight, installs them for your Minecraft version and switches them on.",
    gets: [
      "Shaders, textures and mods that work together",
      "Everything matched to your Minecraft version",
      "Your worlds copied before anything changes",
    ],
    prompt:
      "Make my Minecraft look cozy like those TikTok cottage builds: soft lighting, warm textures, furniture and cooking mods.",
    demo: {
      ack: "Putting together a cozy setup that all fits.",
      task: "Making your Minecraft cozy",
      rows: ["Installing Sodium and Iris for shaders", "Adding a soft shader pack", "Adding a warm texture pack", "Adding furniture and cooking mods"],
      reply:
        "A Cozy profile is ready in your launcher: Complementary Reimagined with softer light, a warm texture pack, Farmer's Delight and Macaw's Furniture. Open Minecraft, pick Cozy and play.",
    },
    faq: [
      ["Will cozy shaders run on my laptop?", "Stella can pick a lighter shader for slower computers, or keep the cozy textures and skip shaders."],
      ["Can I keep my old worlds?", "Yes. Stella copies them first, and the new look works on old worlds too. Furniture mods only add new blocks."],
      ["Is there a ready-made cozy modpack?", "A few exist on CurseForge and Modrinth. Stella can install one, or build yours from the pieces you like."],
    ],
    byHand: [
      "Install Fabric, then Sodium and Iris from Modrinth.",
      "Put a shader such as Complementary Reimagined in shaderpacks and a texture pack in resourcepacks.",
      "Add cozy mods like Farmer's Delight that match your Minecraft version.",
    ],
    related: ["game-mods/install-minecraft-shaders", "game-mods/install-minecraft-resource-pack", "game-mods/install-minecraft-mods"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "disney-dreamlight-valley-mods",
    niche: "game-mods",
    searchPhrases: [
      "disney dreamlight valley mods",
      "disney dreamlight valley mods pc",
      "how to install mods disney dreamlight valley",
      "disney dreamlight valley mods nexus",
    ],
    title: "Disney Dreamlight Valley mods: how to install them on PC",
    description:
      "Mod Disney Dreamlight Valley on PC. Stella (stella.sh) sets up BepInEx, adds the Nexus mods you pick and checks each one fits the current game version.",
    h1: "How to install Disney Dreamlight Valley mods",
    short: "Disney Dreamlight Valley mods",
    lede: "More room to decorate and less grinding in your valley.",
    answer:
      "Stella (stella.sh) installs BepInEx in your Steam copy of Disney Dreamlight Valley, adds the mods you pick from Nexus, like one that lifts the furniture limit, and copies your saves first.",
    gets: [
      "BepInEx set up in the game folder",
      "Your chosen mods, each checked against the current update",
      "Saves copied before the first modded start",
    ],
    prompt:
      "Add mods to my Disney Dreamlight Valley on Steam so I can place way more furniture around the valley.",
    demo: {
      ack: "Setting up mods for Dreamlight Valley.",
      task: "Modding Disney Dreamlight Valley",
      rows: ["Copying your saves", "Installing BepInEx in the game folder", "Adding the object limit mod from Nexus"],
      reply:
        "Done. BepInEx is in the game folder with the mod that removes the village object limit. Launch from Steam as usual; the first start takes longer while it sets itself up.",
    },
    faq: [
      ["Can I mod Dreamlight Valley from Game Pass?", "Mods go in the Steam version, where the game files are open. Stella sets them up there."],
      ["Why did my mods stop after a game update?", "Updates often break them. Stella checks each mod page for a fix and sets aside the ones still waiting."],
      ["Will mods affect my save?", "Stella copies your save first, so you can go back to it any time."],
    ],
    byHand: [
      "Download BepInEx (the IL2CPP build) and unzip it into the game's Steam folder.",
      "Start the game once to the main screen, then close it.",
      "Put each mod's files in BepInEx, plugins, and start again.",
    ],
    related: ["game-mods/coral-island-mods", "game-mods/install-bepinex", "game-mods/mod-stardew-valley"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "coral-island-mods",
    niche: "game-mods",
    searchPhrases: [
      "coral island mods",
      "coral island mods nexus",
      "coral island mods not working",
      "how to install coral island mods",
    ],
    title: "Coral Island mods: how to install and fix them",
    description:
      "Install Coral Island mods with Stella (stella.sh): files from Nexus put in the game's Paks folder, named so they load, and sorted out when an update breaks them.",
    h1: "How to install Coral Island mods",
    short: "Coral Island mods",
    lede: "A wider camera, new outfits and easier farm days.",
    answer:
      "Most Coral Island mods are single files the game picks up from its Paks folder. Stella (stella.sh) downloads the ones you choose from Nexus, puts them there named so they load, and copies your saves first.",
    gets: [
      "Your picks from Nexus in the right folder",
      "Old ones pulled out after a game update",
      "Saves copied before anything changes",
    ],
    prompt:
      "Install some Coral Island mods for me: more camera zoom and the cute outfit mods on Nexus. I play on Steam.",
    demo: {
      ack: "Picking those up from Nexus now.",
      task: "Modding Coral Island",
      rows: ["Copying your saves", "Downloading three mods from Nexus", "Placing them in the Paks folder"],
      reply:
        "Three mods are in: camera zoom and two outfit packs, all in the game's Paks folder. Start Coral Island from Steam as usual. Your saves are copied to Coral Island Backups.",
    },
    faq: [
      ["Coral Island mods not working?", "After a game update, older mods can stop loading or crash the game. Stella checks each mod page, updates what has a fix and moves the rest aside."],
      ["Why does a mod's file name end in _P?", "The game only loads extra files whose names end that way. Stella keeps the names right."],
    ],
    byHand: [
      "Download a mod from [Nexus Mods](https://www.nexusmods.com/coralisland).",
      "Unzip the .pak file into Coral Island, ProjectCoral, Content, Paks.",
      "Keep _P at the end of the file name, then start the game.",
    ],
    related: ["game-mods/disney-dreamlight-valley-mods", "game-mods/mod-stardew-valley", "game-mods/install-nexus-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-terraria",
    niche: "game-mods",
    searchPhrases: [
      "terraria mods",
      "tmodloader",
      "how to install tmodloader",
      "terraria calamity mod",
      "tmodloader not launching",
    ],
    title: "Terraria mods with tModLoader, set up for you",
    description:
      "Set up Terraria mods with Stella (stella.sh): tModLoader, Calamity or any others, and a fix when tModLoader won't start.",
    h1: "Terraria mods and tModLoader, set up",
    short: "Terraria mods",
    lede: "Calamity and friends, ready for a new world.",
    answer:
      "Terraria mods run in tModLoader, a free companion to the game. Stella (stella.sh) installs it, adds the mods you want and fixes it when it won't open.",
    gets: ["tModLoader, ready to play", "Calamity or any mods you pick", "Your normal worlds left alone"],
    prompt:
      "Install tModLoader with Calamity and its music, and get it to launch.",
    demo: {
      ack: "Installing tModLoader, then Calamity.",
      task: "Setting up Terraria mods",
      rows: ["Getting tModLoader", "Adding Calamity and its music", "Checking it opens"],
      reply:
        "tModLoader opens with Calamity and its music switched on. Make a new player and world to start.",
    },
    faq: [
      ["Is tModLoader free?", "Yes, if you have Terraria."],
      ["Does it use my normal worlds?", "It keeps its own copies, so your normal game stays the same."],
    ],
    byHand: [
      "In Steam, install tModLoader, which is free with Terraria.",
      "Open it, choose Workshop, Download Mods, and pick some.",
      "Enable them under Manage Mods and choose Reload.",
    ],
    related: ["game-mods/mod-stardew-valley", "game-mods/mod-valheim", "game-mods/ai-mod-maker"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-valheim",
    niche: "game-mods",
    searchPhrases: [
      "valheim mods",
      "how to install valheim mods",
      "valheim mods not working",
      "valheim mods thunderstore",
      "valheim plus",
    ],
    title: "How to install Valheim mods (and keep friends in sync)",
    description:
      "Install Valheim mods with Stella (stella.sh) and give friends the same set, so everyone gets onto the same server without errors.",
    h1: "How to install Valheim mods",
    short: "Valheim mods",
    lede: "A comfier Valheim for you, or your whole group.",
    answer:
      "Stella (stella.sh) adds the Valheim mods you pick, sets them up and makes a pack so your friends have the very same ones.",
    gets: ["Your mods, working", "The same set for your friends", "A fix when a patch breaks one"],
    prompt:
      "Add bigger chests and easier building to Valheim, and make a pack my friends can use.",
    demo: {
      ack: "Adding both, then making the pack.",
      task: "Modding Valheim",
      rows: ["Setting up mods for Valheim", "Adding both mods", "Making the pack code"],
      reply:
        "Both are in. Send your friends the code in valheim-pack.txt; with it they get exactly the same mods.",
    },
    faq: [
      ["Do all players need the same mods?", "For mods that add things, yes. A pack makes that easy."],
      ["Mods broke after the update. Now what?", "Ask Stella to update them or set aside the ones that aren't ready."],
    ],
    byHand: [
      "Install r2modman and choose Valheim.",
      "Add BepInExPack, then the mods you like.",
      "Press Start modded, and export a code for your friends.",
    ],
    related: ["game-mods/r2modman-thunderstore", "game-mods/install-bepinex", "game-mods/mod-lethal-company"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-lethal-company",
    niche: "game-mods",
    searchPhrases: [
      "lethal company mods",
      "lethal company mods for more players",
      "how to install lethal company mods",
      "lethal company mods not working",
      "lethal company mods r2modman",
    ],
    title: "Lethal Company mods: more players and more laughs",
    description:
      "Get Lethal Company mods with Stella (stella.sh): more players, new moons and suits, and one code so your friends have the same.",
    h1: "Lethal Company mods, ready for the crew",
    short: "Lethal Company mods",
    lede: "A modded lobby your whole crew can join.",
    answer:
      "Stella (stella.sh) sets up Lethal Company mods for you and your friends, so bigger lobbies, suits and moons work for everyone.",
    gets: ["Bigger lobbies and new moons", "One code for your friends", "The plain game still there"],
    prompt:
      "Mod Lethal Company so eight of us can play, with more suits, and give me something to send my friends.",
    demo: {
      ack: "Setting it up for eight.",
      task: "Modding Lethal Company",
      rows: ["Setting up a mod profile", "Adding MoreCompany and suits", "Making the code for friends"],
      reply:
        "Eight can join now, with new suits. Send everyone the code in crew-code.txt so you all match.",
    },
    faq: [
      ["How many players can join?", "With MoreCompany, far more than four."],
      ["Friends can't join my lobby. Why?", "Their mods don't match yours. Share one code and it works."],
    ],
    byHand: [
      "Install r2modman and choose Lethal Company.",
      "Add BepInExPack and the mods you like.",
      "Export the profile as a code and send it round.",
    ],
    related: ["game-mods/r2modman-thunderstore", "game-mods/mod-valheim", "game-mods/install-bepinex"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-rimworld",
    niche: "game-mods",
    searchPhrases: [
      "rimworld mods",
      "rimworld mod order",
      "rimworld mod load order",
      "rimworld mod order guide",
      "rimworld mod sorter",
    ],
    title: "RimWorld mods in the right order, errors gone",
    description:
      "Sort your RimWorld mod order with Stella (stella.sh). It finds clashes, missing mods and doubles, and gets rid of the red errors.",
    h1: "RimWorld mods and mod order, sorted",
    short: "RimWorld mods",
    lede: "A colony without red errors.",
    answer:
      "RimWorld shows errors when mods load in the wrong order or miss a helper. Stella (stella.sh) sorts your list, adds what's missing and explains the rest.",
    gets: ["Your mods in the right order", "Missing ones added", "What the red text meant"],
    prompt:
      "Sort my RimWorld mods and stop the red errors when it starts.",
    demo: {
      ack: "Reading your mod list and the errors.",
      task: "Sorting your RimWorld mods",
      rows: ["Reading 84 mods", "Putting them in order", "Adding a missing helper"],
      reply:
        "84 mods sorted and the red errors are gone. Two mods did the same thing, so I switched one off; your old order is saved.",
    },
    faq: [
      ["Which mods go first?", "Harmony, then the game and its expansions, then big helper mods."],
      ["Can I add mods mid-colony?", "Usually yes. Ask Stella about a certain one."],
    ],
    byHand: [
      "Put Harmony first, then Core and the expansions.",
      "Helper mods such as HugsLib come next, then the rest.",
      "RimPy or RimSort can sort the list for you.",
    ],
    related: ["game-mods/skyrim-load-order", "game-mods/mod-project-zomboid", "game-mods/ai-mod-maker"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-palworld",
    niche: "game-mods",
    searchPhrases: ["palworld mods", "ue4ss", "ue4ss palworld", "palworld mods not working", "how to mod palworld"],
    title: "Palworld mods with UE4SS, set up and working",
    description:
      "Set up Palworld mods with Stella (stella.sh): UE4SS where a mod needs it, the rest in the right place, and fixes after a patch.",
    h1: "Palworld mods and UE4SS, set up",
    short: "Palworld mods",
    lede: "Your Pals, your rules, on your own world.",
    answer:
      "Some Palworld mods need UE4SS and others just a folder. Stella (stella.sh) works out which is which, sets it up and makes them load.",
    gets: ["Mods that load", "UE4SS, if one needs it", "Your own server modded too"],
    prompt:
      "Add these Palworld mods and set up UE4SS if they need it.",
    demo: {
      ack: "Checking which of them need UE4SS.",
      task: "Modding Palworld",
      rows: ["Sorting the mods", "Setting up UE4SS", "Switching them on"],
      reply:
        "All five load. Two need UE4SS, so that's in too. Keep the game's Steam version as it is and they'll keep working.",
    },
    faq: [
      ["What is UE4SS?", "A helper that many Palworld mods run on."],
      ["Do I need mods on my server too?", "For some, yes. Stella can add them there."],
    ],
    byHand: [
      "Mods listed on the Steam Workshop install with Subscribe.",
      "Other .pak mods go in a ~mods folder inside Pal, Content, Paks.",
      "Script mods need UE4SS copied next to the game's .exe, with each mod in its Mods folder.",
    ],
    related: ["game-mods/mod-valheim", "game-mods/mod-hogwarts-legacy", "game-mods/r2modman-thunderstore"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-balatro",
    niche: "game-mods",
    searchPhrases: ["how to mod balatro", "balatro mods", "steamodded", "balatro mods how to install", "balatro mods mac"],
    title: "How to mod Balatro: jokers, decks and quality-of-life",
    description:
      "Mod Balatro with Stella (stella.sh): it sets up what mods need, adds the jokers and decks you want and keeps your progress separate.",
    h1: "How to mod Balatro",
    short: "Mod Balatro",
    lede: "Hundreds of new jokers in your next run.",
    answer:
      "Stella (stella.sh) gets Balatro ready for mods, adds the ones you like and gives them their own profile, so your unlocks stay put.",
    gets: ["New jokers and decks", "A separate profile for modded runs", "Works on Windows, Mac and Steam Deck"],
    prompt:
      "Get Balatro ready for mods and add Cryptid and a speed-up mod.",
    demo: {
      ack: "Getting Balatro ready, then adding both.",
      task: "Modding Balatro",
      rows: ["Setting up Steamodded", "Adding Cryptid", "Adding the speed-up mod"],
      reply:
        "Cryptid and the speed-up are in. You'll see a **Mods** button on the menu. Modded runs use profile 2.",
    },
    faq: [
      ["Do mods turn off achievements?", "Steamodded does by default; you can switch them back on in its settings."],
      ["Can I make my own joker?", "Yes. Describe it and Stella makes the mod."],
    ],
    byHand: [
      "Put Lovely next to the game and Steamodded in the Balatro Mods folder.",
      "Unzip each mod into the same Mods folder.",
      "Start the game and choose Mods on the menu.",
    ],
    related: ["game-mods/ai-mod-maker", "game-mods/mod-silksong", "game-mods/mod-stardew-valley"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-silksong",
    niche: "game-mods",
    searchPhrases: [
      "silksong mods",
      "silksong mods not working",
      "hollow knight silksong mods",
      "silksong mods steam deck",
      "how to mod silksong",
    ],
    title: "Silksong mods: easier, harder or prettier",
    description:
      "Install Silksong mods with Stella (stella.sh): an easier time, a tougher one or new looks, ready the next time you press play.",
    h1: "Silksong mods, installed for you",
    short: "Silksong mods",
    lede: "Pharloom at your own pace.",
    answer:
      "Say what you'd change about Silksong, like less damage or a map mod. Stella (stella.sh) finds mods that do it, installs them and keeps your save.",
    gets: ["Mods that do what you asked", "Your save kept safe", "Works on Steam Deck too"],
    prompt:
      "Make Silksong a bit easier and show me on the map where I've been.",
    demo: {
      ack: "Finding two mods that do just that.",
      task: "Modding Silksong",
      rows: ["Setting up BepInEx", "Adding the damage mod", "Adding the map mod"],
      reply:
        "You take one mask less from hard hits, and the map shows where you've been. Your save is copied to Documents.",
    },
    faq: [
      ["Do mods work on Switch?", "No mods folder there. Stella mods the PC, Mac and Steam Deck game."],
      ["How do I change a mod's settings?", "Tell Stella what you want, such as less or more damage."],
    ],
    byHand: [
      "Install BepInEx for Silksong, by hand or with r2modman.",
      "Put each mod in the BepInEx, plugins folder.",
      "Start the game once, then change settings in BepInEx, config.",
    ],
    related: ["game-mods/install-bepinex", "game-mods/mod-balatro", "game-mods/steam-deck-mods"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-project-zomboid",
    niche: "game-mods",
    searchPhrases: [
      "project zomboid mods",
      "project zomboid mods not working",
      "project zomboid mods not showing up",
      "project zomboid mods build 42",
      "project zomboid mods multiplayer",
    ],
    title: "Project Zomboid mods: working alone and with friends",
    description:
      "Project Zomboid mods not showing up? Stella (stella.sh) sets them up for your game and your server, in an order that loads.",
    h1: "Project Zomboid mods, alone or with friends",
    short: "Project Zomboid mods",
    lede: "Knox County with mods that show up for everyone.",
    answer:
      "Stella (stella.sh) adds Project Zomboid mods to your game or server, matches them to your build and makes sure friends can join.",
    gets: ["Mods that show up in the game", "The same list on your server", "Friends able to join"],
    prompt:
      "My Project Zomboid mods don't show up on our server. Make them work for everyone.",
    demo: {
      ack: "Comparing your list with the server's.",
      task: "Fixing your server's mods",
      rows: ["Reading both mod lists", "Adding the missing names", "Putting them in order"],
      reply:
        "Fixed. The server had the downloads but not the mods' names, so nothing loaded. All 18 are on and your friends can join.",
    },
    faq: [
      ["Why don't mods show up in Build 42?", "Many are made for Build 41. Stella finds Build 42 ones."],
      ["Do friends have to subscribe?", "The server sends most of them by itself when they join."],
    ],
    byHand: [
      "Subscribe to mods on the Steam Workshop and switch them on in the Mods menu.",
      "For a server, list each Workshop number and each mod's name in the server settings.",
      "Restart the server and join.",
    ],
    related: ["game-mods/mod-rimworld", "game-mods/mod-valheim", "game-mods/skyrim-load-order"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-sims-4-mods",
    niche: "game-mods",
    searchPhrases: [
      "how to install sims 4 mods",
      "sims 4 mods",
      "sims 4 mod manager",
      "sims 4 mods not working",
      "sims 4 mods folder",
    ],
    title: "How to install Sims 4 mods and CC",
    description:
      "Install Sims 4 mods and CC with Stella (stella.sh). It unpacks them, sorts your Mods folder, removes doubles and switches mods on.",
    h1: "How to install Sims 4 mods",
    short: "Install Sims 4 mods",
    lede: "Clothes, hair and gameplay mods, all in the right folder.",
    answer:
      "Give Stella (stella.sh) your Sims 4 downloads. It unpacks them, puts them in the Mods folder, switches mods on and clears out doubles.",
    gets: ["Your mods and CC in the game", "A tidy Mods folder", "Doubles removed"],
    prompt:
      "Put all the Sims 4 mods and CC from my Downloads into the game and tidy my Mods folder.",
    demo: {
      ack: "Unpacking and sorting them now.",
      task: "Sorting your Sims 4 mods",
      rows: ["Unpacking 46 downloads", "Sorting by creator", "Removing doubles"],
      reply:
        "46 downloads are in, sorted by creator. Nine were doubles and went to the Trash. Mods are switched on.",
    },
    faq: [
      ["Where is the Sims 4 Mods folder?", "In Documents, Electronic Arts, The Sims 4, Mods."],
      ["Why doesn't my CC show up?", "It's often still zipped or buried too deep. Stella fixes both."],
      ["Mods broke after a patch?", "See [find broken Sims 4 mods](/how/game-mods/find-broken-sims-4-mods)."],
    ],
    byHand: [
      "Unzip downloads into Documents, Electronic Arts, The Sims 4, Mods.",
      "Keep script mods no more than one folder deep.",
      "In the game: Options, Game Options, Other, tick both mod boxes and restart.",
    ],
    related: ["game-mods/find-broken-sims-4-mods", "game-mods/mod-stardew-valley", "game-mods/mod-cities-skylines-2"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-sims-4-cc",
    niche: "game-mods",
    searchPhrases: [
      "how to install sims 4 cc",
      "how to install sims 4 cc package files",
      "how to install sims 4 cc zip files",
      "how to install sims 4 cc from pinterest",
    ],
    title: "How to install Sims 4 CC: hair, clothes and furniture",
    description:
      "Install Sims 4 CC from the links you saved or your Downloads. Stella (stella.sh) fetches the free files, unzips them and puts each where the game finds it.",
    h1: "How to install Sims 4 CC",
    short: "Install Sims 4 CC",
    lede: "The hair, outfits and furniture you saved, in your game.",
    answer:
      "Send Stella (stella.sh) the CC links you saved, or point it at your Downloads. It fetches the free files, unzips them, puts package files in Mods and whole lots in Tray, then turns custom content on.",
    gets: [
      "Hair and outfits in Create a Sim, furniture in Build",
      "Zip, rar and 7z downloads unpacked",
      "Folders by type, so you can find things later",
    ],
    prompt:
      "Here are 15 CC links I saved on Pinterest, mostly hair and clothes from TSR and Patreon. Get the free ones into my Sims 4.",
    demo: {
      ack: "Opening your 15 links and fetching the free files.",
      task: "Installing your Sims 4 CC",
      rows: ["Following each link to its download", "Unzipping 15 files", "Sorting into Hair, Clothes and Build"],
      reply:
        "13 items are in Mods, sorted into Hair, Clothes and Build, and one house went to Tray. Two links were early-access posts, listed for later.",
    },
    faq: [
      ["What's the difference between CC and mods?", "CC adds things: hair, clothes, furniture. Mods change how the game plays. CC rarely breaks after a patch; script mods often do."],
      ["What's a .package file?", "The format nearly all Sims 4 CC comes in. It goes in Mods and still works up to five folders deep."],
    ],
    byHand: [
      "Unzip each download and keep the .package files.",
      "Move them into Documents, Electronic Arts, The Sims 4, Mods. Lots and households go in Tray instead.",
      "In Game Options, Other, tick Enable Custom Content and Mods, then restart.",
    ],
    related: ["game-mods/sims-4-cc-not-showing-up", "game-mods/install-sims-4-mods", "game-mods/sims-4-tray-files"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sims-4-cc-not-showing-up",
    niche: "game-mods",
    searchPhrases: [
      "sims 4 cc not showing up in game",
      "sims 4 cc not showing up in cas",
      "sims 4 cc not showing up in build mode",
      "sims 4 cc not showing up after update",
    ],
    title: "Sims 4 CC not showing up in CAS or Build mode? Fixed",
    description:
      "Sims 4 CC not showing up in Create a Sim or Build mode? Stella (stella.sh) finds why: zipped files, the wrong folder, CC switched off or a missing piece.",
    h1: "Sims 4 CC not showing up in game",
    short: "Sims 4 CC not showing up",
    lede: "Every hair, outfit and sofa you downloaded, back in the game.",
    answer:
      "Usually the files are still zipped, buried too deep, in the wrong Documents folder, or a patch switched custom content off. Stella (stella.sh) checks each of these, fixes them and clears the cache so it all loads.",
    gets: [
      "The reason, in one plain line",
      "Files moved to the folder the game really reads",
      "Pieces an item needs from its creator, added",
    ],
    prompt:
      "I downloaded loads of hair and furniture CC but none of it shows up in my Sims 4. Find out why and fix it.",
    demo: {
      ack: "Checking your Mods folder and game settings.",
      task: "Finding your missing Sims 4 CC",
      rows: ["Looking for zipped or buried files", "Checking which Documents folder the game uses", "Turning custom content back on"],
      reply:
        "Found it. Your game reads the Mods folder inside OneDrive, but your CC sat in the other Documents. I moved 212 items over, unzipped 9 more, ticked custom content back on and cleared the cache.",
    },
    faq: [
      ["Why does CC show in CAS but not Build mode?", "Build items often need a matching file from the creator, or a pack you don't own. Stella reads the item page and fetches what's missing."],
      ["Why is my CC off after an update?", "Most patches untick custom content in the game options. Ticking it back on in Game Options, Other brings everything back."],
    ],
    byHand: [
      "In Game Options, Other, check both mod boxes are ticked.",
      "Unzip anything still zipped; keep package files no more than five folders deep.",
      "If your Documents folder is in OneDrive, use the Mods folder there.",
    ],
    related: ["game-mods/install-sims-4-cc", "game-mods/find-broken-sims-4-mods", "game-mods/sims-4-duplicate-cc"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-mc-command-center",
    niche: "game-mods",
    searchPhrases: [
      "mc command center sims 4",
      "how to install mc command center",
      "mc command center not showing up",
      "mc command center download",
    ],
    title: "Install MC Command Center (MCCC) for Sims 4",
    description:
      "Install MC Command Center for Sims 4 with Stella (stella.sh): the newest version from Deaderpool's site, in your Mods folder, switched on and set your way.",
    h1: "Install MC Command Center for Sims 4",
    short: "Install MC Command Center",
    lede: "Your neighbourhood's story under your control, set up and working.",
    answer:
      "Stella (stella.sh) downloads the newest MC Command Center from Deaderpool's site, keeps all its files together in Mods, turns script mods on and sets the options you describe, like aging or who moves into town.",
    gets: [
      "The version made for your game patch",
      "Every MCCC file in one folder",
      "Your story choices set, kept through updates",
    ],
    prompt:
      "Install MC Command Center in my Sims 4 and set it so townies don't get married or have babies without me.",
    demo: {
      ack: "Getting the latest MC Command Center now.",
      task: "Setting up MC Command Center",
      rows: ["Downloading from Deaderpool's site", "Placing it one folder inside Mods", "Turning script mods on", "Saving your story choices"],
      reply:
        "MC Command Center is in a folder called MCCC inside Mods, with script mods on. Townies won't marry or have babies on their own now. Click any computer in game and pick MC Command Center to change more.",
    },
    faq: [
      ["MC Command Center not showing up?", "Usually script mods are off, the files sit two folders deep, or it's older than your patch. Stella fixes all three."],
      ["Do I update MCCC after every patch?", "Often, yes. Ask Stella after a patch: it fetches the matching version and keeps your settings file, so your choices stay."],
    ],
    byHand: [
      "Download the newest version from [deaderpool-mccc.com](https://deaderpool-mccc.com).",
      "Unzip every file into one folder directly inside Mods, never deeper.",
      "Tick Script Mods Allowed in Game Options, Other, and restart.",
      "Keep mc_settings.cfg when you update.",
    ],
    related: ["game-mods/install-wickedwhims", "game-mods/find-broken-sims-4-mods", "game-mods/install-sims-4-mods"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-wickedwhims",
    niche: "game-mods",
    searchPhrases: [
      "how to install wickedwhims",
      "how to install wickedwhims on mac",
      "how to add wickedwhims animations",
      "wickedwhims not working after update",
    ],
    title: "How to install WickedWhims for Sims 4 (PC and Mac)",
    description:
      "Install WickedWhims for Sims 4 with Stella (stella.sh): the newest version from its official site, your animation packs added and script mods switched on.",
    h1: "How to install WickedWhims",
    short: "Install WickedWhims",
    lede: "WickedWhims and its animation packs, set up and working.",
    answer:
      "Stella (stella.sh) gets the newest WickedWhims from its official site, puts it no more than one folder inside Mods, adds the animation packs you downloaded and switches script mods on, on PC or Mac.",
    gets: [
      "The current WickedWhims, matched to your game patch",
      "Animation packs gathered in their own folder",
      "Older copies cleared out so only one loads",
    ],
    prompt:
      "Install WickedWhims in my Sims 4 and add the animation packs sitting in my Downloads folder.",
    demo: {
      ack: "Fetching WickedWhims and looking at your downloads.",
      task: "Installing WickedWhims",
      rows: ["Downloading the newest WickedWhims", "Removing an older copy from Mods", "Sorting 8 animation packs", "Turning script mods on"],
      reply:
        "WickedWhims is in its own folder in Mods, and the old copy is gone. Your 8 animation packs are together in a WW Animations folder. Start the game and click any Sim to see the WickedWhims menu.",
    },
    faq: [
      ["How do I install WickedWhims on Mac?", "The same way as on PC: it goes in Mods inside Documents. Stella sets it up identically on a Mac."],
      ["WickedWhims not working after an update?", "Its creator, TURBODRIVER, usually releases a fix soon after each patch. Stella swaps in the new version and removes the old one."],
      ["Where do the animations go?", "Anywhere in Mods, since they're package files. Stella keeps them in one folder so they're easy to update."],
    ],
    byHand: [
      "Download the newest version from [wickedwhimsmod.com](https://wickedwhimsmod.com).",
      "Unzip it into Mods, at most one folder deep, and delete any older copy.",
      "Put animation packs anywhere in Mods.",
      "Tick Script Mods Allowed in Game Options, Other, and restart.",
    ],
    related: ["game-mods/install-mc-command-center", "game-mods/install-sims-4-cc", "game-mods/find-broken-sims-4-mods"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sims-4-reshade-presets",
    niche: "game-mods",
    searchPhrases: [
      "sims 4 reshade presets",
      "how to install reshade sims 4",
      "sims 4 reshade",
      "sims 4 reshade tutorial",
    ],
    title: "Sims 4 ReShade presets: install ReShade and a preset",
    description:
      "Install ReShade for Sims 4 and the preset you like. Stella (stella.sh) sets it up for the EA app or Steam and adds the preset with the effects it needs.",
    h1: "Install Sims 4 ReShade presets",
    short: "Sims 4 ReShade presets",
    lede: "Soft, cinematic light in your game, like the screenshots you love.",
    answer:
      "Send Stella (stella.sh) the preset you like. It installs ReShade on your Sims 4, adds the preset and every effect it uses, and sets one key to switch the look on and off while you play.",
    gets: [
      "ReShade on the right game, EA app or Steam",
      "Your preset with all of its effects",
      "One key to flip the look on and off",
    ],
    prompt:
      "Install ReShade on my Sims 4 with the soft pastel preset I got from Patreon. The zip is in my Downloads.",
    demo: {
      ack: "Setting up ReShade with your pastel preset.",
      task: "Adding ReShade to Sims 4",
      rows: ["Finding Sims 4 in the EA app folder", "Installing ReShade for DirectX 11", "Adding the preset and its effects", "Setting a key to toggle it"],
      reply:
        "ReShade is on Sims 4 with your pastel preset loaded. Press Home in game to open its menu, and Scroll Lock turns the look on or off. The preset sits beside the game in its Bin folder.",
    },
    faq: [
      ["Will ReShade slow my game down?", "Heavy presets can. Stella can switch off the costliest effects, like depth of field, for everyday play and keep them for screenshots."],
      ["What about GShade presets?", "GShade stopped being updated in 2023. Most GShade presets work in ReShade, and Stella moves yours across."],
    ],
    byHand: [
      "Download ReShade from [reshade.me](https://reshade.me) and run it.",
      "Pick TS4_x64.exe in the game's Game, Bin folder, then choose DirectX 10/11/12.",
      "Put the preset file in that Bin folder, install the effects it lists, then pick it in the Home menu.",
    ],
    related: ["game-mods/install-sims-4-cc", "game-mods/sims-4-tray-files", "game-mods/install-minecraft-shaders"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sims-4-tray-files",
    niche: "game-mods",
    searchPhrases: [
      "sims 4 tray files",
      "how to download sims 4 lots",
      "sims 4 tray files not showing up in gallery",
      "how to download sims 4 lots from patreon",
    ],
    title: "Sims 4 Tray files: add downloaded lots, houses and Sims",
    description:
      "Downloaded a Sims 4 house or Sim? Stella (stella.sh) puts its Tray files and the CC it uses in place, so it shows in your Gallery library ready to place.",
    h1: "Sims 4 Tray files: put downloaded lots in your game",
    short: "Sims 4 Tray files and lots",
    lede: "Downloaded houses and Sims, ready in your library.",
    answer:
      "A downloaded lot or Sim comes as Tray files, usually with CC it needs. Stella (stella.sh) puts the Tray files in Tray and the CC in Mods, fetches anything missing from the creator's list, and it appears in your library.",
    gets: [
      "Houses, rooms and Sims in My Library",
      "The CC each lot uses, added alongside",
      "Anything paid or gone, listed with its link",
    ],
    prompt:
      "I downloaded three houses and a family from Patreon for Sims 4. Put them in my game with all the CC they need.",
    demo: {
      ack: "Sorting those downloads into Tray and Mods.",
      task: "Adding lots to your Sims 4",
      rows: ["Unzipping four downloads", "Moving Tray files into Tray", "Fetching CC from each creator's list"],
      reply:
        "Your three houses and the family are in the Gallery under My Library. 41 CC items went into Mods, one folder per lot. Tick Include Custom Content in the Gallery, then place a house from Manage Worlds.",
    },
    faq: [
      ["Sims 4 Tray files not showing up in the Gallery?", "Tick Include Custom Content in My Library. Tray files inside subfolders don't show either; Stella keeps them at the top of Tray."],
      ["Where is the Tray folder?", "Beside Mods, in Documents, Electronic Arts, The Sims 4, Tray."],
    ],
    byHand: [
      "Unzip the download. Files ending in .trayitem, .blueprint, .bpi, .hhi and .sgi go straight into Tray.",
      "Put any .package files into Mods.",
      "In the game, open the Gallery, My Library, and tick Include Custom Content.",
    ],
    related: ["game-mods/install-sims-4-cc", "game-mods/sims-4-cc-not-showing-up", "game-mods/install-sims-4-mods"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sims-4-duplicate-cc",
    niche: "game-mods",
    searchPhrases: [
      "sims 4 duplicate cc finder",
      "sims 4 merge cc",
      "sims 4 delete duplicate cc",
      "sims 4 cc merged or unmerged",
    ],
    title: "Sims 4 duplicate CC finder: clean up and merge your CC",
    description:
      "Clean up a huge Sims 4 CC folder. Stella (stella.sh) finds duplicate CC, moves the doubles to the Trash and merges the rest so the game loads faster.",
    h1: "Find duplicate CC in Sims 4 and speed up loading",
    short: "Find and merge duplicate Sims 4 CC",
    lede: "A lighter CC folder that loads faster and never doubles up.",
    answer:
      "Stella (stella.sh) goes through your whole CC collection, finds files that are the same item twice, moves the extras to the Trash and, if you like, merges thousands of small files into a few, so the game loads sooner.",
    gets: [
      "Exact and renamed duplicates found",
      "Extras in the Trash, easy to restore",
      "Merged files by category, with a list of what's inside",
    ],
    prompt:
      "My Sims 4 Mods folder is 40 GB and takes forever to load. Find the duplicate CC, remove it and merge what's left.",
    demo: {
      ack: "Scanning your Mods folder for doubles first.",
      task: "Cleaning up your Sims 4 CC",
      rows: ["Comparing 18,400 package files", "Moving 1,260 duplicates to the Trash", "Merging the rest by category"],
      reply:
        "Your Mods folder went from 18,400 files to 34 merged ones, with script mods left as they were. The 1,260 doubles are in the Trash, and Merged CC list.txt says what's inside each merged file.",
    },
    faq: [
      ["Should Sims 4 CC be merged or unmerged?", "Merged loads faster and stays tidy; unmerged is easier to update item by item. Stella keeps a list, so any merged item is still easy to find."],
      ["Can script mods be merged?", "No. Files ending in .ts4script stay as they are; Stella merges only CC."],
    ],
    byHand: [
      "Run the Sims 4 Mod Conflict Detector or Sims 4 Studio to list duplicates.",
      "Delete the extra copies, keeping the newest.",
      "Merge with Sims 4 Studio's Merge Packages tool, one category at a time, and keep the originals as a backup.",
    ],
    related: ["game-mods/sims-4-cc-not-showing-up", "game-mods/install-sims-4-cc", "pc-cleanup/find-duplicate-files"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-subnautica",
    niche: "game-mods",
    searchPhrases: [
      "subnautica mods",
      "subnautica mods not working",
      "subnautica multiplayer mod",
      "how to mod subnautica",
      "subnautica mods nexus",
    ],
    title: "Subnautica mods: install them, even multiplayer",
    description:
      "Add Subnautica mods with Stella (stella.sh): maps, vehicles, or Nitrox to play with friends, set up from start to finish.",
    h1: "Subnautica mods, multiplayer included",
    short: "Subnautica mods",
    lede: "New vehicles, a better map, or a dive with friends.",
    answer:
      "Stella (stella.sh) sets up Subnautica mods, from a simple map to Nitrox, which lets you play with friends.",
    gets: ["The mods you want", "Nitrox for playing together", "Your base kept safe"],
    prompt:
      "Add a map mod to Subnautica and set up Nitrox so my friend can join.",
    demo: {
      ack: "Adding the map, then Nitrox.",
      task: "Modding Subnautica",
      rows: ["Copying your base", "Adding the map mod", "Setting up Nitrox"],
      reply:
        "Press M for the map. Nitrox is ready: open it, press Host and send your friend the address it shows.",
    },
    faq: [
      ["Does this work with Below Zero?", "Yes for most mods. Name the game you play."],
      ["Can I keep my solo base?", "Yes. Nitrox uses its own saves."],
    ],
    byHand: [
      "Install BepInEx for Subnautica and Nautilus, which most mods use.",
      "Put mods in the BepInEx, plugins folder.",
      "For playing together, use the [Nitrox](https://nitrox.rux.gg) launcher.",
    ],
    related: ["game-mods/install-bepinex", "game-mods/mod-valheim", "game-mods/install-nexus-mods"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-cities-skylines-2",
    niche: "game-mods",
    searchPhrases: [
      "cities skylines 2 mods",
      "cities skylines 2 mods not showing up",
      "cities skylines 2 mods not loading",
      "cities skylines 2 mods folder",
      "how to mod cities skylines 2",
    ],
    title: "Cities Skylines 2 mods: add them and get them loading",
    description:
      "Cities Skylines 2 mods not loading? Stella (stella.sh) finds why, sorts your playsets and gets your city opening with the mods you want.",
    h1: "Cities Skylines 2 mods, up and running",
    short: "Cities Skylines 2 mods",
    lede: "Better roads and buildings in your city.",
    answer:
      "Cities Skylines 2 loads mods from the playset you've chosen. Stella (stella.sh) sorts yours, finds the ones holding it up and gets your city open again.",
    gets: ["A playset that loads", "The mod causing trouble, named", "Your city opening again"],
    prompt:
      "My Cities Skylines 2 mods won't load since the update. Get my city back.",
    demo: {
      ack: "Checking your playset now.",
      task: "Fixing your city's mods",
      rows: ["Reading what failed to load", "Updating three mods", "Setting one aside"],
      reply:
        "Your city opens again. Three mods needed an update, and one isn't ready for the patch, so it's switched off in the playset.",
    },
    faq: [
      ["Why don't mods show up in the game?", "The wrong playset is often active."],
      ["Where do the mods come from?", "Paradox Mods, inside the game."],
    ],
    byHand: [
      "On the main menu, open Paradox Mods and check which playset is active.",
      "Update or switch off mods made for an older patch.",
      "Restart the game and load your city.",
    ],
    related: ["game-mods/install-sims-4-mods", "game-mods/mod-rimworld", "game-mods/mod-project-zomboid"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "beamng-mods",
    niche: "game-mods",
    searchPhrases: [
      "beamng mods",
      "beamng mods folder",
      "how to install beamng mods",
      "beamng mods not showing up",
      "beamng mods cars",
    ],
    title: "BeamNG mods: install cars and maps that show up",
    description:
      "Install BeamNG mods with Stella (stella.sh): cars, maps and sounds in the right folder, with old and broken ones cleared out.",
    h1: "BeamNG mods that show up in the game",
    short: "BeamNG mods",
    lede: "More cars to crash, more roads to crash on.",
    answer:
      "Stella (stella.sh) puts your BeamNG cars and maps where the game looks for them and clears out the broken ones slowing it down.",
    gets: ["Cars and maps in the game", "Broken mods cleared out", "A faster start"],
    prompt:
      "Install the BeamNG cars in my Downloads and find which mod makes the game slow to start.",
    demo: {
      ack: "Adding the cars, then finding the slow one.",
      task: "Sorting your BeamNG mods",
      rows: ["Adding six cars", "Checking the others", "Setting aside two broken ones"],
      reply:
        "Six new cars are in the vehicle list. Two old maps were slowing the start, so they're set aside.",
    },
    faq: [
      ["Where's the BeamNG mods folder?", "In your user folder, under BeamNG.drive. The game's launcher has a button that opens it."],
      ["Do I unzip the mods?", "No, leave them zipped."],
    ],
    byHand: [
      "Open the launcher, choose Manage User Folder, Open in Explorer, then mods.",
      "Drop the zip files in without unpacking them.",
      "In the game, switch them on in the Mod Manager.",
    ],
    related: ["game-mods/assetto-corsa-mods", "game-mods/euro-truck-simulator-2-mods", "game-mods/gta-5-car-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "assetto-corsa-mods",
    niche: "game-mods",
    searchPhrases: [
      "how to install assetto corsa mods",
      "assetto corsa mods",
      "content manager assetto corsa",
      "assetto corsa mods cars",
      "assetto corsa graphics mod",
    ],
    title: "How to install Assetto Corsa mods, cars and graphics",
    description:
      "Install Assetto Corsa mods with Stella (stella.sh): Content Manager, cars, tracks and the graphics packs, ready to race.",
    h1: "How to install Assetto Corsa mods",
    short: "Assetto Corsa mods",
    lede: "Drift cars, real roads and night skies.",
    answer:
      "Stella (stella.sh) sets up Content Manager and the graphics packs for Assetto Corsa, then adds the cars and tracks you downloaded.",
    gets: ["Content Manager set up", "Rain, night and better light", "Your cars and tracks"],
    prompt:
      "Set up Assetto Corsa with Content Manager, better graphics and the cars in my Downloads.",
    demo: {
      ack: "Content Manager first, then the looks and cars.",
      task: "Setting up Assetto Corsa",
      rows: ["Setting up Content Manager", "Adding the graphics packs", "Adding eight cars"],
      reply:
        "All set. Open Content Manager to race: the new light and rain are on and eight cars are in the list.",
    },
    faq: [
      ["Is Content Manager free?", "Yes. A paid version adds extras."],
      ["It says race cancelled. Why?", "Usually a car or track is missing a piece. Stella finds which."],
    ],
    byHand: [
      "Download Content Manager and point it at your Assetto Corsa folder.",
      "In its settings, install Custom Shaders Patch, then add a weather pack such as Pure or Sol.",
      "Drag car and track downloads onto the window and press Install.",
    ],
    related: ["game-mods/beamng-mods", "game-mods/euro-truck-simulator-2-mods", "game-mods/gta-5-car-mods"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "euro-truck-simulator-2-mods",
    niche: "game-mods",
    searchPhrases: ["euro truck simulator 2 mods", "ets2 mods", "how to install ets2 mods", "ets2 mods folder", "ets2 mod order"],
    title: "Euro Truck Simulator 2 mods, installed in the right order",
    description:
      "Install ETS2 mods with Stella (stella.sh): maps, trucks and sounds in the order they need, so your Euro Truck save loads.",
    h1: "Euro Truck Simulator 2 mods, in order",
    short: "Euro Truck Simulator 2 mods",
    lede: "Bigger maps and better trucks, no crashes.",
    answer:
      "Map mods for Euro Truck Simulator 2 only work in the right order. Stella (stella.sh) adds yours, orders them and makes a profile to try them.",
    gets: ["Your maps and trucks in order", "A fresh profile to try them", "Your career kept safe"],
    prompt:
      "Add ProMods and these two trucks to Euro Truck Simulator 2 in the right order.",
    demo: {
      ack: "Adding them in the order ProMods wants.",
      task: "Modding Euro Truck Simulator 2",
      rows: ["Copying your profile", "Adding the map", "Adding two trucks"],
      reply:
        "ProMods and both trucks are in, in order. Try them on the new **ProMods** profile; your career is untouched.",
    },
    faq: [
      ["Where's the mod folder?", "In Documents, Euro Truck Simulator 2, mod."],
      ["Does this work for American Truck Simulator?", "Yes, the same way."],
    ],
    byHand: [
      "Copy mod files into Documents, Euro Truck Simulator 2, mod.",
      "In the game, open Mod Manager on your profile and switch them on.",
      "Put maps in the order their page says, the last one highest.",
    ],
    related: ["game-mods/assetto-corsa-mods", "game-mods/beamng-mods", "game-mods/mod-cities-skylines-2"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-nexus-mods",
    niche: "game-mods",
    searchPhrases: [
      "how to install nexus mods",
      "nexus mods",
      "how to use nexus mods",
      "nexus mods download",
      "nexus mods manual install",
    ],
    title: "How to install Nexus mods for any game",
    description:
      "Install Nexus mods with Stella (stella.sh): send it a link or say what you want, and it downloads the mod and puts it in your game.",
    h1: "How to install Nexus mods",
    short: "Install Nexus mods",
    lede: "Find it on Nexus, play with it tonight.",
    answer:
      "Send Stella (stella.sh) a Nexus link or say what you want. It downloads the mod with your account, adds what it needs and puts it in your game.",
    gets: ["The mod in your game", "Everything else it needs", "A note of what went where"],
    prompt:
      "Install this Nexus mod for me, and anything it needs.",
    demo: {
      ack: "Reading the mod's page first.",
      task: "Installing your Nexus mod",
      rows: ["Reading what it needs", "Downloading with your account", "Putting it in the game"],
      reply:
        "It's in, with the two mods it needs. To take it out, ask me or delete the folder named in mods.txt.",
    },
    faq: [
      ["Do I need a Nexus account?", "Yes, a free one. Stella uses it in your own browser."],
      ["Manual download or Vortex?", "Either. Stella handles the manual kind so you don't need an app."],
    ],
    byHand: [
      "Open the mod's Files tab, choose Manual download and unzip it.",
      "Read its Requirements and get those first.",
      "Copy the files where its page says, usually the game's folder.",
    ],
    related: ["game-mods/vortex-mod-manager", "game-mods/mod-organizer-2", "game-mods/mod-skyrim"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "vortex-mod-manager",
    niche: "game-mods",
    searchPhrases: [
      "vortex mod manager",
      "vortex mod manager not working",
      "how to use vortex mod manager",
      "vortex not downloading mods",
      "vortex mod manager linux",
    ],
    title: "Vortex Mod Manager: set it up or fix it",
    description:
      "Set up Vortex Mod Manager with Stella (stella.sh), or have it fixed when downloads stick, mods won't deploy or it won't open.",
    h1: "Vortex Mod Manager, set up or fixed",
    short: "Vortex Mod Manager",
    lede: "Vortex doing what it should, so you can just play.",
    answer:
      "Vortex keeps your mods in one place. Stella (stella.sh) sets it up for your game, or finds out why it's stuck and gets it going.",
    gets: ["Vortex set up for your game", "Stuck downloads moving", "Mods deployed and loading"],
    prompt:
      "Vortex isn't downloading mods anymore and some won't deploy. Fix it.",
    demo: {
      ack: "Seeing where Vortex gets stuck.",
      task: "Fixing Vortex",
      rows: ["Checking the stuck downloads", "Reconnecting your account", "Deploying your mods"],
      reply:
        "Vortex works again. Your Nexus sign-in had run out, and one drive was nearly full, so I moved its downloads to the other one.",
    },
    faq: [
      ["How do I change load order in Vortex?", "Open the Load Order page, or ask Stella for what you want."],
      ["Can I get Vortex on Linux or Steam Deck?", "Yes. Stella sets it up there."],
    ],
    byHand: [
      "Install Vortex from Nexus Mods and let it find your game.",
      "Sign in to Nexus in Vortex, then use Mod Manager Download on a mod's page.",
      "Choose Install, Enable, then Deploy.",
    ],
    related: ["game-mods/vortex-to-mod-organizer-2", "game-mods/mod-organizer-2", "game-mods/install-nexus-mods"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mod-organizer-2",
    niche: "game-mods",
    searchPhrases: [
      "mod organizer 2",
      "how to use mod organizer 2",
      "mod organizer 2 setup",
      "mod organizer 2 linux",
      "mod organizer 2 skyrim",
    ],
    title: "Mod Organizer 2, set up and ready to use",
    description:
      "Set up Mod Organizer 2 with Stella (stella.sh): pointed at your game, with profiles, tools and your mods already in it.",
    h1: "Mod Organizer 2, set up for you",
    short: "Mod Organizer 2",
    lede: "All your mods in one place, and a game folder that stays clean.",
    answer:
      "Mod Organizer 2 keeps mods out of your game folder. Stella (stella.sh) sets it up for your game, adds your mods and the tools people use with it.",
    gets: ["Mod Organizer 2 ready", "A profile for each way you play", "SKSE and LOOT inside it"],
    prompt:
      "Set up Mod Organizer 2 for Skyrim with one profile for a light game and one for a heavy one.",
    demo: {
      ack: "Setting it up with both profiles.",
      task: "Setting up Mod Organizer 2",
      rows: ["Pointing it at Skyrim", "Making two profiles", "Adding SKSE and LOOT"],
      reply:
        "Mod Organizer 2 is ready with **Light** and **Heavy** profiles. Pick one at the top, then press Run.",
    },
    faq: [
      ["Does it work on Linux or Steam Deck?", "Yes. Stella sets it up there too."],
      ["Do I start the game from it?", "Yes, always, so the mods load."],
    ],
    byHand: [
      "Download it from [Nexus Mods](https://www.nexusmods.com/skyrimspecialedition/mods/6194) and run the installer.",
      "Choose your game and a folder outside Program Files.",
      "Add mods with the top left icon, tick them and press Run.",
    ],
    related: ["game-mods/vortex-to-mod-organizer-2", "game-mods/skyrim-load-order", "game-mods/mod-skyrim"],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "vortex-to-mod-organizer-2",
    niche: "game-mods",
    searchPhrases: [
      "vortex vs mod organizer 2",
      "vortex to mod organizer 2",
      "moving from vortex to mod organizer 2",
      "vortex or mod organizer 2 for skyrim",
      "switch from vortex to mo2",
    ],
    title: "Vortex vs Mod Organizer 2, and how to switch",
    description:
      "Vortex vs Mod Organizer 2: Vortex is simpler, MO2 keeps your game clean. Stella (stella.sh) moves all your mods across for you.",
    h1: "Vortex vs Mod Organizer 2: which, and how to switch",
    short: "Vortex or Mod Organizer 2",
    lede: "Pick the right one, and bring your mods along.",
    answer:
      "Vortex is simpler and covers more games; Mod Organizer 2 gives you more control for Skyrim and Fallout. Stella (stella.sh) moves your mods and order from one to the other.",
    gets: ["All your mods moved", "The same order as before", "A clean game folder"],
    prompt:
      "Move my Skyrim mods from Vortex to Mod Organizer 2 without downloading them again.",
    demo: {
      ack: "Moving them across now.",
      task: "Moving to Mod Organizer 2",
      rows: ["Reading your Vortex mods", "Setting up Mod Organizer 2", "Moving mods and their order"],
      reply:
        "All 63 mods are in Mod Organizer 2 in the same order, and the game folder is clean. Your Vortex setup is kept for now.",
    },
    faq: [
      ["Which is better for beginners?", "Vortex, or just asking Stella."],
      ["Can I use both?", "Yes, for different games."],
    ],
    byHand: [
      "In Vortex, note your order, then choose Purge.",
      "Set up Mod Organizer 2 and install the same downloads from its Downloads tab.",
      "Put the order back and start the game through it.",
    ],
    related: ["game-mods/mod-organizer-2", "game-mods/vortex-mod-manager", "game-mods/mod-skyrim"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "r2modman-thunderstore",
    niche: "game-mods",
    searchPhrases: ["r2modman", "thunderstore mod manager", "r2modman install", "how to use r2modman", "thunderstore mods"],
    title: "r2modman and Thunderstore: mods for your whole group",
    description:
      "Set up r2modman with Stella (stella.sh): Thunderstore mods for Valheim, Lethal Company, REPO, Peak and more, shared with one code.",
    h1: "r2modman and Thunderstore, ready for your group",
    short: "r2modman and Thunderstore",
    lede: "One set of mods that everyone shares.",
    answer:
      "r2modman puts Thunderstore mods in games like Valheim, REPO and Peak. Stella (stella.sh) sets it up, picks mods that match and makes a code for friends.",
    gets: ["r2modman ready for your game", "Mods that match each other", "A code to share"],
    prompt:
      "Set up r2modman for Peak with a few fun mods and a code for my friends.",
    demo: {
      ack: "Setting it up and picking mods that match.",
      task: "Setting up r2modman",
      rows: ["Installing r2modman", "Adding five mods", "Making the code"],
      reply:
        "Peak has five mods in a profile called **Friday**. Send your friends the code in friday-code.txt.",
    },
    faq: [
      ["r2modman or Thunderstore's own app?", "Both get the same mods. r2modman has no ads."],
      ["Does it work on Steam Deck?", "Yes. Stella sets it up there."],
    ],
    byHand: [
      "Install r2modman and choose your game.",
      "Make a profile, then add mods from the Online tab.",
      "Press Start modded; share it with Settings, Export profile as code.",
    ],
    related: ["game-mods/mod-valheim", "game-mods/mod-lethal-company", "game-mods/install-bepinex"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-bepinex",
    niche: "game-mods",
    searchPhrases: ["bepinex", "bepinex install", "how to install bepinex", "bepinex not working", "bepinex config"],
    title: "BepInEx: install it for any Unity game",
    description:
      "Install BepInEx with Stella (stella.sh): the right one for your game, set up so mods load, on Windows, Linux or Steam Deck.",
    h1: "BepInEx, installed for your game",
    short: "Install BepInEx",
    lede: "The helper so many game mods run on, working.",
    answer:
      "BepInEx comes in several kinds, and only one fits your game. Stella (stella.sh) picks it, installs it and checks that mods load.",
    gets: ["The BepInEx that fits", "Mods loading", "Settings changed for you"],
    prompt:
      "Install BepInEx for my game and put these mods in.",
    demo: {
      ack: "Finding which BepInEx your game needs.",
      task: "Installing BepInEx",
      rows: ["Checking how the game is made", "Getting the right BepInEx", "Adding your mods"],
      reply:
        "BepInEx is in and your three mods load. Tell me if you'd like any of their settings changed.",
    },
    faq: [
      ["BepInEx 5 or 6?", "Most games use 5. Newer kinds of Unity games need 6."],
      ["Why does nothing happen?", "The wrong kind is the usual reason. Stella swaps it."],
    ],
    byHand: [
      "Get BepInEx from [its GitHub page](https://github.com/BepInEx/BepInEx/releases) for your system.",
      "Unzip it next to the game's .exe and start the game once.",
      "Put mods in BepInEx, plugins.",
    ],
    related: ["game-mods/r2modman-thunderstore", "game-mods/mod-silksong", "game-mods/ai-mod-maker"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "steam-deck-mods",
    niche: "game-mods",
    searchPhrases: [
      "steam deck mods",
      "how to mod games on steam deck",
      "steam deck skyrim mods",
      "nexus mods steam deck",
      "steam deck mods software",
    ],
    title: "Steam Deck mods: mod your games without a PC",
    description:
      "Mod games on Steam Deck with Stella (stella.sh): Skyrim, Stardew Valley, Cyberpunk and more, set up so they start in gaming mode.",
    h1: "Steam Deck mods without a PC",
    short: "Steam Deck mods",
    lede: "Modded games on the sofa.",
    answer:
      "Stella (stella.sh) runs in the Steam Deck's desktop mode and mods your games there, then they start from gaming mode as usual.",
    gets: ["Your games modded on the Deck", "Start them from gaming mode", "No PC needed"],
    prompt:
      "Add Stardew Valley Expanded to the game on my Steam Deck.",
    demo: {
      ack: "Setting it up on the Deck.",
      task: "Modding Stardew on your Deck",
      rows: ["Installing SMAPI", "Adding Expanded", "Setting it to start from Steam"],
      reply:
        "Stardew Valley Expanded is in. Go back to gaming mode and press Play.",
    },
    faq: [
      ["Do updates remove my mods?", "Game updates can switch some off. Ask Stella to put them back."],
      ["Which games work?", "Most PC games that take mods, from Skyrim to Balatro."],
    ],
    byHand: [
      "Hold the power button and choose Switch to Desktop.",
      "Find the game's folder: in Steam, right-click the game, Manage, Browse local files.",
      "Add the mods as on a PC, then any launch option their page names.",
    ],
    related: ["game-mods/mod-stardew-valley", "game-mods/mod-skyrim", "game-mods/mod-balatro"],
    platforms: ["linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-minecraft-mod",
    niche: "game-mods",
    searchPhrases: [
      "how to make a minecraft mod",
      "make a minecraft mod with ai",
      "ai minecraft mod maker",
      "how to make a minecraft mod without coding",
      "minecraft mod maker",
    ],
    title: "How to make a Minecraft mod without coding",
    description:
      "Make a Minecraft mod without coding: describe it to Stella (stella.sh) and it makes the mod and puts it in your game.",
    h1: "How to make a Minecraft mod without coding",
    short: "Make a Minecraft mod",
    lede: "Think of it, describe it, play it.",
    answer:
      "You don't need to code. Describe the Minecraft mod you want and Stella (stella.sh) makes it, pictures included, and puts it in your game.",
    gets: ["Your own mod, playable", "New items, mobs or rules", "Changes whenever you ask"],
    prompt:
      "Make a Minecraft mod with a grappling hook I can craft and swing from.",
    demo: {
      ack: "Fun. Making the hook now.",
      task: "Making your Minecraft mod",
      rows: ["Making the item and its picture", "Making it swing", "Putting it in your game"],
      reply:
        "Your grappling hook is in the game. Craft it from three iron and a string, then hold right-click to swing.",
    },
    faq: [
      ["Which Minecraft does it work on?", "Java Edition. Stella makes it for the version you play."],
      ["Can I share my mod?", "Yes. It's one file your friends drop in their mods folder."],
    ],
    byHand: [
      "With no code, [MCreator](https://mcreator.net) builds simple mods from blocks and forms.",
      "With code, start from the Fabric or NeoForge template and follow its guide.",
      "Put the finished file in your mods folder.",
    ],
    related: ["game-mods/make-a-minecraft-modpack", "game-mods/ai-mod-maker", "game-mods/install-minecraft-mods"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-minecraft-modpack",
    niche: "game-mods",
    searchPhrases: [
      "how to make a minecraft modpack",
      "make your own modpack",
      "how to make a modpack",
      "minecraft modpack maker",
      "how to share a modpack with friends",
    ],
    title: "How to make a Minecraft modpack and share it",
    description:
      "Make a Minecraft modpack with Stella (stella.sh): name a theme, and it picks mods that match and gives you one file to share.",
    h1: "How to make a Minecraft modpack",
    short: "Make a Minecraft modpack",
    lede: "Your favourite mods in one pack that friends can open.",
    answer:
      "Tell Stella (stella.sh) what kind of Minecraft you want. It picks mods that work together, builds the pack and gives you one file for friends.",
    gets: ["Mods that work together", "One file to share", "A pack for your server too"],
    prompt:
      "Make a cosy Minecraft modpack for 1.21 with farming, cooking and prettier builds, for me and three friends.",
    demo: {
      ack: "Picking mods that work together.",
      task: "Making your modpack",
      rows: ["Choosing 30 mods", "Checking they match", "Packing it up"],
      reply:
        "Your pack **Cosy Valley** has 30 mods. Send friends cosy-valley.mrpack; they open it in Modrinth or Prism.",
    },
    faq: [
      ["How do friends install it?", "They open the file in their launcher and press play."],
      ["Can I add mods later?", "Yes. Ask, and send friends the new file."],
    ],
    byHand: [
      "Make an instance in Prism Launcher or the Modrinth app.",
      "Add mods for one Minecraft version and one loader, and play it once.",
      "Export the instance and share the file.",
    ],
    related: [
      "game-mods/make-a-minecraft-mod",
      "game-mods/install-minecraft-mods",
      "game-mods/allocate-more-ram-to-minecraft",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-skyrim-mod",
    niche: "game-mods",
    searchPhrases: [
      "how to make a skyrim mod",
      "make a skyrim mod",
      "making skyrim mods with ai",
      "how to make a follower mod skyrim",
      "skyrim mod maker",
    ],
    title: "How to make a Skyrim mod just by describing it",
    description:
      "Make a Skyrim mod by describing it: Stella (stella.sh) builds it, adds it to your mod list and changes it when you ask.",
    h1: "How to make a Skyrim mod",
    short: "Make a Skyrim mod",
    lede: "Your own weapon, rule or follower in Skyrim.",
    answer:
      "Describe the Skyrim mod you'd like, such as a follower, a weapon or a rule change. Stella (stella.sh) builds it and adds it to your game.",
    gets: ["Your own mod in the game", "Changes when you ask", "A file you can share"],
    prompt:
      "Make a Skyrim mod where inns cost more at night and my horse runs faster on roads.",
    demo: {
      ack: "Two small changes. Building them now.",
      task: "Making your Skyrim mod",
      rows: ["Changing the inn prices", "Changing your horse", "Adding it to your mods"],
      reply:
        "Your mod **Night Roads** is on. Inns cost double after eight, and your horse is a third faster on roads.",
    },
    faq: [
      ["Do I need the Creation Kit?", "Not when Stella makes it."],
      ["Can it make a follower?", "Yes. Describe their look, skills and where to meet them."],
    ],
    byHand: [
      "Install the free Creation Kit from Steam.",
      "Load Skyrim's main file, make your change and save it as a new plugin.",
      "Switch the plugin on in your mod manager.",
    ],
    related: ["game-mods/ai-mod-maker", "game-mods/mod-skyrim", "game-mods/make-a-minecraft-mod"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "ai-mod-maker",
    niche: "game-mods",
    searchPhrases: ["ai mod maker", "how to make a mod", "make game mods with ai", "ai that makes mods", "how to make mods"],
    title: "AI mod maker: describe a mod and get it in your game",
    description:
      "An AI mod maker for real games: describe a mod to Stella (stella.sh) and it makes it and puts it in, from Minecraft to Skyrim.",
    h1: "AI mod maker: describe the mod you want",
    short: "AI mod maker",
    lede: "You have the idea. The mod gets made.",
    answer:
      "Stella (stella.sh) is an AI that makes mods for games you own. Describe the change, and it makes the mod, puts it in your game and adjusts it until you like it.",
    gets: ["A mod made from your words", "It in your game, ready to play", "As many changes as you like"],
    prompt:
      "Make a Balatro joker that gives more money each time I skip a blind.",
    demo: {
      ack: "Making your joker now.",
      task: "Making your mod",
      rows: ["Writing what the joker does", "Drawing its card", "Adding it to Balatro"],
      reply:
        "**Early Bird** is in the game. It earns $1 more for each blind you skip. Want it rarer or stronger?",
    },
    faq: [
      ["Which games can it make mods for?", "Minecraft, Stardew Valley, Skyrim, Balatro, RimWorld, GTA 5 and many more that take mods."],
      ["Do I need to code?", "No. You describe it and play it."],
      ["Is it really free?", "Yes, with the ChatGPT or Claude plan you already have."],
    ],
    byHand: [
      "Pick a game with an official or popular mod tool.",
      "Start from its example mod and change one thing at a time.",
      "Put it in the game's mods folder and try it.",
    ],
    related: ["game-mods/make-a-minecraft-mod", "game-mods/make-a-skyrim-mod", "game-mods/mod-balatro"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "skyrim-newer-version-than-skse",
    niche: "game-mods",
    searchPhrases: [
      "you are using a newer version of skyrim than this version of skse64 supports",
      "you are using a newer version of skyrim skse64",
      "skse version mismatch",
      "skyrim updated skse not working",
      "skse64 runtime version mismatch",
    ],
    title: "Newer version of Skyrim than this version of SKSE64 supports",
    description:
      "Skyrim updated and SKSE64 says it doesn't support this version? Stella (stella.sh) brings SKSE and your mods up to date, or steps Skyrim back to match.",
    h1: "You are using a newer version of Skyrim than this version of SKSE64 supports",
    short: "Skyrim newer than SKSE64 supports",
    lede: "Your modded Skyrim starting again after Steam updated it.",
    answer:
      "Steam updated Skyrim and your SKSE64 is built for the old version. Stella (stella.sh) gets the SKSE64 made for your new Skyrim, or, if your big mods aren't ready yet, steps Skyrim back to the version they all fit.",
    gets: [
      "Your Skyrim and SKSE64 versions compared",
      "The SKSE64 that matches, or Skyrim stepped back",
      "Steam set to update Skyrim only when you launch it",
    ],
    prompt:
      "Skyrim says I'm using a newer version than this version of SKSE64 supports. I have 300 mods in MO2. Get it working.",
    demo: {
      ack: "On it. Comparing your Skyrim and SKSE64 versions.",
      task: "Matching SKSE64 to your Skyrim",
      rows: ["Steam updated Skyrim last night", "Six of your mods aren't updated yet", "Stepping Skyrim back one version", "Saves copied before anything changed"],
      reply:
        "Steam's update got ahead of six mods you rely on, so Skyrim is back on the version they all support, with matching SKSE64. Your saves are copied in Documents/Skyrim backup. Launch through MO2 as usual.",
    },
    faq: [
      ["Should I update SKSE64 or downgrade Skyrim?", "Update once your bigger mods have caught up. Until then, stepping Skyrim back keeps the whole list working."],
      ["How do I stop Steam updating Skyrim?", "Steam has no off switch. Set Skyrim to update only when launched from Steam, then always start it through SKSE64. Stella sets that up for you."],
    ],
    byHand: [
      "Check SkyrimSE.exe's version (Properties, Details) and get the SKSE64 build for it from [skse.silverlock.org](https://skse.silverlock.org).",
      "Or roll back with the Skyrim downgrade patcher on Nexus Mods.",
      "Update Address Library for SKSE Plugins too.",
    ],
    related: [
      "game-mods/install-skse",
      "game-mods/skse-dll-plugin-failed-to-load",
      "game-mods/skyrim-crash-log",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "skse-dll-plugin-failed-to-load",
    niche: "game-mods",
    searchPhrases: [
      "a dll plugin has failed to load correctly",
      "a dll plugin has failed to load correctly skyrim skse",
      "racemenu incompatible with current version of the game",
      "a dll plugin has failed to load correctly racemenu",
      "address library for skse plugins not working",
    ],
    title: "A DLL plugin has failed to load correctly (Skyrim SKSE)",
    description:
      "Skyrim pops up 'A DLL plugin has failed to load correctly' at launch? Stella (stella.sh) updates each named mod and Address Library so nothing gets switched off.",
    h1: "A DLL plugin has failed to load correctly in Skyrim",
    short: "A DLL plugin has failed to load correctly",
    lede: "Every Skyrim mod on its list switched on again.",
    answer:
      "SKSE turns off any mod with its own DLL plugin that doesn't fit your Skyrim version, then shows this box. Stella (stella.sh) reads which ones were switched off, gets their matching versions and updates Address Library so they load.",
    gets: [
      "Each disabled plugin named, with why",
      "Matching versions of RaceMenu and the rest",
      "Address Library brought up to date",
    ],
    prompt:
      "Skyrim says a DLL plugin has failed to load correctly and lists RaceMenu and Engine Fixes. Fix them so they load.",
    demo: {
      ack: "On it. Reading the list SKSE switched off.",
      task: "Fixing failed DLL plugins in Skyrim",
      rows: ["RaceMenu: needs the newer build", "Engine Fixes: Address Library is old", "Updating both through Vortex"],
      reply:
        "Both load now. RaceMenu had an older build for your Skyrim version, and Engine Fixes was waiting on a newer Address Library. The popup is gone and character sliders are back.",
    },
    faq: [
      ["What does 'disabled, address library needs to be updated' mean?", "That mod looks up the game through Address Library, whose copy is older than your Skyrim. Updating Address Library alone often fixes several plugins at once."],
      ["What if a plugin has no update yet?", "Stella turns that one mod off cleanly so the rest keep working, or steps Skyrim back if it's one you can't play without."],
    ],
    byHand: [
      "Note each .dll listed in the popup and the reason beside it.",
      "Update those mods on Nexus Mods, picking the file for your Skyrim version.",
      "Install the All in one (all game versions) Address Library for SKSE Plugins.",
    ],
    related: [
      "game-mods/skyrim-newer-version-than-skse",
      "game-mods/install-skse",
      "game-mods/skyrim-load-order",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fallout-4-newer-version-than-f4se",
    niche: "game-mods",
    searchPhrases: [
      "you are using a newer version of fallout 4 than this version of f4se supports",
      "you are using a newer version of fallout 4",
      "looksmenu incompatible with current version of the game",
      "f4ee dll disabled incompatible with current version of the game",
      "f4se version mismatch",
    ],
    title: "Newer version of Fallout 4 than this version of F4SE supports",
    description:
      "Fallout 4 updated and F4SE or LooksMenu stopped loading? Stella (stella.sh) matches F4SE and your mods to the game, or sets the game back to fit them.",
    h1: "You are using a newer version of Fallout 4 than this version of F4SE supports",
    short: "Fallout 4 newer than F4SE supports",
    lede: "Modded Fallout 4 starting again after an update broke it.",
    answer:
      "Fallout 4 updated and F4SE, plus mods built on it like LooksMenu, no longer fit. Stella (stella.sh) installs the F4SE for your version and updated mods, or sets Fallout 4 back to the version your list was built for.",
    gets: [
      "F4SE matched to the Fallout 4 you have",
      "LooksMenu and other switched-off mods loading again",
      "Your saves copied before anything changes",
    ],
    prompt:
      "Fallout 4 says I'm using a newer version than F4SE supports, and LooksMenu is disabled. Get my modded game running.",
    demo: {
      ack: "On it. Checking which Fallout 4 you have now.",
      task: "Matching F4SE to Fallout 4",
      rows: ["Fallout 4 updated to the newest version", "Getting the F4SE built for it", "Updating LooksMenu and two others", "Copying your saves first"],
      reply:
        "F4SE now matches your Fallout 4, and LooksMenu, Buffout 4 and MCM have their updated versions. All three load. Your saves are copied to Documents/Fallout4 backup.",
    },
    faq: [
      ["Is it better to downgrade Fallout 4 for mods?", "If many of your mods haven't updated, yes. Stella checks your list first and picks whichever keeps the most of it working."],
    ],
    byHand: [
      "Check Fallout4.exe's version under Properties, Details.",
      "Get the matching F4SE from [f4se.silverlock.org](https://f4se.silverlock.org) or Nexus Mods.",
      "Update each mod the popup lists, or downgrade with the Fallout 4 downgrader.",
    ],
    related: [
      "game-mods/install-f4se",
      "game-mods/downgrade-fallout-4",
      "game-mods/mod-fallout-4",
    ],
    platforms: ["windows", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "script-hook-v-critical-error",
    niche: "game-mods",
    searchPhrases: [
      "script hook v critical error unknown game version",
      "script hook v critical error",
      "script hook v critical error gta 5 enhanced",
      "script hook v fatal error unknown game version",
      "script hook v critical error fix",
    ],
    title: "Script Hook V critical error: unknown game version? Fixed",
    description:
      "GTA 5 stopping with Script Hook V Critical Error: Unknown game version? Stella (stella.sh) matches Script Hook V to your update, so mods load again.",
    h1: "Script Hook V critical error: unknown game version",
    short: "Script Hook V critical error",
    lede: "GTA 5 with your mods running again after Rockstar's update.",
    answer:
      "Rockstar updated GTA 5 and your Script Hook V is older than the game, so it stops at launch. Stella (stella.sh) installs the newest Script Hook V for your version, Legacy or Enhanced, and checks your mods still fit.",
    gets: [
      "The newest Script Hook V for your game version",
      "Your mods checked against the new game version",
      "A clean switch to play online without mods",
    ],
    prompt:
      "GTA 5 says Script Hook V critical error, unknown game version, after the update. Get my mods working again.",
    demo: {
      ack: "On it. Checking your GTA 5 version.",
      task: "Fixing the Script Hook V error",
      rows: ["You're on GTA 5 Legacy, just updated", "Script Hook V update is out", "Replacing the two Script Hook files"],
      reply:
        "Script Hook V now matches the update, and your trainer and car mods load again. If a future update lands before Script Hook V catches up, ask me and I'll set the game to start without mods.",
    },
    faq: [
      ["Does Script Hook V work on GTA 5 Enhanced?", "Yes, current Script Hook V covers both. Mods written for its .NET add-on also need the Enhanced edition of that add-on, which Stella installs alongside."],
    ],
    byHand: [
      "Download the newest Script Hook V from [dev-c.com](http://www.dev-c.com/gtav/scripthookv/).",
      "Copy ScriptHookV.dll and dinput8.dll into the GTA 5 folder, replacing the old ones.",
      "No update yet? Move those two files out to play without mods.",
    ],
    related: [
      "game-mods/install-script-hook-v",
      "game-mods/gta-5-mods-not-working",
      "game-mods/mod-gta-5",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
];
