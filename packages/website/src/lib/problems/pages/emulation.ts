import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const EMULATION_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "set-up-switch-emulator-on-pc",
    niche: "emulation",
    searchPhrases: [
      "how to set up switch emulator on pc",
      "eden emulator setup pc",
      "switch emulator pc",
      "how to emulate switch games on pc",
      "eden emulator setup guide",
    ],
    title: "How to set up a Switch emulator on PC (Eden)",
    description:
      "Set up a Switch emulator on your PC with Eden: keys, firmware, games folder and controller. Ask Stella (stella.sh) and it does the whole setup for you.",
    h1: "Set up a Switch emulator on your PC",
    short: "Switch emulator on PC",
    lede: "Switch games on your PC, ready to play with your controller.",
    answer:
      "A Switch emulator such as Eden needs keys and firmware from a Switch, a games folder and a controller. Stella (stella.sh) installs Eden, puts each piece where it belongs and gets your first game running.",
    gets: [
      "Eden installed and up to date",
      "Keys, firmware and games folder in place",
      "Your controller working as a Switch Pro Controller",
    ],
    prompt:
      "Set up a Switch emulator on my PC so I can play Tears of the Kingdom. The keys and firmware from my Switch are in Downloads.",
    demo: {
      ack: "On it. Setting up Eden for you.",
      task: "Setting up a Switch emulator",
      rows: ["Installing Eden", "Adding your keys and firmware", "Pointing it at your games folder", "Setting up your Xbox controller"],
      reply:
        "Ready. Eden is in your Start menu and Tears of the Kingdom shows in its list. Your Xbox controller works as a Pro Controller. Double-click the game to play.",
    },
    faq: [
      ["Which Switch emulator is best right now?", "Eden is the most active on PC. Ryubing, which carries on Ryujinx, is steady on a Mac."],
      ["Does Yuzu still work?", "Yuzu shut down in 2024 and gets no fixes. Eden grew out of it and reads the same games, keys and saves."],
    ],
    byHand: [
      "Download Eden from [eden-emu.dev](https://eden-emu.dev) and unzip it somewhere you'll keep it.",
      "Install prod.keys and the firmware taken from your own Switch from Eden's menus.",
      "In Eden's Controls settings, pick your controller as a Pro Controller for player 1.",
    ],
    related: [
      "emulation/switch-emulator-firmware-and-keys",
      "emulation/switch-emulator-stuttering",
      "emulation/emulator-controller-not-working",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "switch-emulator-firmware-and-keys",
    niche: "emulation",
    searchPhrases: [
      "switch emulator firmware",
      "eden keys failed to initialize",
      "ryujinx keys not found",
      "ryujinx keys folder",
      "how to install firmware in eden emulator",
    ],
    title: "Switch emulator missing firmware or keys? Get it ready",
    description:
      "Eden or Ryujinx says keys not found or firmware missing? Stella (stella.sh) puts your Switch's keys and firmware where the emulator reads them, then opens a game.",
    h1: "Switch emulator asking for firmware and keys",
    short: "Switch firmware and keys",
    lede: "An emulator that opens your games instead of asking for keys.",
    answer:
      "A Switch emulator opens games only once it has prod.keys and firmware from a Switch, in its own folder, at versions that match. Stella (stella.sh) puts both in place and opens a game to show it's ready.",
    gets: [
      "Keys and firmware in the folder your emulator reads",
      "Keys and firmware versions that go together",
      "A game opening to show it's ready",
    ],
    prompt:
      "Eden says keys failed to initialize. The prod.keys and firmware from my Switch are on my desktop, sort it out.",
    demo: {
      ack: "Let me see what Eden is missing.",
      task: "Getting Eden ready",
      rows: ["Finding Eden's keys folder", "Replacing an old prod.keys file", "Installing the firmware from your desktop", "Opening a game"],
      reply:
        "Fixed. Eden still had an old keys file that didn't match your newer firmware. Both now come from your Switch, and Mario Kart 8 Deluxe opens to the title screen.",
    },
    faq: [
      ["Where does Ryujinx keep its keys?", "In the system folder inside its data folder, which File, Open Ryujinx Folder opens. Eden keeps them in a folder named keys."],
      ["Why did my keys stop working after a firmware update?", "Newer firmware needs keys taken from a Switch on that version or later. Fresh keys from the updated console fix it."],
    ],
    byHand: [
      "Take prod.keys and the firmware from your own Switch with Lockpick_RCM and TegraExplorer.",
      "In Eden or Ryubing, use the menu items to install keys and install firmware, or copy prod.keys into the keys folder by hand.",
    ],
    related: [
      "emulation/set-up-switch-emulator-on-pc",
      "emulation/switch-emulator-stuttering",
      "emulation/transfer-saves-between-emulators",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "switch-emulator-stuttering",
    niche: "emulation",
    searchPhrases: [
      "switch emulator stuttering",
      "eden stuttering fix",
      "ryujinx stuttering fix",
      "shader cache stutter switch emulator",
      "eden emulator stuttering pc",
    ],
    title: "Switch emulator stuttering? Fix Eden and Ryujinx stutter",
    description:
      "Eden or Ryujinx hitching every time something new appears? Stella (stella.sh) fixes the shader cache stutter, updates your driver and tunes the game.",
    h1: "Switch emulator stuttering in every new area",
    short: "Switch emulator stuttering",
    lede: "Smooth play in Eden or Ryujinx, without a hitch at every new effect.",
    answer:
      "Most Switch emulator stutter is shader cache stutter: the emulator builds each graphics effect the first time it appears. Stella (stella.sh) turns on the settings that hide it, updates your graphics driver and tunes the game.",
    gets: [
      "Background shader building switched on",
      "A current graphics driver",
      "Settings tuned for that one game",
    ],
    prompt:
      "Zelda Tears of the Kingdom stutters in Eden every time something new shows up on screen. Make it smooth.",
    demo: {
      ack: "Looking at Eden's settings and your graphics card.",
      task: "Smoothing out Tears of the Kingdom",
      rows: ["Switching Eden to Vulkan", "Building shaders in the background", "Updating your Nvidia driver", "Keeping the shader cache"],
      reply:
        "Done. Eden now runs on Vulkan and builds new graphics in the background, with the latest Nvidia driver. A brand new area can still hitch once, then it plays smoothly every visit after.",
    },
    faq: [
      ["Should I delete the shader cache?", "Usually no. A full shader cache is what keeps later play smooth. Clear it only when a driver update leaves games glitching."],
      ["Is it my PC or the emulator?", "Short hitches at new effects come from shader building. A steady low frame rate means the computer is short of power, and lighter settings help."],
    ],
    byHand: [
      "In the emulator's Graphics settings, pick Vulkan.",
      "In Eden, turn on asynchronous shader building and the disk shader cache under Graphics, Advanced.",
      "Update your graphics driver from Nvidia, AMD or Intel.",
      "Play on: each area hitches the first time, then stays smooth.",
    ],
    related: [
      "emulation/set-up-switch-emulator-on-pc",
      "emulation/pcsx2-stuttering-fix",
      "emulation/set-up-dolphin-emulator",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-pcsx2",
    niche: "emulation",
    searchPhrases: [
      "how to set up pcsx2 on pc",
      "pcsx2 setup guide",
      "pcsx2 bios not showing up",
      "how to emulate ps2 games on pc",
      "pcsx2 setup bios",
    ],
    title: "How to set up PCSX2 on PC: BIOS, games and controller",
    description:
      "Set up PCSX2 to play PS2 games on your PC: BIOS, game list, controller and sharper graphics. Ask Stella (stella.sh) and it does every step for you.",
    h1: "Set up PCSX2 on your PC",
    short: "PCSX2 setup",
    lede: "PS2 games on your PC, sharper than the original and ready to play.",
    answer:
      "PCSX2 needs a BIOS from a PS2, a folder of games and a controller. Stella (stella.sh) installs it, points it at your BIOS and games, sets up your controller and raises the picture quality to suit your graphics card.",
    gets: [
      "PCSX2 installed and your BIOS found",
      "Your games listed with cover art",
      "Sharper graphics that suit your computer",
    ],
    prompt:
      "Set up PCSX2 so I can play my Kingdom Hearts 2 disc image. The BIOS from my PS2 is in my Documents folder.",
    demo: {
      ack: "On it. Starting with PCSX2 and your BIOS.",
      task: "Setting up PCSX2",
      rows: ["Installing PCSX2", "Finding your BIOS in Documents", "Adding your games folder", "Raising resolution to 3x"],
      reply:
        "Ready. PCSX2 found your BIOS and lists Kingdom Hearts II with its cover. Your controller is set up, and games run at three times the PS2's resolution. Double-click to play.",
    },
    faq: [
      ["Why is my BIOS not showing up in PCSX2?", "It's usually in a different folder from the one PCSX2 checks, still zipped, or an incomplete copy. Stella moves it into place and refreshes the list."],
      ["Can PCSX2 play PS1 games?", "Not well. DuckStation is the one to use for PS1 games."],
    ],
    byHand: [
      "Download PCSX2 from [pcsx2.net](https://pcsx2.net).",
      "Dump the BIOS from your PS2 with the BIOS dumper listed on pcsx2.net.",
      "The first-run setup asks for the BIOS folder, then your games folder.",
      "Map your pad under Settings, Controllers, and raise Internal Resolution under Graphics.",
    ],
    related: [
      "emulation/pcsx2-stuttering-fix",
      "emulation/emulator-controller-not-working",
      "emulation/ps1-emulator-for-pc",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "pcsx2-stuttering-fix",
    niche: "emulation",
    searchPhrases: [
      "pcsx2 stuttering fix",
      "pcsx2 slow motion fix",
      "pcsx2 stuck at 50 speed",
      "pcsx2 stuttering cutscenes",
      "pcsx2 audio stuttering",
    ],
    title: "PCSX2 stuttering or slow motion? Fix it",
    description:
      "PCSX2 stuttering, crackling or stuck in slow motion? Stella (stella.sh) finds the setting at fault and gets your PS2 game running at full speed again.",
    h1: "PCSX2 stuttering or running in slow motion",
    short: "PCSX2 stuttering",
    lede: "Your PS2 game back at full speed, with clean sound.",
    answer:
      "PCSX2 stutter usually comes from a setting too heavy for the computer, a renderer that doesn't suit the graphics card, or an old tweak left switched on. Stella (stella.sh) reads your settings, finds the culprit and brings the game back to full speed.",
    gets: [
      "The cause, in one line",
      "Speed back at 100%",
      "Changes saved for that game only",
    ],
    prompt:
      "God of War 2 runs in slow motion in PCSX2, around 50% speed, and the sound crackles. Fix it.",
    demo: {
      ack: "Checking PCSX2's settings and your computer.",
      task: "Fixing slow motion in PCSX2",
      rows: ["Reading this game's own settings", "Checking speed tweaks and renderer", "Lowering resolution from 8x to 4x"],
      reply:
        "Fixed. God of War II was set to eight times resolution on a laptop graphics chip, and a speed tweak from an old guide was still on. Both are changed for that game only, and it holds full speed.",
    },
    faq: [
      ["Why is PCSX2 stuck at 50% speed?", "The computer can't keep up with the settings, most often the resolution or the renderer. Lowering them for that game brings it back to 100%."],
      ["Why does the sound crackle?", "Sound crackles when the game drops below full speed. Once the speed holds at 100%, the sound clears up too."],
    ],
    byHand: [
      "Turn on the on-screen speed and frame rate display in PCSX2's settings.",
      "Lower Internal Resolution under Graphics, and try Vulkan, then Direct3D 12, as the renderer.",
      "Right-click the game, open Properties and set any speed tweaks back to default.",
    ],
    related: [
      "emulation/set-up-pcsx2",
      "emulation/switch-emulator-stuttering",
      "emulation/set-up-emudeck-steam-deck",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-rpcs3",
    niche: "emulation",
    searchPhrases: [
      "how to set up rpcs3 on pc",
      "rpcs3 firmware is missing",
      "how to install firmware on rpcs3",
      "how to emulate ps3 games on pc",
      "rpcs3 setup guide",
    ],
    title: "How to set up RPCS3 on PC: firmware, games and controller",
    description:
      "Set up RPCS3 to play PS3 games: firmware, game installs, controller and settings for each game. Ask Stella (stella.sh) and it sets it all up on your PC.",
    h1: "Set up RPCS3 to play PS3 games on your PC",
    short: "RPCS3 setup",
    lede: "PS3 games on your PC, with the system software in and your pad working.",
    answer:
      "RPCS3 needs the PS3 system software from PlayStation's website, then your games and a controller. Stella (stella.sh) installs RPCS3 and the firmware, adds your games, maps your pad and applies the recommended settings for each game.",
    gets: [
      "RPCS3 with the PS3 firmware installed",
      "Disc and downloaded games in one list",
      "Recommended settings for each game",
    ],
    prompt:
      "Set up RPCS3 so I can play Demon's Souls and Persona 5 from my PS3 games folder on drive D, with my DualShock 4.",
    demo: {
      ack: "On it. Starting with the PS3 firmware.",
      task: "Setting up RPCS3",
      rows: ["Installing RPCS3", "Installing firmware from playstation.com", "Adding your games from drive D", "Mapping your DualShock 4"],
      reply:
        "Ready. RPCS3 has the PS3 firmware and lists Demon's Souls and Persona 5, each with the settings the RPCS3 wiki recommends. The first start of each game takes longer while it prepares.",
    },
    faq: [
      ["What does firmware is missing mean in RPCS3?", "RPCS3 needs the PS3 system update file, PS3UPDAT.PUP, from PlayStation's website, installed from File, Install Firmware. Stella does both."],
      ["Can my PC run RPCS3?", "It leans hardest on the processor. Recent six-core processors handle most popular games, and the compatibility list says how each game runs."],
    ],
    byHand: [
      "Download RPCS3 from [rpcs3.net](https://rpcs3.net).",
      "Get PS3UPDAT.PUP from [playstation.com](https://www.playstation.com/en-us/support/hardware/ps3/system-software/) and choose File, Install Firmware.",
      "Add disc games with File, Add Games; install downloaded ones with File, Install Packages.",
      "Map your pad under Pads, and check each game's page on the RPCS3 wiki.",
    ],
    related: [
      "emulation/set-up-pcsx2",
      "emulation/emulator-controller-not-working",
      "emulation/set-up-emudeck-steam-deck",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-azahar-3ds-emulator",
    niche: "emulation",
    searchPhrases: [
      "how to set up azahar emulator on pc",
      "3ds emulator pc",
      "azahar emulator pc setup",
      "how to emulate 3ds games on pc",
      "azahar vs citra",
    ],
    title: "How to set up Azahar, the 3DS emulator, on PC",
    description:
      "Play 3DS games on your PC with Azahar, the emulator that carries on from Citra. Stella (stella.sh) sets up your games, both screens and a controller.",
    h1: "Set up the Azahar emulator for 3DS games on PC",
    short: "Azahar 3DS emulator",
    lede: "3DS games on your PC, with both screens arranged the way you like.",
    answer:
      "Azahar is the 3DS emulator that carries on from Citra. Stella (stella.sh) installs it, adds your games, lays out the two screens and sets up a controller, with the touch screen on your mouse.",
    gets: [
      "Azahar installed with your games listed",
      "Both screens side by side or stacked",
      "A controller mapped, touch screen on the mouse",
    ],
    prompt:
      "Set up a 3DS emulator on my PC for Pokemon Ultra Moon, screens side by side, with my Xbox controller.",
    demo: {
      ack: "Setting up Azahar for you.",
      task: "Setting up a 3DS emulator",
      rows: ["Installing Azahar", "Adding your games folder", "Putting both screens side by side", "Mapping your Xbox controller"],
      reply:
        "Ready. Azahar lists Pokemon Ultra Moon. The screens sit side by side at double resolution, your Xbox controller is mapped, and you tap the bottom screen with the mouse.",
    },
    faq: [
      ["Is Citra still around?", "Citra stopped in 2024. Azahar brought together the projects that continued it, and it opens the same games and saves."],
      ["Why won't my 3DS game open in Azahar?", "Azahar opens decrypted dumps of cartridges and downloads. Stella checks each file and names any that need dumping again."],
    ],
    byHand: [
      "Download Azahar from [azahar-emu.org](https://azahar-emu.org).",
      "Double-click the empty game list to add your games folder.",
      "Choose a screen layout from View, Screen Layout.",
      "Map your controller under Emulation, Configure, Controls.",
    ],
    related: [
      "emulation/set-up-switch-emulator-on-pc",
      "emulation/emulator-controller-not-working",
      "emulation/transfer-saves-between-emulators",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-dolphin-emulator",
    niche: "emulation",
    searchPhrases: [
      "dolphin emulator setup",
      "dolphin emulator setup guide",
      "dolphin emulator stuttering fix",
      "dolphin emulator for pc",
      "dolphin emulator setup xbox controller",
    ],
    title: "Dolphin emulator setup: GameCube and Wii games on PC",
    description:
      "Set up Dolphin to play GameCube and Wii games on your PC: game list, HD graphics, controller and Wii Remote. Ask Stella (stella.sh) and it does it all.",
    h1: "Dolphin emulator setup for GameCube and Wii",
    short: "Dolphin setup",
    lede: "GameCube and Wii games on your PC in HD, smooth from the start.",
    answer:
      "Dolphin plays GameCube and Wii games with no BIOS to find. Stella (stella.sh) installs it, adds your games, sets up your controller or Wii Remote and turns on the settings that stop stutter.",
    gets: [
      "Dolphin installed, your games listed",
      "HD graphics that suit your computer",
      "A controller or Wii Remote that works",
    ],
    prompt:
      "Set up Dolphin for Melee and Mario Galaxy in HD. I have a PS5 controller and no Wii Remote.",
    demo: {
      ack: "On it. Setting up Dolphin.",
      task: "Setting up Dolphin",
      rows: ["Installing Dolphin", "Adding your GameCube and Wii games", "Mapping the PS5 pad as a GameCube pad", "Putting Galaxy's pointer on the right stick"],
      reply:
        "Ready. Both games run at 1080p with the anti-stutter setting on. Melee uses your PS5 controller as a GameCube pad. In Galaxy, the right stick moves the pointer and a shoulder button shakes.",
    },
    faq: [
      ["How do I fix Dolphin emulator stuttering?", "Under Graphics, set the shader option to Hybrid Ubershaders, or have Dolphin prepare effects before the game starts. That stops the hitch when new effects appear."],
      ["Can I use a real Wii Remote?", "Yes, over Bluetooth. Stella pairs it and switches that player to Real Wii Remote."],
    ],
    byHand: [
      "Download Dolphin from [dolphin-emu.org](https://dolphin-emu.org).",
      "Double-click the empty list and choose your games folder.",
      "Under Controllers, pick Standard Controller or Emulated Wii Remote, then Configure.",
      "Under Graphics, Enhancements, set Internal Resolution to 3x for 1080p.",
    ],
    related: [
      "emulation/emulator-controller-not-working",
      "emulation/switch-emulator-stuttering",
      "emulation/set-up-retroarch",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "ps1-emulator-for-pc",
    niche: "emulation",
    searchPhrases: [
      "ps1 emulator for pc",
      "duckstation setup",
      "no bios image found duckstation",
      "duckstation bios image",
      "how to play ps1 games on pc",
    ],
    title: "PS1 emulator for PC: set up DuckStation",
    description:
      "Play PS1 games on your PC with DuckStation: BIOS, game list, memory cards and controller. Ask Stella (stella.sh) and it sets everything up for you.",
    h1: "Set up a PS1 emulator on your PC",
    short: "PS1 emulator (DuckStation)",
    lede: "PS1 games on your PC, crisp and steady, ready with your controller.",
    answer:
      "DuckStation is the PS1 emulator most people use on PC, and it needs a BIOS from a PlayStation. Stella (stella.sh) installs it, adds your BIOS and games, sets up a controller and steadies the wobbly 3D.",
    gets: [
      "DuckStation installed with your BIOS found",
      "Your games listed with covers",
      "A memory card for each game",
      "Sharper, steadier 3D graphics",
    ],
    prompt:
      "Set up a PS1 emulator for Final Fantasy VII and Crash Bandicoot on my laptop. The BIOS is in Downloads.",
    demo: {
      ack: "Setting up DuckStation now.",
      task: "Setting up a PS1 emulator",
      rows: ["Installing DuckStation", "Moving your BIOS into its folder", "Adding your games", "Turning on the wobble fix"],
      reply:
        "Ready. DuckStation found your BIOS and lists Final Fantasy VII and Crash Bandicoot. Each game gets its own memory card, and 3D models no longer wobble. Plug in your controller and play.",
    },
    faq: [
      ["Why does DuckStation say no BIOS image found?", "The BIOS file isn't in the folder DuckStation looks in, or it's for another region. Stella moves it there and picks the right one for your games."],
      ["How do multi-disc games work?", "Stella makes one list file per game that holds every disc, so DuckStation swaps discs when the game asks."],
    ],
    byHand: [
      "Download DuckStation from [duckstation.org](https://www.duckstation.org).",
      "Put the BIOS from your PS1 in DuckStation's bios folder; Settings, BIOS shows what it found.",
      "Add your games folder under Settings, Game List.",
      "Turn on PGXP under Settings, Enhancements to stop wobbly 3D.",
    ],
    related: [
      "emulation/psp-emulator-for-pc",
      "emulation/set-up-pcsx2",
      "emulation/retroarch-missing-bios",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "psp-emulator-for-pc",
    niche: "emulation",
    searchPhrases: [
      "psp emulator pc",
      "ppsspp pc setup",
      "ppsspp pc controls",
      "how to play psp games on pc",
      "ppsspp save data location",
    ],
    title: "PSP emulator on PC: set up PPSSPP with a controller",
    description:
      "Play PSP games on your PC in HD with PPSSPP: game folder, controller, sharper graphics and your old saves. Ask Stella (stella.sh) and it sets it up.",
    h1: "Set up a PSP emulator on your PC",
    short: "PSP emulator (PPSSPP)",
    lede: "PSP games on a big screen, sharp, with a proper controller.",
    answer:
      "PPSSPP plays PSP games on a PC with no BIOS needed. Stella (stella.sh) installs it, points it at your games, maps your controller and brings over saves from an old PSP or phone.",
    gets: [
      "PPSSPP installed, your games on its home screen",
      "Graphics raised for a big screen",
      "Saves from your PSP or phone carried over",
    ],
    prompt:
      "Set up a PSP emulator for Monster Hunter Freedom Unite. I copied the PSP folder from my phone into Downloads, keep my save.",
    demo: {
      ack: "Setting up PPSSPP for you.",
      task: "Setting up a PSP emulator",
      rows: ["Installing PPSSPP", "Adding your games folder", "Copying your save from Downloads", "Mapping your controller"],
      reply:
        "Ready. Monster Hunter Freedom Unite is on PPSSPP's home screen with your save from the phone. It runs at four times the PSP's resolution, and your controller is mapped. Press Start to play.",
    },
    faq: [
      ["Where does PPSSPP keep save data?", "In the PSP, SAVEDATA folder inside PPSSPP's memory stick folder. Copying that folder moves saves between computers and phones."],
      ["Do I need a BIOS for PSP games?", "No. PPSSPP needs only your games, as ISO or CSO files."],
    ],
    byHand: [
      "Download PPSSPP from [ppsspp.org](https://www.ppsspp.org).",
      "On the Games tab, browse to your games folder and set it as home.",
      "Under Settings, Graphics, raise Rendering Resolution.",
      "Under Settings, Controls, Control Mapping, set each button.",
    ],
    related: [
      "emulation/ps1-emulator-for-pc",
      "emulation/transfer-saves-between-emulators",
      "emulation/emulator-controller-not-working",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-retroarch",
    niche: "emulation",
    searchPhrases: [
      "how to set up retroarch on pc",
      "retroarch setup guide",
      "retroarch missing cores",
      "retroarch cores",
      "how to set up retroarch on steam",
    ],
    title: "How to set up RetroArch on PC: cores, games, controller",
    description:
      "RetroArch confusing? Stella (stella.sh) sets it up on your PC: the right cores, your games in playlists, controller, an old TV look and saves in one place.",
    h1: "Set up RetroArch on your PC",
    short: "RetroArch setup",
    lede: "Every retro console in one app, without the confusing menus.",
    answer:
      "RetroArch runs many consoles through add-ons called cores, and its menus lose most people. Stella (stella.sh) installs it, downloads the right core for each console, scans your games into playlists and sets up your controller.",
    gets: [
      "The best core for each of your consoles",
      "Your games sorted into playlists with box art",
      "Controller and a menu shortcut set",
      "An old TV look, if you want one",
    ],
    prompt:
      "Set up RetroArch for my SNES, Game Boy Advance and Mega Drive games and make them look like an old CRT TV.",
    demo: {
      ack: "On it. Picking a core for each console.",
      task: "Setting up RetroArch",
      rows: ["Getting Snes9x, mGBA and Genesis Plus GX", "Scanning your games into playlists", "Adding a CRT shader", "Setting Select+Start to open the menu"],
      reply:
        "Ready. RetroArch has playlists for SNES, Game Boy Advance and Mega Drive with box art. Each console uses its best core, games look like an old TV, and Select plus Start opens the menu.",
    },
    faq: [
      ["Why does RetroArch say no cores?", "Some store and Linux versions hide the core downloader or ship without cores. Stella gets the cores your consoles need from the right place."],
      ["Which core should I use?", "The most accurate one your computer runs smoothly, such as mGBA for Game Boy Advance. Stella picks one per console."],
    ],
    byHand: [
      "Download RetroArch from [retroarch.com](https://www.retroarch.com).",
      "In Main Menu, Online Updater, Core Downloader, get one core per console.",
      "Use Import Content, Scan Directory, and pick your games folder.",
      "Settings, Input sets your controller and the menu shortcut.",
    ],
    related: [
      "emulation/retroarch-missing-bios",
      "emulation/emulator-controller-not-working",
      "emulation/patch-rom-hacks-and-fan-translations",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "retroarch-missing-bios",
    niche: "emulation",
    searchPhrases: [
      "retroarch missing bios",
      "no bios found retroarch",
      "retroarch bios location",
      "retroarch bios files",
      "retroarch missing firmware",
    ],
    title: "RetroArch missing BIOS? Get each core ready to play",
    description:
      "RetroArch says BIOS or firmware missing? Stella (stella.sh) puts your BIOS files in the system folder with the exact names each core looks for.",
    h1: "RetroArch says BIOS missing",
    short: "RetroArch missing BIOS",
    lede: "Cores that start your games instead of complaining about BIOS files.",
    answer:
      "Some RetroArch cores, such as PlayStation and Sega CD, need BIOS files from the console, named exactly as the core expects and kept in the system folder. Stella (stella.sh) renames yours, puts them there and confirms each core sees them.",
    gets: [
      "Each BIOS in the folder RetroArch reads",
      "Files renamed to what each core expects",
      "A list of which consoles are ready",
    ],
    prompt:
      "RetroArch keeps saying no BIOS found for PlayStation and Sega CD. My BIOS files are in a folder on my desktop.",
    demo: {
      ack: "Let me see what each core wants.",
      task: "Getting RetroArch's cores ready",
      rows: ["Finding RetroArch's system folder", "Matching your files to each core", "Renaming two files to the expected names", "Reading Core Information for each"],
      reply:
        "Ready. Your BIOS files sat in RetroArch's main folder instead of the system folder, and two had the wrong names. PlayStation and Sega CD games now start, and Core Information lists every file as present.",
    },
    faq: [
      ["Where is the RetroArch BIOS folder?", "The system folder inside RetroArch's own folder, unless Settings, Directory points somewhere else. Stella reads that setting first."],
      ["Which consoles need a BIOS in RetroArch?", "PlayStation, Sega CD, Saturn, PC Engine CD and Neo Geo. Most cartridge consoles need none."],
    ],
    byHand: [
      "In RetroArch, Settings, Directory, System/BIOS shows the folder it reads.",
      "Information, Core Information lists the file names your core wants and which are missing.",
      "Copy the BIOS from your console in with exactly those names, capitals included.",
    ],
    related: [
      "emulation/set-up-retroarch",
      "emulation/ps1-emulator-for-pc",
      "emulation/set-up-emudeck-steam-deck",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "emulator-controller-not-working",
    niche: "emulation",
    searchPhrases: [
      "emulator controller not working",
      "controller not working in dolphin emulator",
      "pcsx2 controller not working",
      "retroarch controller not working",
      "eden emulator controller not working",
    ],
    title: "Emulator controller not working? Fix it in any emulator",
    description:
      "Controller not working in Dolphin, PCSX2, RetroArch or Eden? Stella (stella.sh) finds why, maps every button and saves it so it works next time too.",
    h1: "Controller not working in your emulator",
    short: "Controller not working",
    lede: "Your controller working in every emulator, each button where you expect it.",
    answer:
      "An emulator usually ignores a controller because Steam is taking it over, the wrong input type is picked, or nothing is mapped to player one. Stella (stella.sh) finds which, maps your pad and saves a profile.",
    gets: [
      "The reason it wasn't working",
      "Every button mapped in each emulator",
      "A saved profile that loads every time",
    ],
    prompt:
      "My PS5 controller works in Steam but does nothing in PCSX2 or Dolphin. Fix it so it works in both.",
    demo: {
      ack: "Checking how each emulator sees your controller.",
      task: "Fixing your controller",
      rows: ["Checking Steam's controller settings", "Switching PCSX2 to the right input type", "Mapping your pad as player one in Dolphin", "Saving a profile in both"],
      reply:
        "Fixed. Steam was turning your PS5 controller into an Xbox pad that PCSX2 ignored, and Dolphin had nothing set for player one. Both now map every button, saved as profiles that load each time.",
    },
    faq: [
      ["Why does my controller press buttons twice?", "Steam and the emulator are both reading it. Stella turns one of them off for that emulator, so each press counts once."],
      ["Why is my controller moving on its own in PCSX2?", "A stick is too sensitive, or two pads share one mapping. A bigger dead zone or clearing the second mapping stops it."],
    ],
    byHand: [
      "Close Steam, or turn off Steam Input for the emulator, and test again.",
      "In the emulator's controller settings, pick your pad for player one and press each button to map it.",
      "Save the mapping as a profile so it loads next time.",
    ],
    related: [
      "emulation/set-up-dolphin-emulator",
      "emulation/set-up-pcsx2",
      "emulation/set-up-retroarch",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "patch-rom-hacks-and-fan-translations",
    niche: "emulation",
    searchPhrases: [
      "how to patch roms on pc",
      "how to patch rom hacks",
      "apply bps patch to rom",
      "how to apply ips patch to rom",
      "how to play mother 3 english translation",
      "xdelta patcher",
    ],
    title: "How to patch ROMs on PC: rom hacks and fan translations",
    description:
      "Apply a rom hack or English fan translation patch (IPS, BPS or xdelta) to your game. Ask Stella (stella.sh) and it patches a copy, ready to play.",
    h1: "Patch ROMs on your PC for rom hacks and fan translations",
    short: "Patch rom hacks and translations",
    lede: "A rom hack or English fan translation, patched and ready to play.",
    answer:
      "A rom hack or fan translation comes as a patch file you apply to your own copy of the game, made for one exact version of it. Stella (stella.sh) checks the version, patches a copy and adds it to your emulator.",
    gets: [
      "Your game matched to the version the patch needs",
      "The patch applied to a copy, original kept",
      "The patched game in your emulator's list",
    ],
    prompt:
      "Patch my Mother 3 game with the English fan translation and add it to RetroArch. Both files are in Downloads.",
    demo: {
      ack: "On it. Checking your game matches the patch.",
      task: "Patching Mother 3 into English",
      rows: ["Checking the game's version", "Applying the English translation patch", "Adding Mother 3 (English) to RetroArch"],
      reply:
        "Done. Your copy matched the version the translation needs, so the patch went on first time. **Mother 3 (English)** is in RetroArch's Game Boy Advance list, and your original file is untouched.",
    },
    faq: [
      ["Why does my patched game show a white or black screen?", "The patch was made for a different version of the game. Stella finds the version it needs and says if yours differs."],
      ["What's the difference between IPS, BPS and xdelta?", "They're patch formats. BPS and xdelta check the game version first; IPS doesn't, so it can quietly patch the wrong one."],
    ],
    byHand: [
      "Read the patch's readme for the exact game version it needs.",
      "Open [Rom Patcher JS](https://www.marcrobledo.com/RomPatcher.js/), load your game and the patch, then apply.",
      "For .xdelta files, Delta Patcher or xdelta UI do the same.",
    ],
    related: [
      "emulation/set-up-retroarch",
      "emulation/transfer-saves-between-emulators",
      "reverse-engineering/edit-save-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-emudeck-steam-deck",
    niche: "emulation",
    searchPhrases: [
      "emudeck setup steam deck",
      "how to emulate on steam deck",
      "emudeck how to add games",
      "emudeck games not showing up in steam",
      "how to set up switch emulator on steam deck",
    ],
    title: "EmuDeck setup on Steam Deck: emulators, games and BIOS",
    description:
      "Set up EmuDeck on your Steam Deck: emulators, games, BIOS and every game in your Steam library. Ask Stella (stella.sh) and it does it in desktop mode.",
    h1: "EmuDeck setup on your Steam Deck",
    short: "EmuDeck on Steam Deck",
    lede: "Retro and console games in your Steam Deck library, ready in gaming mode.",
    answer:
      "EmuDeck installs emulators on a Steam Deck, but games, BIOS files and the Steam library step still trip people up. Stella (stella.sh) runs in desktop mode, sets it up, files your games and adds them to Steam with artwork.",
    gets: [
      "EmuDeck and the emulators you want",
      "Games and BIOS files in the right folders",
      "Every game in your Steam library with art",
    ],
    prompt:
      "Set up EmuDeck on my Steam Deck. My games and BIOS files are on the SD card in a folder called Retro.",
    demo: {
      ack: "On it. Working in desktop mode.",
      task: "Setting up EmuDeck",
      rows: ["Installing EmuDeck to the SD card", "Sorting games into each console's folder", "Putting BIOS files in place", "Adding games to Steam with artwork"],
      reply:
        "Ready. Your PS2, GameCube and SNES games are in your Steam library with artwork, one collection per console. Switch back to gaming mode and find them under Collections.",
    },
    faq: [
      ["Why are my EmuDeck games not showing up in Steam?", "Steam ROM Manager didn't find them, usually because they're in the wrong console folder or Steam was open while it saved. Stella files them and runs it again."],
    ],
    byHand: [
      "Hold the power button, choose Switch to Desktop, and get EmuDeck from [emudeck.com](https://www.emudeck.com).",
      "Pick Easy Mode and your SD card.",
      "Copy games into each console's folder under Emulation/roms, and BIOS files into Emulation/bios.",
      "Open Steam ROM Manager from EmuDeck, parse your games, then save to Steam.",
    ],
    related: [
      "game-mods/steam-deck-mods",
      "emulation/transfer-saves-between-emulators",
      "emulation/emulator-controller-not-working",
    ],
    platforms: ["linux", "windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "transfer-saves-between-emulators",
    niche: "emulation",
    searchPhrases: [
      "transfer save files from one emulator to another",
      "transfer save files from ryujinx to eden",
      "transfer emulator saves to steam deck",
      "transfer save states between emulators",
      "pcsx2 memory card location",
    ],
    title: "Transfer save files between emulators or to a Steam Deck",
    description:
      "Move your saves from Ryujinx to Eden, from PC to Steam Deck, or between any emulators. Stella (stella.sh) finds them, backs them up and copies them over.",
    h1: "Transfer save files from one emulator to another",
    short: "Move saves between emulators",
    lede: "Your progress, moved to a new emulator or device, with nothing lost.",
    answer:
      "Each emulator keeps saves in its own folder and its own layout. Stella (stella.sh) backs them up, finds where the new emulator or device expects them, converts where needed and makes sure the game sees your progress.",
    gets: [
      "A backup of every save before anything moves",
      "Saves placed in the new emulator's folders",
      "Your progress showing in the game",
    ],
    prompt:
      "I switched from Ryujinx to Eden. Move my Pokemon Scarlet and Zelda saves over so I don't lose my progress.",
    demo: {
      ack: "On it. Backing up your saves first.",
      task: "Moving your Switch saves",
      rows: ["Backing up your Ryujinx saves", "Matching each save to its game", "Copying them into your Eden profile"],
      reply:
        "Done. Pokemon Scarlet and Tears of the Kingdom open in Eden with your progress. A backup of every Ryujinx save is in Documents, in a folder called Emulator save backup.",
    },
    faq: [
      ["Do save states move between emulators?", "No. Save states work only in the emulator, and often the version, that made them. In-game saves move anywhere, so save in the game first."],
      ["Can I move saves to a Steam Deck?", "Yes. Stella copies them over your home network or a USB stick and puts them in EmuDeck's save folders."],
    ],
    byHand: [
      "Ryujinx: right-click the game, Open User Save Directory. Eden: right-click, Open Save Data Location.",
      "Copy the files inside, not the folder itself, into the matching folder in the new emulator.",
      "PCSX2 memory cards are .ps2 files in its memcards folder; Dolphin keeps GameCube saves in its GC folder.",
    ],
    related: [
      "emulation/set-up-switch-emulator-on-pc",
      "emulation/set-up-emudeck-steam-deck",
      "reverse-engineering/edit-save-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
