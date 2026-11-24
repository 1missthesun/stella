import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const MAKE_GAMES_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-game-without-coding",
    niche: "make-games",
    searchPhrases: [
      "make a game without coding",
      "make a game with ai",
      "ai game maker",
      "make my own game",
      "make a game without coding for free",
    ],
    title: "How to make a game without coding (just describe it)",
    description:
      "Got a game idea but can't code? Describe it to Stella (stella.sh). It makes the game on your computer, opens it to play, and changes it each time you ask.",
    h1: "How to make a game without coding",
    short: "Make a game without coding",
    lede: "Describe the game in your head. Play it a few minutes later.",
    answer:
      "Say what the game is about, how you win and how it should feel. Stella (stella.sh) makes it on your computer, opens it in your browser to play, and reworks it whenever something isn't fun yet.",
    gets: [
      "A playable game from a few sentences",
      "Opens in your browser, nothing to install",
      "New levels, rules or looks when you ask",
    ],
    prompt:
      "Make a game where a cat knocks cups off a table before the owner turns around. Cute, with a high score.",
    demo: {
      ack: "Love it. Making your cup game now.",
      task: "Making your cat and cups game",
      rows: ["Drawing the cat, cups and table", "Adding the owner who turns around", "Keeping score and a best score"],
      reply:
        "Your game **Cup Cat** is in Documents/Games and open in your browser. Press space to swipe a cup. If the owner sees you, the round ends. Want more cups or a faster owner?",
      files: ["Cup Cat/index.html"],
    },
    faq: [
      ["Can I make a game with AI for free?", "Yes. Stella runs on the ChatGPT, Claude or Gemini plan you already have, and the game it makes is yours to keep and share."],
      ["Can my friends play it?", "Yes. Ask Stella to put it on itch.io or another free game site under your account, and you get a link to send."],
    ],
    byHand: [
      "Block-based tools like [Scratch](https://scratch.mit.edu) or [GDevelop](https://gdevelop.io) let you build a game without writing code.",
      "Or ask a chatbot for a one-page game and save it as an .html file.",
    ],
    related: ["make-games/make-a-2d-platformer-game", "make-games/make-a-video-game-as-a-gift", "apps/make-an-app-without-coding"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-roblox-game",
    niche: "make-games",
    searchPhrases: [
      "how to make a roblox game",
      "how to make a roblox game with ai",
      "how to make a roblox game with claude",
      "how to make a roblox game using ai",
      "ai game maker roblox",
    ],
    title: "How to make a Roblox game with AI, no scripting needed",
    description:
      "Make your own Roblox game by describing it. Stella (stella.sh) builds the map and writes the scripts inside Roblox Studio, then you press Play and publish.",
    h1: "How to make a Roblox game with AI",
    short: "Make a Roblox game",
    lede: "Your Roblox game idea, built in Studio while you watch.",
    answer:
      "Open Roblox Studio and tell Stella (stella.sh) the game you want. It connects to Studio's own helper for AI, builds the world and writes every script in your place, then you press Play to try it.",
    gets: [
      "A Roblox game built from your idea",
      "Map, rules, coins and rounds made for you",
      "Changes while Studio stays open",
    ],
    prompt:
      "Make a Roblox game where players collect glowing mushrooms in a forest and the one with the most after five minutes wins.",
    demo: {
      ack: "Fun idea. Building your mushroom forest in Studio.",
      task: "Building your Roblox mushroom game",
      rows: ["Linking up with Roblox Studio", "Building the forest and spawning mushrooms", "Adding a five minute round and winner"],
      reply:
        "Your forest is built in the place you have open. Mushrooms pop up around the trees, the board counts each player's haul, and a winner shows after five minutes. Press **Play** to try it.",
    },
    faq: [
      ["Do I need Roblox Studio?", "Yes, it's free from Roblox. Stella sets it up and turns on the link it uses to build in your place."],
      ["How do I make my Roblox game public?", "In Studio, publish it, then set it to Public in the game's settings. Stella can write the name, description and tags."],
    ],
    byHand: [
      "Install [Roblox Studio](https://create.roblox.com) and start from a template like Obby or Racing.",
      "Add parts from the toolbox and write scripts in Luau, Roblox's own language.",
      "Publish from the File menu and set the game to Public.",
    ],
    related: ["make-games/roblox-studio-scripts", "make-games/make-an-obby-in-roblox", "make-games/make-a-fortnite-map"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "roblox-studio-scripts",
    niche: "make-games",
    searchPhrases: [
      "roblox studio scripts",
      "roblox studio script generator",
      "roblox leaderboard script",
      "roblox shop script",
      "roblox door script",
    ],
    title: "Roblox Studio scripts: leaderboards, shops and doors",
    description:
      "Need a Roblox leaderboard, a shop or a door that opens? Tell Stella (stella.sh). It writes the script and puts it in the right spot in your Studio game.",
    h1: "Roblox Studio scripts, written and put in for you",
    short: "Roblox Studio scripts",
    lede: "Say what should happen in your game. It just starts working.",
    answer:
      "Skip copying scripts from videos. Tell Stella (stella.sh) what you want, like a coins leaderboard or a shop, and it writes the script and places it in your Roblox Studio game, ready to press Play.",
    gets: [
      "Leaderboards for coins, kills or time played",
      "Shops that take coins and give items",
      "Doors, buttons and teleports that work",
      "Fixes when a script you pasted is broken",
    ],
    prompt:
      "Add a coins leaderboard to my Roblox game, plus a shop where 50 coins buys a speed coil, and save coins between visits.",
    demo: {
      ack: "Got it. Adding coins and a shop to your game.",
      task: "Adding coins and a shop",
      rows: ["Adding a coins column to the board", "Saving coins when players leave", "Building the shop window and speed coil"],
      reply:
        "Done. Players see **Coins** on the board and keep them next visit. Walk up to the shop stand to buy the speed coil for 50. Press **Play** to try it.",
    },
    faq: [
      ["My script from a video doesn't work. Can it fix that?", "Yes. Stella reads the script where you put it, finds why it fails and fixes it in place."],
      ["Do saved coins work in Studio tests?", "Turn on Studio access to saving in Game Settings. Stella switches it on for you."],
    ],
    byHand: [
      "Scripts go in ServerScriptService; leaderboards are made when a player joins.",
      "Saving needs DataStoreService and Studio access turned on in Game Settings.",
      "Roblox's [Creator Hub docs](https://create.roblox.com/docs) have examples for each.",
    ],
    related: ["make-games/make-a-roblox-game", "make-games/make-an-obby-in-roblox", "make-games/make-a-game-without-coding"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-an-obby-in-roblox",
    niche: "make-games",
    searchPhrases: [
      "how to make an obby on roblox",
      "how to make an obby in roblox studio",
      "roblox obby checkpoint script",
      "roblox checkpoint script",
      "how to make an obby game in roblox",
    ],
    title: "How to make an obby on Roblox, checkpoints included",
    description:
      "Make a Roblox obby with stages, lava jumps and working checkpoints. Describe it to Stella (stella.sh) and it builds it in Roblox Studio for you to play.",
    h1: "How to make an obby on Roblox",
    short: "Make an obby on Roblox",
    lede: "Jumps, lava and checkpoints, laid out from your description.",
    answer:
      "Say how many stages, the theme and how hard it gets. Stella (stella.sh) builds the obby in Roblox Studio with kill bricks, moving platforms and checkpoints that remember your stage.",
    gets: [
      "Stages that get harder as you go",
      "Checkpoints that save each player's stage",
      "A stage counter on the leaderboard",
    ],
    prompt:
      "Make a candy themed obby with 20 stages, lava between jumps, a few spinning bars and checkpoints that save.",
    demo: {
      ack: "Sweet. Laying out your candy obby now.",
      task: "Building your candy obby",
      rows: ["Laying out 20 candy stages", "Adding lava, spinning bars and moving platforms", "Saving each player's last checkpoint"],
      reply:
        "Your candy obby is in Studio with 20 stages. Stage 1 is easy, the last five have spinning bars. Fall in lava and you're back at your last checkpoint. The **Stage** number shows on the board.",
    },
    faq: [
      ["Can I make it harder or easier later?", "Yes. Say which stages, and Stella moves the jumps, speeds up the bars or adds more checkpoints."],
      ["Does the checkpoint script save when players leave?", "Yes, if you ask. Players come back to the stage they reached."],
    ],
    byHand: [
      "Start from the Obby template in [Roblox Studio](https://create.roblox.com).",
      "Use SpawnLocation parts as checkpoints and a touched event to save the stage.",
      "Color kill bricks red and reset the player's health when touched.",
    ],
    related: ["make-games/roblox-studio-scripts", "make-games/make-a-roblox-game", "make-games/make-a-2d-platformer-game"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-visual-novel-with-renpy",
    niche: "make-games",
    searchPhrases: [
      "how to make a visual novel",
      "how to make a visual novel on renpy",
      "ren'py tutorial",
      "visual novel maker free",
      "how to make a visual novel game without coding",
    ],
    title: "How to make a visual novel in Ren'Py from your story",
    description:
      "Turn your story into a visual novel with choices and endings. Stella (stella.sh) sets up Ren'Py, writes the scenes and builds a game you can share.",
    h1: "How to make a visual novel in Ren'Py",
    short: "Make a visual novel",
    lede: "Your story, characters and choices, playable as a real game.",
    answer:
      "Give Stella (stella.sh) your story, a doc of scenes or just the idea. It sets up Ren'Py, writes the dialogue, choices and endings, places your character art and backgrounds, and builds a game people can download.",
    gets: [
      "Choices that lead to different endings",
      "Your art, or simple stand-ins to start",
      "Music, save slots and a title screen",
      "A download for Windows, Mac and Linux",
    ],
    prompt:
      "Turn my story in Documents/Lighthouse.docx into a visual novel with two choices and three endings. Use my drawings in the Art folder.",
    demo: {
      ack: "Lovely story. Turning it into your visual novel.",
      task: "Making your Lighthouse visual novel",
      rows: ["Setting up Ren'Py", "Splitting the story into scenes", "Writing two choices and three endings", "Placing your drawings and backgrounds"],
      reply:
        "**Lighthouse** opens from Documents/Games. The first choice is at the storm, the second at the letter, and each ending has its own last scene. Want a gallery of endings unlocked after playing?",
      files: ["Lighthouse/game/script.rpy", "Lighthouse-1.0-pc.zip"],
    },
    faq: [
      ["Is Ren'Py free?", "Yes, Ren'Py is free for any game, including ones you sell."],
      ["Can people play it in a browser?", "Yes. Stella builds a web version you can put on itch.io for a link anyone can open."],
    ],
    byHand: [
      "Download [Ren'Py](https://www.renpy.org), open the launcher and create a new project.",
      "Write scenes in script.rpy with `label`, `menu` and `jump`.",
      "Use Build Distributions in the launcher to make the downloads.",
    ],
    related: ["make-games/make-an-rpg-with-rpg-maker", "make-games/make-a-video-game-as-a-gift", "make-games/make-a-game-without-coding"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-2d-platformer-game",
    niche: "make-games",
    searchPhrases: [
      "how to make a 2d platformer game",
      "how to make a platformer game",
      "how to make a 2d platformer in godot",
      "how to make a platformer in godot",
    ],
    title: "How to make a 2D platformer game in Godot, no coding",
    description:
      "Make your own 2D platformer with jumps, enemies and levels. Stella (stella.sh) builds it in Godot with free game art and gives you a game to double-click.",
    h1: "How to make a 2D platformer game",
    short: "Make a 2D platformer",
    lede: "Run, jump, grab coins. Your levels, your rules.",
    answer:
      "Describe your hero, the world and what makes a level tricky. Stella (stella.sh) builds the platformer in Godot, the free game maker, using free game art, and hands you a game you double-click to play.",
    gets: [
      "Levels with jumps, enemies and coins",
      "Jumping that feels right, tuned on request",
      "A game file friends can download",
    ],
    prompt:
      "Make a 2D platformer about a frog who hops across lily pads. Three levels, flies to collect, and fish that jump out at you.",
    demo: {
      ack: "Ribbit. Building your frog platformer now.",
      task: "Building your frog platformer",
      rows: ["Setting up Godot", "Picking free pond art and sounds", "Building three lily pad levels", "Adding jumping fish and flies"],
      reply:
        "**Frog Hop** is in Documents/Games. Arrow keys move, space jumps, and the fish leap higher each level. Collect every fly to open the next pond. Want a boss turtle at the end?",
      files: ["Frog Hop/project.godot", "Frog Hop.exe"],
    },
    faq: [
      ["Do I need to learn Godot?", "No. Stella makes and changes the game for you. Open it in Godot only if you're curious."],
      ["Can I use my own drawings?", "Yes. Drop them in a folder and Stella swaps them in for the hero, enemies or backgrounds."],
    ],
    byHand: [
      "Install [Godot](https://godotengine.org), make a 2D scene with a CharacterBody2D for the player.",
      "Draw levels with a TileMap and free tiles from [Kenney](https://kenney.nl).",
      "Use Project, Export to make a game file for Windows, Mac or Linux.",
    ],
    related: ["make-games/make-a-game-without-coding", "make-games/make-an-rpg-with-rpg-maker", "make-games/make-an-obby-in-roblox"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-video-game-as-a-gift",
    niche: "make-games",
    searchPhrases: [
      "custom video game gift",
      "make a game for my girlfriend",
      "personalised video game gift",
      "making a game for my boyfriend",
      "make a birthday game for my kid",
    ],
    title: "Make a custom video game gift starring someone you love",
    description:
      "Make a custom video game as a gift: your kid, partner or friend as the hero, with your photos and inside jokes. Stella (stella.sh) makes it ready to play.",
    h1: "Make a custom video game gift",
    short: "Make a video game as a gift",
    lede: "A game where they're the hero, full of things only you know.",
    answer:
      "Tell Stella (stella.sh) who it's for and the moments to put in. It makes a short game starring them, using your photos and inside jokes, with a message at the end, and gives you a link or file to send.",
    gets: [
      "Them as the hero, from your photos",
      "Levels built on your shared memories",
      "A message or surprise at the finish",
      "A link to send, or a file for their computer",
    ],
    prompt:
      "Make a birthday game for my son Leo, turning 7. He's a dinosaur hunting for his lost birthday cake. Use photos from Pictures/Leo.",
    demo: {
      ack: "Happy birthday, Leo. Making his dinosaur game now.",
      task: "Making Leo's birthday game",
      rows: ["Turning Leo's photo into a dino hero", "Building three levels to find the cake", "Adding a happy birthday finish"],
      reply:
        "**Leo's Cake Hunt** is in Documents/Games. Dino Leo stomps through jungle, volcano and kitchen, and finds his cake with candles and a birthday song. It's ready to play on any computer.",
      files: ["Leos Cake Hunt/index.html"],
    },
    faq: [
      ["Can I put in our own jokes and places?", "Yes. Tell Stella the story, nicknames and places, and they become levels, signs and characters."],
      ["Can they play it on a phone?", "Yes. Stella can put it online under your free itch.io account so it opens from a link."],
    ],
    byHand: [
      "Make a simple game in [Scratch](https://scratch.mit.edu) and upload photos as costumes.",
      "Or build a short choose-your-path story in [Twine](https://twinery.org) with your own pictures.",
    ],
    related: ["make-games/make-a-game-without-coding", "design/make-a-birthday-invitation", "make-games/make-a-trivia-game"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-minecraft-datapack",
    niche: "make-games",
    searchPhrases: [
      "how to make a minecraft datapack",
      "minecraft datapack maker",
      "minecraft datapack maker ai",
      "minecraft crafting datapack maker",
      "how to make a datapack minecraft java",
    ],
    title: "How to make a Minecraft datapack by describing it",
    description:
      "Make a Minecraft datapack with new recipes, loot or rules. Describe it to Stella (stella.sh) and it makes the datapack and adds it to your world.",
    h1: "How to make a Minecraft datapack",
    short: "Make a Minecraft datapack",
    lede: "New recipes, loot and rules for your world, no mods needed.",
    answer:
      "Tell Stella (stella.sh) what should change in your world, like new crafting recipes or better loot. It makes the Minecraft datapack for the version you play and drops it into your world's folder.",
    gets: [
      "Your own crafting recipes and loot",
      "New rules, like keeping items on death",
      "Custom advancements and challenges",
      "Works for friends without any mods",
    ],
    prompt:
      "Make a datapack for my world Island Life where you can craft saddles and name tags, and zombies sometimes drop emeralds.",
    demo: {
      ack: "Nice. Making your Island Life datapack.",
      task: "Making your Minecraft datapack",
      rows: ["Checking which version Island Life uses", "Adding saddle and name tag recipes", "Giving zombies a chance to drop emeralds"],
      reply:
        "Your datapack is in **Island Life**'s datapacks folder. Load the world and it's on. Saddles use leather and iron, name tags use paper and string, and roughly one zombie in ten drops an emerald.",
      files: ["island-life-tweaks.zip"],
    },
    faq: [
      ["Does it work on a server?", "Yes. Datapacks go in the server's world folder and everyone gets the changes without installing anything."],
      ["Which Minecraft does it work on?", "Java Edition. Bedrock uses add-ons instead, which Stella can make too."],
    ],
    byHand: [
      "Make a folder with a pack.mcmeta and a data folder inside your world's datapacks folder.",
      "Add recipes or loot as files there; [Misode](https://misode.github.io) has generators for each kind.",
      "Run `/reload` in game to load it.",
    ],
    related: ["game-mods/install-minecraft-datapacks", "game-mods/make-a-minecraft-mod", "make-games/make-a-game-without-coding"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-fortnite-map",
    niche: "make-games",
    searchPhrases: [
      "how to make a fortnite map",
      "how to make a fortnite map with ai",
      "how to make a fortnite map on pc",
      "how to make a fortnite map in unreal engine",
      "how to make a fortnite map and publish it",
    ],
    title: "How to make a Fortnite map with AI in UEFN",
    description:
      "Make your own Fortnite map from an idea. Stella (stella.sh) builds it in UEFN on your PC, places the devices and writes the game rules in Verse.",
    h1: "How to make a Fortnite map with AI",
    short: "Make a Fortnite map",
    lede: "Your Fortnite island idea, built in the editor for you.",
    answer:
      "Open UEFN, Epic's free Fortnite editor for PC, and describe your map. Stella (stella.sh) links up with the editor's own AI helper, places the devices and writes the rules in Verse so you can test it with friends.",
    gets: [
      "Maps for box fights, deathruns or tycoons",
      "Rounds, scores, spawns and item drops set up",
      "Rules written in Verse for you",
    ],
    prompt:
      "Make a Fortnite box fight map for 4 players, two teams, five rounds, and everyone gets a pump and an AR each round.",
    demo: {
      ack: "Let's go. Building your box fight in UEFN.",
      task: "Building your Fortnite box fight map",
      rows: ["Linking up with UEFN", "Placing the two team boxes and spawns", "Setting five rounds and item drops", "Writing the round score in Verse"],
      reply:
        "Your box fight is built in the open project. Two teams of two spawn in facing boxes, each round gives a pump and an AR, and first to three rounds wins. Click **Launch Session** to try it in Fortnite.",
    },
    faq: [
      ["Can I make a Fortnite map on PS5 or Xbox?", "Consoles have Fortnite Creative, which is building by hand. UEFN, the version Stella builds in, needs a Windows PC."],
      ["How do I publish my Fortnite map?", "Send it from Epic's Creator Portal under your account. Stella writes the description and tags, then Epic reviews it."],
    ],
    byHand: [
      "Install UEFN from the [Epic Games Launcher](https://store.epicgames.com) and start from an island template.",
      "Place devices from the Content Browser and set their options in Details.",
    ],
    related: ["make-games/make-a-roblox-game", "video/make-gaming-montage", "make-games/make-a-game-without-coding"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-an-rpg-with-rpg-maker",
    niche: "make-games",
    searchPhrases: [
      "how to make a rpg game",
      "rpg maker mz tutorial",
      "how to make a simple rpg game",
      "rpg maker mz tutorial for beginners",
    ],
    title: "How to make an RPG game in RPG Maker MZ, from your idea",
    description:
      "Make your own RPG with heroes, quests and battles. Stella (stella.sh) fills in your RPG Maker MZ project: story, maps, characters, enemies and items.",
    h1: "How to make an RPG game in RPG Maker",
    short: "Make an RPG in RPG Maker",
    lede: "Heroes, a quest and battles, from the story you have in mind.",
    answer:
      "Tell Stella (stella.sh) your world, heroes and quest. It fills in your RPG Maker MZ project with towns, dialogue, enemies, skills, items and a boss, so you open RPG Maker and press Playtest.",
    gets: [
      "Heroes with their own skills and growth",
      "Towns, a dungeon and people to talk to",
      "Enemies, loot and a final boss",
    ],
    prompt:
      "In my RPG Maker MZ project, make a short RPG where a baker and a knight chase a dragon that stole the town's ovens.",
    demo: {
      ack: "Ha, a dragon who stole ovens. Writing your quest now.",
      task: "Making your RPG Maker quest",
      rows: ["Making the baker and the knight", "Building the town, forest and cave", "Adding enemies, loot and the dragon", "Writing what everyone says"],
      reply:
        "Your quest is in the project. Talk to the mayor to start, clear the forest, and fight the dragon in the cave. The baker heals with bread, the knight guards. Press **Playtest** in RPG Maker.",
    },
    faq: [
      ["Do I need to buy RPG Maker?", "RPG Maker MZ is sold on Steam and has a free trial. For a free route, Stella can build the RPG in Godot instead."],
      ["Can I keep editing in RPG Maker myself?", "Yes. Everything Stella adds is normal RPG Maker content you can open and change."],
    ],
    byHand: [
      "Create a project in RPG Maker MZ and draw maps with the tile palette.",
      "Add heroes, enemies and items in the Database, and story in events.",
      "Use Deployment in the File menu to make a game others can play.",
    ],
    related: ["make-games/make-a-visual-novel-with-renpy", "make-games/make-a-2d-platformer-game", "make-games/make-a-game-without-coding"],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-trivia-game",
    niche: "make-games",
    searchPhrases: [
      "make your own trivia game",
      "make a trivia game",
      "pub quiz maker",
      "make a quiz game",
      "create your own trivia game for teams",
    ],
    title: "Make your own trivia game for a party or pub quiz",
    description:
      "Make your own trivia game on any topic, with rounds, a timer and team scores on the TV. Stella (stella.sh) writes the questions and builds the game.",
    h1: "Make your own trivia game",
    short: "Make a trivia game",
    lede: "Your topic, your rounds, scores on the big screen.",
    answer:
      "Name the topic, the crowd and how many rounds. Stella (stella.sh) writes the questions and builds a trivia game for your TV with a timer, picture rounds, answer reveals and team scores.",
    gets: [
      "Questions on any topic, or about the guest of honour",
      "Picture and music rounds from your files",
      "Timer, reveals and a team scoreboard",
      "A printable answer sheet for the host",
    ],
    prompt:
      "Make a trivia game for my mum's 60th: four rounds about the 80s, her life, family photos and songs, for three teams.",
    demo: {
      ack: "What a party. Writing her trivia game now.",
      task: "Making your 60th birthday trivia",
      rows: ["Writing 80s and family questions", "Making a photo round from your pictures", "Building the timer and team scores"],
      reply:
        "**Mum's 60th Quiz** opens full screen in your browser; plug the laptop into the TV. Press space to reveal each answer and click a team to add a point. Host answers are in the PDF.",
      files: ["Mums 60th Quiz/index.html", "Host answers.pdf"],
    },
    faq: [
      ["Can teams answer on their phones?", "Yes. Stella can add phone answering so players join from the TV's code, like a party game."],
      ["Can I change questions after?", "Yes. Say which ones, or hand Stella a list, and the game updates."],
    ],
    byHand: [
      "Write questions in a slide deck with one answer slide after each.",
      "Or use a quiz site like [Kahoot](https://kahoot.com) or [Quizizz](https://quizizz.com) and type them in.",
    ],
    related: ["make-games/make-a-jackbox-style-party-game", "make-games/make-a-video-game-as-a-gift", "study/make-a-crossword-puzzle"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-jackbox-style-party-game",
    niche: "make-games",
    searchPhrases: [
      "how to make a jackbox style game",
      "make a jackbox game",
      "jackbox style games free",
      "party games to play on phone and tv",
      "games to play on your phone at a party",
    ],
    title: "How to make a Jackbox style party game for phones and TV",
    description:
      "Make your own Jackbox style party game: the TV shows the game, friends join on their phones. Stella (stella.sh) builds it and runs it from your computer.",
    h1: "How to make a Jackbox style party game",
    short: "Make a Jackbox style game",
    lede: "Everyone plays from their phone. The TV runs the show.",
    answer:
      "Describe the party game you want. Stella (stella.sh) builds it and runs it from your computer: the TV shows a code, everyone on your Wi-Fi joins from their phone browser, and nobody installs an app.",
    gets: [
      "Friends join by scanning a code on the TV",
      "Prompts, drawing, voting or bluffing rounds",
      "No app downloads for anyone",
    ],
    prompt:
      "Make a party game for 8 friends where everyone answers a silly prompt on their phone, then we vote for the funniest answer.",
    demo: {
      ack: "Sounds like chaos. Building your party game now.",
      task: "Building your phone party game",
      rows: ["Making the TV screen and join code", "Making the phone answer and vote screens", "Writing 60 silly prompts", "Starting it on your computer"],
      reply:
        "**Funniest Answer** is running. Open the game screen on the TV and friends scan the code on your Wi-Fi. Each round shows a prompt, then answers to vote on, and the best answer gets the points.",
      files: ["Funniest Answer/start game"],
    },
    faq: [
      ["Can friends play from another house?", "Yes, if you ask Stella to put the game online under a free account you sign in to. Then anyone joins from a link."],
      ["Can I add my own prompts?", "Yes. Give Stella a list or ask for prompts about your group, and they're in the next game."],
    ],
    byHand: [
      "Phone party games need a small server that phones and the TV page connect to.",
      "Tools like [Node.js](https://nodejs.org) with Socket.IO, or Godot with its network features, can build one.",
    ],
    related: ["make-games/make-a-trivia-game", "make-games/make-a-game-without-coding", "make-games/make-a-video-game-as-a-gift"],
    lastChecked: "2026-11-24",
  }),
];
