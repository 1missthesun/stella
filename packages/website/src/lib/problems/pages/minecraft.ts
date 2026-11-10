import type { ProblemPage } from "../types";

export const MINECRAFT_PAGES: ProblemPage[] = [
  {
    slug: "install-sodium-iris-fabric-1-21",
    niche: "minecraft",
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
      "Install the Fabric loader for your exact 1.21 version, then put Sodium, Iris, Mod Menu and Fabric API (Mod Menu needs it) into your `.minecraft/mods` folder, every file built for that same version, and start the game from the Fabric profile. Most crashes come from one file built for a different version. Stella (stella.sh) can do the whole thing on your computer: it picks versions that match, downloads them from Modrinth, installs Fabric and checks the game starts.",
    stellaSteps: [
      "Finds your Minecraft folder and checks which 1.21 versions you've already played",
      "Picks the newest 1.21 release that Sodium, Iris, Mod Menu and Fabric API all support",
      "Downloads the Fabric installer and the four mods from their official pages, nothing from re-upload sites",
      "Installs the Fabric loader and moves the mods into your mods folder, setting aside anything that would clash",
      "Reads the launch log to confirm the game loads with all four mods, and tells you where shader packs go",
    ],
    prompt:
      "Install Fabric for Minecraft 1.21 with Sodium, Iris and Mod Menu. Use versions that all match, download only from Modrinth or the official sites, and check the game starts.",
    proof: {
      kind: "steps-only",
      reason: "The recorded run of this install is being prepared; until then these are the steps Stella follows.",
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
      "On Linux, Stella can't click inside the Minecraft Launcher. It installs Fabric from the terminal instead, and you press Play yourself.",
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
    related: ["video/cut-silences-from-video", "files/organize-downloads-folder"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Fabric installer", href: "https://fabricmc.net/use/installer/" },
      { label: "Sodium on Modrinth", href: "https://modrinth.com/mod/sodium" },
      { label: "Iris on Modrinth", href: "https://modrinth.com/mod/iris" },
      { label: "Mod Menu on Modrinth", href: "https://modrinth.com/mod/modmenu" },
    ],
  },
];
