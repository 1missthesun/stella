import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const GAME_SERVERS_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-minecraft-server-for-friends",
    niche: "game-servers",
    searchPhrases: [
      "how to make a minecraft server for friends",
      "how to make a minecraft server",
      "how to make a minecraft server java",
      "how to make a minecraft server for free",
      "minecraft server for friends free",
    ],
    title: "How to make a Minecraft server for friends, free on your PC",
    description:
      "Want your own Minecraft world with friends? Ask Stella (stella.sh) to make the server on your computer, set the rules and hand you the address to share.",
    h1: "Make a Minecraft server for you and your friends",
    short: "Minecraft server for friends",
    lede: "Your own survival world, and one address your friends paste in to join.",
    answer:
      "Say how many are playing and what kind of world you want. Stella (stella.sh) builds the Java server on your computer, sets it up your way and gives you the address to send out.",
    gets: [
      "A world that's yours, with your seed, difficulty and view distance",
      "An icon you double-click on game night",
    ],
    prompt:
      "Make a free Minecraft Java server on this PC for me and four friends. Newest version, hard survival, keep inventory on. Tell me what to send them.",
    demo: {
      ack: "Sure, setting up a five-player survival server.",
      task: "Building your Minecraft server",
      rows: ["Downloaded the newest server", "Set hard survival and keep inventory", "Gave the server 4 GB memory", "Opened it to your friends"],
      reply:
        "Your server is running. Friends choose **Multiplayer, Add Server** and paste the address in **Invite.txt**. You're the admin, and only your friends get in. Next time, double-click **Start Minecraft Server** on your desktop.",
      files: ["Start Minecraft Server.bat", "Invite.txt"],
    },
    faq: [
      ["Does my PC have to stay on?", "While people play, yes. Or put it on a spare laptop or rented machine and it's there day and night."],
      ["Can we carry on our old single-player world?", "Yes. Name it and it becomes the server's world, builds and all."],
    ],
    byHand: [
      "Download the server from [PaperMC](https://papermc.io/downloads/paper) into its own folder.",
      "Install Java (25 for version 26.1 and newer), run it once, and accept the EULA in eula.txt.",
      "Forward port 25565 on your router, then share your address.",
    ],
    related: [
      "game-servers/make-a-modded-minecraft-server",
      "game-servers/minecraft-server-without-port-forwarding",
      "game-servers/minecraft-java-and-bedrock-server",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-modded-minecraft-server",
    niche: "game-servers",
    searchPhrases: [
      "how to make a modded minecraft server",
      "how to make a minecraft server with mods",
      "how to make a modded minecraft server with curseforge",
      "how to play modded minecraft with friends",
      "minecraft modpack server pack",
      "neoforge server setup",
    ],
    title: "How to make a modded Minecraft server for a modpack",
    description:
      "Playing a CurseForge or Modrinth pack with friends? Ask Stella (stella.sh) to build the matching modded server, set its memory and get everyone in.",
    h1: "Make a modded Minecraft server for your modpack",
    short: "Modded Minecraft server",
    lede: "Name the pack, and everyone lands in the same modded world.",
    answer:
      "Name a CurseForge or Modrinth pack, or point at your mods folder. Stella (stella.sh) builds a Forge, NeoForge or Fabric server that matches, leaves out the mods meant only for players, and starts it.",
    gets: [
      "The same pack version on the server and for every friend",
      "Memory sized to the pack and your computer",
      "A server pack made for you when the author didn't make one",
    ],
    prompt:
      "Make a server for All the Mods 10 so three friends and I can play together. This PC has 32 GB of memory.",
    demo: {
      ack: "Got it, building an ATM10 server for four.",
      task: "Building the ATM10 server",
      rows: ["Found the pack's server files", "Put in the Java it needs", "Set 10 GB for the server", "First world created"],
      reply:
        "ATM10 is ready in **Games/ATM10 Server**, with a start button on your desktop. **For your friends.txt** has the exact pack version to pick in CurseForge and the address to join.",
      files: ["Start ATM10 Server.bat", "For your friends.txt"],
    },
    faq: [
      ["Can I add more mods later?", "Yes. It goes on the server, and your friends get a new pack file to import."],
      ["What if one mod stops the server opening?", "It reads the crash, finds the mod behind it and swaps in the right version."],
    ],
    byHand: [
      "On the pack's CurseForge page, open Files, download the Server Pack and run its start file.",
      "No server pack? Install the Fabric, Forge or NeoForge server and copy mods and config, minus client-only mods.",
    ],
    related: [
      "game-servers/minecraft-server-crashing",
      "game-mods/make-a-minecraft-modpack",
      "game-servers/make-a-minecraft-server-for-friends",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "minecraft-server-crashing",
    niche: "game-servers",
    searchPhrases: [
      "minecraft server crashing on startup",
      "minecraft server won't start",
      "minecraft server java version",
      "unsupportedclassversionerror minecraft server",
      "minecraft server crashes when i join",
      "minecraft server crash report analyzer",
    ],
    title: "Minecraft server crashing on startup or wrong Java version",
    description:
      "Server closing by itself, or asking for another Java version? Ask Stella (stella.sh) to read the crash, fix the cause and bring your world back up.",
    h1: "Minecraft server crashing on startup",
    short: "Minecraft server crashes",
    lede: "The window flashes and closes. Get your world back up tonight.",
    answer:
      "Point it at the server folder. Stella (stella.sh) reads the crash report, works out whether it's Java, a mod, memory or a broken spot in the world, and fixes it.",
    gets: [
      "The right Java for your server, without touching your other games",
      "The one mod that breaks it, updated or removed",
      "A stuck mob or block cleared when a spot in the world crashes it",
    ],
    prompt:
      "I updated my Minecraft server and now it closes straight away. It says UnsupportedClassVersionError, class file version 69.",
    demo: {
      ack: "Reading the error and your server folder now.",
      task: "Fixing your Minecraft server",
      rows: ["Copied your world first", "Found the server opening in Java 21", "Added Java 25 for this server", "Started it and watched it load"],
      reply:
        "Fixed. Version **69** means the update needs **Java 25**, and your start file was opening Java 21. It now uses its own Java 25, and your other games keep theirs. The world loads, and a copy from before is in **Backups**.",
    },
    faq: [
      ["What about “Exception ticking entity”?", "One creature or block is crashing the world. Stella finds it in the report and removes just that."],
    ],
    byHand: [
      "Open the newest crash report, or logs/latest.log, and find the line starting “Caused by”.",
      "Match Java: 25 for 26.1 and newer, 21 for 1.20.5 to 1.21.11, 17 for 1.18 to 1.20.4, 8 for 1.16.5 and older.",
      "Point the start file at that Java, such as the one from [Adoptium](https://adoptium.net).",
    ],
    related: [
      "game-servers/make-a-modded-minecraft-server",
      "game-mods/minecraft-modpack-exit-code-1",
      "game-mods/fix-corrupted-minecraft-world",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "minecraft-server-without-port-forwarding",
    niche: "game-servers",
    searchPhrases: [
      "minecraft server without port forwarding",
      "how to host a minecraft server without port forwarding",
      "playit.gg minecraft server",
      "modded minecraft server without port forwarding",
      "how to host a game server without port forwarding",
      "tailscale minecraft server",
    ],
    title: "Host a Minecraft server without port forwarding (playit.gg)",
    description:
      "Friends can't connect and the router is no help? Ask Stella (stella.sh) to give your Minecraft or other game server an address that works from anywhere.",
    h1: "Host a Minecraft server without port forwarding",
    short: "Server without port forwarding",
    lede: "Dorm Wi-Fi, Starlink or a locked router: your friends still get in.",
    answer:
      "Leave the router alone. Stella (stella.sh) connects your server to playit.gg, a free service that gives it a public address, or sets up a private Tailscale network just for your group.",
    gets: [
      "An address friends use from any house, with your home one kept private",
      "It comes up together with the server",
      "Works for Palworld, Valheim, Terraria and Project Zomboid too",
    ],
    prompt:
      "My friends get “connection timed out” on my Minecraft server and I'm on college Wi-Fi with no router. Get them in.",
    demo: {
      ack: "No router needed. Let me give it a public address.",
      task: "Getting your friends connected",
      rows: ["Server runs fine on this PC", "Installed playit and linked it", "Pointed a new address at Minecraft", "Set both to start together"],
      reply:
        "Send your friends the address in **Join my server.txt**; they paste it under Multiplayer and install nothing. I had you sign in to playit once, in the browser. The address is live whenever **Start Server** is running.",
      files: ["Join my server.txt"],
    },
    faq: [
      ["playit.gg or Tailscale?", "playit suits most groups because friends install nothing. Tailscale is a private network: each friend installs it once."],
      ["I only want to open my single-player world.", "Ask for that. The Essential or e4mc mod invites friends straight into the world you're playing."],
    ],
    byHand: [
      "Install [playit.gg](https://playit.gg), run it and open the claim link to sign in.",
      "Add a Minecraft Java tunnel to local port 25565, then share its address.",
    ],
    related: [
      "game-servers/make-a-minecraft-server-for-friends",
      "game-servers/palworld-dedicated-server",
      "game-servers/whitelist-and-admins-minecraft-server",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "minecraft-java-and-bedrock-server",
    niche: "game-servers",
    searchPhrases: [
      "how to make a minecraft server for java and bedrock",
      "minecraft java and bedrock server",
      "crossplay minecraft server java and bedrock",
      "geyser crossplay server",
      "how to set up geyser and floodgate",
    ],
    title: "Make a Minecraft server for Java and Bedrock (crossplay)",
    description:
      "PC, phone, Xbox and Switch friends in one world. Ask Stella (stella.sh) to set up a Java and Bedrock crossplay server with Geyser and invite everyone.",
    h1: "Make a Minecraft server for Java and Bedrock players",
    short: "Java and Bedrock crossplay server",
    lede: "The friend on a phone, the one on Xbox and you on PC, in one world.",
    answer:
      "Say who plays on what. Stella (stella.sh) builds one server with Geyser and Floodgate, so Bedrock friends come in with the account they already have.",
    gets: [
      "Java and Bedrock in the same world, chatting together",
      "Your server in the Xbox, PlayStation or Switch friends list",
      "Short join steps written for each friend's device",
    ],
    prompt:
      "I play Minecraft Java, my sister is on an iPad and two friends are on Xbox and Switch. Make one server we can all join.",
    demo: {
      ack: "One world for all four, coming up.",
      task: "Building a crossplay server",
      rows: ["Made the Java server", "Added Geyser and Floodgate", "Set up the console friends list", "Wrote steps for each device"],
      reply:
        "All four of you can join the same world. You and the iPad use the addresses in **How to join.txt**. On Xbox and Switch, your friends add the server's Xbox account as a friend and it shows up under **Worlds**.",
      files: ["How to join.txt", "Start Crossplay Server.bat"],
    },
    faq: [
      ["Do Bedrock friends need to buy Java?", "No. Floodgate lets them in with their usual Xbox account."],
      ["Can it have mods?", "Yes. Fabric and NeoForge versions of Geyser exist, and Stella picks mods that Bedrock players can see too."],
    ],
    byHand: [
      "Set up a Paper server, then add Geyser and Floodgate from [geysermc.org](https://geysermc.org/download).",
      "Restart and open port 19132 for both TCP and UDP, or use playit.gg.",
      "For consoles, add MCXboxBroadcast with a spare Xbox account so the server appears in friends lists.",
    ],
    related: [
      "game-servers/make-a-minecraft-server-for-friends",
      "game-servers/minecraft-server-without-port-forwarding",
      "game-servers/whitelist-and-admins-minecraft-server",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "whitelist-and-admins-minecraft-server",
    niche: "game-servers",
    searchPhrases: [
      "how to whitelist a minecraft server",
      "minecraft whitelist not working",
      "how to give admin on minecraft server",
      "minecraft server op",
      "how to make yourself admin on a minecraft server",
    ],
    title: "How to whitelist a Minecraft server and add admins",
    description:
      "Only your friends in, and the right people in charge. Ask Stella (stella.sh) to whitelist your Minecraft server, give admin and fix names that won't join.",
    h1: "Whitelist a Minecraft server and pick the admins",
    short: "Whitelist and admins",
    lede: "Only the people you invited, with the right ones in charge.",
    answer:
      "Give it the names. Stella (stella.sh) turns the whitelist on, adds each friend, and makes the people you trust admins, with as much or as little power as you like.",
    gets: [
      "Strangers kept out, friends let straight in",
      "Helpers who can kick and teleport but not stop the server",
      "Everyone's spelling checked against their real account",
    ],
    prompt:
      "Let only Mossy_Fern, tinkerbee22, OakDad and me onto our Minecraft server. Make OakDad and me admins.",
    demo: {
      ack: "Adding the four of you now.",
      task: "Setting the guest list and admins",
      rows: ["Checked all four player names", "Turned the whitelist on", "Made you and OakDad admins", "Removed two names nobody knows"],
      reply:
        "All four names are in, and **you and OakDad** are admins. Two unknown names were on the old list; they're off now and saved in **Removed players.txt**.",
      files: ["Removed players.txt"],
    },
    faq: [
      ["My friend is on the list but still can't get in.", "Usually a changed name, or a Bedrock friend whose name starts with a dot. Stella checks both."],
      ["Can it do this for Palworld or Valheim?", "Yes. It sets the password, admins and banned players for those servers as well."],
    ],
    byHand: [
      "In the server window type whitelist on, then whitelist add and each name.",
      "Type op and a name to make an admin, deop to undo it.",
      "Set white-list and enforce-whitelist to true in server.properties so it stays on after a restart.",
    ],
    related: [
      "game-servers/make-a-minecraft-server-for-friends",
      "game-servers/minecraft-java-and-bedrock-server",
      "game-servers/make-a-discord-server",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "palworld-dedicated-server",
    niche: "game-servers",
    searchPhrases: [
      "palworld dedicated server setup",
      "how to make a palworld server",
      "palworld dedicated server",
      "palworld server settings",
      "palworld co op to dedicated server",
      "how to make a palworld server crossplay",
    ],
    title: "Palworld dedicated server setup, with your co-op world moved",
    description:
      "Play Palworld without waiting for the host. Ask Stella (stella.sh) to set up a dedicated server, move your co-op world and get Xbox and PS5 friends in.",
    h1: "Palworld dedicated server setup for your group",
    short: "Palworld dedicated server",
    lede: "Your base keeps going even when the host isn't playing.",
    answer:
      "Tell it how you like to play. Stella (stella.sh) installs the Palworld server, sets the rates and rules, brings over your co-op world and opens it to your friends.",
    gets: [
      "Catch rate, egg time and death rules the way you want",
      "Your co-op world moved, with the host's character kept",
      "Steam, Xbox, PS5 and Mac friends in one world",
    ],
    prompt:
      "Set up a Palworld server here with our co-op world. Faster eggs, keep items when we die. One of us is on PS5.",
    demo: {
      ack: "On it, your co-op world comes along too.",
      task: "Setting up your Palworld server",
      rows: ["Installed the Palworld server", "Moved the co-op world and your character", "Set egg time and death rules", "Listed it for your PS5 friend"],
      reply:
        "It's up, with your base and Pals intact. On Steam, join by the address in **Palworld server.txt**. On PS5, search **Pal Pals** in the community list. Eggs hatch sooner, and nothing drops when you die.",
      files: ["Palworld server.txt"],
    },
    faq: [
      ["Why can't my PS5 friend type an address?", "Consoles join Palworld servers from the community list, so Stella puts yours there with a password."],
    ],
    byHand: [
      "In Steam, show Tools in your library and install Palworld Dedicated Server.",
      "Edit PalWorldSettings.ini in Pal/Saved/Config/WindowsServer while the server is stopped.",
      "Open UDP 8211 on your router; add -publiclobby to the launch options for consoles.",
    ],
    platforms: ["windows", "linux"],
    related: ["game-mods/mod-palworld", "game-servers/automatic-game-server-backup", "game-servers/valheim-dedicated-server-with-mods"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "valheim-dedicated-server-with-mods",
    niche: "game-servers",
    searchPhrases: [
      "valheim dedicated server setup",
      "how to make a valheim server with mods",
      "valheim server mods",
      "how to make a valheim server for friends",
      "how to transfer valheim world to dedicated server",
      "valheim dedicated server mods",
    ],
    title: "Valheim dedicated server setup with mods and your old world",
    description:
      "A Valheim world that's open whenever your crew is. Ask Stella (stella.sh) to set up the server, move your world, add mods and match everyone's game.",
    h1: "Valheim dedicated server setup, mods included",
    short: "Valheim server with mods",
    lede: "Sail whenever you like, with your world and mods waiting.",
    answer:
      "Name the world and the mods. Stella (stella.sh) sets up the Valheim server, moves your world onto it, adds the mods and makes a matching set for your friends.",
    gets: [
      "Your longhouse and portals, right where you built them",
      "The same mods and versions for the whole crew",
      "Raids, resources and death penalty set your way",
    ],
    prompt:
      "Move our Valheim world Midgaard to a dedicated server here. Add shared crafting from chests and bigger stacks. Five of us on Steam.",
    demo: {
      ack: "Midgaard is moving to its own server.",
      task: "Setting up the Valheim server",
      rows: ["Copied Midgaard, then moved it", "Added both mods to the server", "Made a matching Thunderstore profile", "Set the name and password"],
      reply:
        "Midgaard is running on your server. Friends import the code in **Crew mods.txt** into r2modman, then choose **Join Game** and the address. The password is in there too; the untouched world is in **Documents/Valheim backup**.",
      files: ["Crew mods.txt"],
    },
    faq: [
      ["Can Xbox or PS5 friends join?", "Yes, with crossplay on and mods off. Say who's on a console and it sets the server up like that."],
    ],
    byHand: [
      "Install Valheim Dedicated Server in Steam's Tools and edit the start script: name, world, password.",
      "Copy your world's .db and .fwl from AppData/LocalLow/IronGate/Valheim/worlds_local to the server.",
      "Drop BepInExPack_Valheim and your mods in the server folder, with crossplay off.",
      "Open UDP 2456 and 2457, then join by address.",
    ],
    platforms: ["windows", "linux"],
    related: ["game-mods/mod-valheim", "game-servers/automatic-game-server-backup", "game-servers/palworld-dedicated-server"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "modded-terraria-server",
    niche: "game-servers",
    searchPhrases: [
      "how to make a terraria server with mods",
      "tmodloader server setup",
      "how to make a terraria server",
      "terraria calamity server",
      "how to host a dedicated modded terraria server",
    ],
    title: "How to make a Terraria server with mods (tModLoader)",
    description:
      "Calamity with friends, minus the version mismatch. Ask Stella (stella.sh) to make a modded Terraria server, pick the world and get everyone on one list.",
    h1: "Make a Terraria server with mods for your friends",
    short: "Modded Terraria server",
    lede: "Calamity night with the whole group on the same mods.",
    answer:
      "Say which mods and how hard the world should be. Stella (stella.sh) sets up a tModLoader server, makes the world, and gives friends the same mod list in one go.",
    gets: [
      "A fresh or existing world, any size and difficulty",
      "Friends join from Steam, nothing to set on the router",
      "One mod pack everybody switches on",
    ],
    prompt:
      "Make a Terraria server with Calamity, its music, Boss Checklist and Recipe Browser. Large expert world, six players, with a password.",
    demo: {
      ack: "Calamity for six, starting with the mods.",
      task: "Setting up the tModLoader server",
      rows: ["Fetched Calamity and the other mods", "Made a large expert world", "Saved a mod pack to share", "Let your Steam friends join"],
      reply:
        "The world **Brimstone Bay** is up with all four mods. Friends subscribe from the list in **Calamity night.txt**, switch on the same pack, then right-click your name in Steam and pick **Join Game**. The password is inside.",
      files: ["Calamity night.txt"],
    },
    faq: [
      ["Can we use our existing world?", "Yes. Both of its files move across, so your modded chests and items come along."],
      ["Can a friend on plain Terraria join?", "They get tModLoader free on Steam. For phones, ask for a regular Terraria server."],
    ],
    byHand: [
      "Install tModLoader on Steam, subscribe to the mods and save a mod pack from the Mod Packs menu.",
      "Run start-tModLoaderServer from its install folder and choose the Steam friends option.",
      "To host elsewhere, copy the pack's install.txt and enabled.json.",
    ],
    related: ["game-mods/mod-terraria", "game-servers/valheim-dedicated-server-with-mods", "game-servers/project-zomboid-server-for-friends"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "project-zomboid-server-for-friends",
    niche: "game-servers",
    searchPhrases: [
      "how to make a project zomboid server for friends",
      "how to make a project zomboid server with mods",
      "project zomboid dedicated server setup",
      "project zomboid server settings",
      "project zomboid server failed to respond",
      "how to make a project zomboid server build 42",
    ],
    title: "How to make a Project Zomboid server for friends, with mods",
    description:
      "Survive Knox County together. Ask Stella (stella.sh) to make a Project Zomboid server for friends, add Workshop mods and set zombies and loot your way.",
    h1: "Make a Project Zomboid server for your friends",
    short: "Project Zomboid server",
    lede: "Your group, your Workshop mods, and as many zombies as you can take.",
    answer:
      "Describe the apocalypse you want. Stella (stella.sh) sets up the server, adds your Workshop collection, sets zombies, loot and the calendar, and tells friends how to join.",
    gets: [
      "Zombie speed, numbers, loot and XP set in plain words",
      "A whole Workshop collection added from its link",
      "“Server failed to respond” sorted out",
    ],
    prompt:
      "Make a Project Zomboid build 42 server for five. Slow zombies but lots of them, rare loot, no infection, plus this Workshop collection link.",
    demo: {
      ack: "Reading the collection, then the rules.",
      task: "Setting up the Zomboid server",
      rows: ["Installed the build 42 server", "Added 14 mods in working order", "Set slow hordes and rare loot", "Made your admin login"],
      reply:
        "The server **Muldraugh Mates** is up. Of the 16 mods, 14 fit build 42; I left two out and listed them in **Zomboid mods.txt**. Friends join by the address in there, and their game fetches the mods itself.",
      files: ["Zomboid mods.txt"],
    },
    faq: [
      ["Can we change the rules halfway through?", "Yes. Say “more food”, and it's applied at the next restart with your characters kept."],
    ],
    byHand: [
      "Install Project Zomboid Dedicated Server from Steam's Tools list and run it once to set the admin password.",
      "Edit the .ini in Zomboid/Server: WorkshopItems takes the numbers, Mods takes the mod IDs.",
      "Zombies and loot live in the SandboxVars file beside it.",
      "Open UDP 16261 and 16262, or use playit.gg.",
    ],
    related: ["game-mods/mod-project-zomboid", "game-servers/automatic-game-server-backup", "game-servers/minecraft-server-without-port-forwarding"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "automatic-game-server-backup",
    niche: "game-servers",
    searchPhrases: [
      "automatic backup minecraft server",
      "backup minecraft server",
      "backup minecraft server while running",
      "palworld server backup",
      "valheim server backup",
      "game server backup",
    ],
    title: "Automatic backup for a Minecraft, Palworld or Valheim server",
    description:
      "Never lose the group's world. Ask Stella (stella.sh) to back up your Minecraft or other game server automatically, and bring any day back in one go.",
    h1: "Automatic backup for a Minecraft or other game server",
    short: "Automatic game server backups",
    lede: "Someone blew up the town? Go back to yesterday.",
    answer:
      "Choose how often. Stella (stella.sh) copies the server's world on a schedule, even with people playing, keeps the last few days and puts any of them back when you ask.",
    gets: [
      "Copies every few hours, in dated folders",
      "A second copy in Google Drive, OneDrive or on another disk",
      "Old copies tidied so the disk never fills",
    ],
    prompt:
      "Back up our Minecraft and Palworld servers every three hours, keep a week of them, and put a daily copy in my Google Drive.",
    demo: {
      ack: "Finding both worlds first.",
      task: "Setting up server backups",
      rows: ["Found both servers' worlds", "Set saving to pause during copies", "Every three hours, seven days kept", "Daily copy into Google Drive"],
      reply:
        "Both worlds now copy every three hours into **Server Backups**, named by date and time, and each night's copy lands in **Google Drive**. The first ones are there already. To go back, tell me the day.",
      files: ["Minecraft 2026-11-24 18-00.zip", "Palworld 2026-11-24 18-00.zip"],
    },
    faq: [
      ["Can I get back just one player's things?", "Often, yes. In Minecraft each player has a separate file, so one lost inventory can return alone."],
    ],
    byHand: [
      "In the Minecraft server window type save-off, then save-all, copy the world folder, then save-on.",
      "Palworld keeps worlds in Pal/Saved/SaveGames; Valheim in its worlds_local folder.",
      "Repeat it with Windows Task Scheduler or cron, or add a mod such as Simple Backups.",
    ],
    related: ["game-servers/make-a-minecraft-server-for-friends", "game-servers/palworld-dedicated-server", "game-mods/back-up-minecraft-worlds"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-discord-server",
    niche: "game-servers",
    searchPhrases: [
      "how to make a discord server",
      "discord server setup",
      "discord server roles",
      "discord server template",
      "ai discord server maker",
      "set up discord server",
    ],
    title: "How to make a Discord server with roles and channels set up",
    description:
      "Describe your group and get the whole Discord server: channels, roles, rules and a welcome page. Ask Stella (stella.sh) and it builds it in your account.",
    h1: "Make a Discord server with roles and channels",
    short: "Make a Discord server",
    lede: "Channels, roles, rules and a welcome, built around your group.",
    answer:
      "Describe who it's for. Stella (stella.sh) creates the Discord server in your browser, with channels, roles, permissions and rules, then hands you the invite.",
    gets: [
      "Colored roles with the right people able to do the right things",
      "Private rooms for mods, and voice rooms per game",
      "Members pick their own roles when they arrive",
    ],
    prompt:
      "Make a Discord server for my gaming group: Minecraft, Valheim and movie nights. Roles for admins, mods and each game, plus a mods-only room.",
    demo: {
      ack: "Building it in your Discord now.",
      task: "Building your Discord server",
      rows: ["Created channels for each game", "Made six roles with colors", "Wrote the rules and welcome", "Let newcomers choose their games"],
      reply:
        "**Campfire Crew** is live in your account: 11 channels, six roles and a private mod room. New people read the rules, tap the games they play and see only those rooms. The invite, set to never expire, is copied and ready to paste.",
    },
    faq: [
      ["Can it clean up a server I already have?", "Yes. It sorts channels, merges duplicate roles and fixes who sees what."],
    ],
    byHand: [
      "In Discord click the plus in the server list, then Create My Own or pick a template.",
      "Add roles under Server Settings, Roles, and drag the highest to the top.",
      "Turn on Community, then use Onboarding so people choose roles.",
    ],
    related: ["game-servers/make-a-discord-bot", "game-servers/game-server-status-discord-bot", "game-servers/make-a-minecraft-server-for-friends"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-discord-bot",
    niche: "game-servers",
    searchPhrases: [
      "how to make a discord bot",
      "make your own discord bot without coding",
      "how to make a discord bot with ai",
      "how to make a discord music bot",
      "discord bot welcome message on join",
      "custom discord bot",
    ],
    title: "How to make a Discord bot: music, welcome, custom commands",
    description:
      "Your own Discord bot with your own commands, no coding. Ask Stella (stella.sh) to make one that plays music, greets people or runs game night for you.",
    h1: "Make your own Discord bot without coding",
    short: "Make a Discord bot",
    lede: "Music, welcomes and your group's own commands, under your bot's name.",
    answer:
      "Describe what it should do. Stella (stella.sh) writes the bot, creates it in your Discord account, invites it to your server and keeps adding commands as you think of them.",
    gets: [
      "Your bot's name, picture and personality",
      "Play, skip and queue songs in voice",
      "Welcome messages, polls, birthdays, movie picks, anything you can describe",
    ],
    prompt:
      "Make a Discord bot called Biscuit for our server. It greets new people, plays songs from my Music folder in voice, and picks a game when we type /pick.",
    demo: {
      ack: "Biscuit, coming right up.",
      task: "Making the Biscuit bot",
      rows: ["Created Biscuit in your account", "Wrote greeting, music and pick commands", "Invited it to your server"],
      reply:
        "**Biscuit** is online in your server. Try **/play** with a song name in voice, or **/pick** to choose tonight's game; new members get a hello in #welcome. It runs from **Documents/Biscuit** and starts with your computer.",
      files: ["Start Biscuit.bat", "games to pick.txt"],
    },
    faq: [
      ["Can the bot stay online around the clock?", "Yes. Ask to move it to a spare computer, a Raspberry Pi or an online host, and it runs there."],
      ["Can I change it later?", "Say it in one line, like “make Biscuit ruder”, and the bot restarts with the change."],
    ],
    byHand: [
      "Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), add a bot, copy its token and invite it from OAuth2, URL Generator.",
      "Turn on Server Members Intent so it can greet people.",
      "Write it in discord.js or discord.py, and keep it running on an always-on computer.",
    ],
    related: ["game-servers/game-server-status-discord-bot", "game-servers/make-a-discord-server", "game-servers/make-a-minecraft-server-for-friends"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "game-server-status-discord-bot",
    niche: "game-servers",
    searchPhrases: [
      "minecraft server status discord bot",
      "discord bot to show minecraft server status",
      "game server status discord bot",
      "discord bot server status",
      "palworld server status discord bot",
    ],
    title: "Discord bot for Minecraft or game server status and players",
    description:
      "Let Discord say when the game server is up and who's on. Ask Stella (stella.sh) to make a status bot for your Minecraft, Palworld or Valheim server.",
    h1: "Discord bot that shows Minecraft server status",
    short: "Game server status in Discord",
    lede: "No more “is the server up?” Discord says so, with who's playing.",
    answer:
      "Stella (stella.sh) makes a bot that watches your game server and posts in Discord when it opens, closes or somebody joins, plus one pinned message that's always current.",
    gets: [
      "A pinned card with online or offline, players and the address",
      "A ping to the right role when the server opens",
      "Optional posts for joins, deaths and achievements",
    ],
    prompt:
      "Post in our Discord's #minecraft channel when my server goes online or down, show who's playing, and ping the Miners role when it opens.",
    demo: {
      ack: "I'll hook the server up to #minecraft.",
      task: "Making a server status bot",
      rows: ["Made the bot in your Discord", "Connected it to the Minecraft server", "Pinned a live status card", "Set it to ping Miners"],
      reply:
        "**#minecraft** now has a pinned card with status, players and the address, refreshed every minute. Opening the server pings **Miners** once, and closing it posts “closed for the night”. The bot starts along with the server.",
    },
    faq: [
      ["Can people start the server from Discord?", "Yes. Ask for a /start command that only your chosen role can use."],
    ],
    byHand: [
      "For Minecraft, add DiscordSRV (Paper) or Simple Discord Link (Fabric, Forge, NeoForge) and paste your bot's token.",
      "For other games, host a status bot such as [DiscordGSM](https://discordgsm.com) and add the server's address.",
    ],
    related: ["game-servers/make-a-discord-bot", "game-servers/make-a-discord-server", "game-servers/palworld-dedicated-server"],
    lastChecked: "2026-11-24",
  }),
];
