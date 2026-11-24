import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PC_GAMING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "update-graphics-drivers",
    niche: "pc-gaming",
    searchPhrases: [
      "how to update graphics drivers",
      "how to update graphics drivers windows 11",
      "how to update nvidia drivers",
      "how to update amd drivers",
      "update graphics card driver",
    ],
    title: "How to update graphics drivers on Windows (NVIDIA or AMD)",
    description:
      "Update your NVIDIA or AMD graphics driver without hunting for downloads. Ask Stella (stella.sh) and it installs the newest one for your exact card.",
    h1: "How to update graphics drivers on Windows",
    short: "Update graphics drivers",
    lede: "The newest driver for your exact graphics card, installed.",
    answer:
      "Find your graphics card's exact model, then install the newest driver from NVIDIA, AMD or Intel rather than the older one Windows Update offers. Stella (stella.sh) checks your card and installs the right driver.",
    gets: [
      "Your card's model and how old its driver is",
      "The latest driver straight from NVIDIA, AMD or Intel",
      "Your display and game settings left as they were",
    ],
    prompt:
      "Update my graphics card drivers to the newest version. New games keep warning me my driver is out of date.",
    demo: {
      ack: "Sure. Checking which graphics card you have.",
      task: "Updating your graphics driver",
      rows: ["Found an NVIDIA GeForce RTX 4070", "Installed driver is over a year old", "Installing the latest Game Ready driver"],
      reply:
        "Done. Your RTX 4070 is on the newest Game Ready driver, straight from NVIDIA. Your screen layout and colour settings stayed the same.",
    },
    faq: [
      ["Should I use the NVIDIA App or GeForce Experience?", "The NVIDIA App. It replaced GeForce Experience in 2024 and tells you when a new driver is out."],
      ["How do I update AMD drivers?", "Open AMD Software: Adrenalin Edition and install the update it offers on its home screen, or download it from amd.com/support."],
    ],
    byHand: [
      "NVIDIA: install the [NVIDIA App](https://www.nvidia.com/en-us/software/nvidia-app/) and click Download on its Drivers tab.",
      "AMD: get [AMD Software: Adrenalin Edition](https://www.amd.com/en/support/download/drivers.html) and update from its home screen.",
    ],
    related: [
      "pc-gaming/clean-install-graphics-drivers",
      "pc-gaming/fix-fps-drops-in-games",
      "pc-gaming/games-crashing-to-desktop",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "clean-install-graphics-drivers",
    niche: "pc-gaming",
    searchPhrases: [
      "clean install nvidia drivers",
      "clean install nvidia drivers ddu",
      "clean install amd drivers",
      "how to use ddu",
      "completely uninstall graphics drivers",
    ],
    title: "Clean install NVIDIA or AMD drivers with DDU",
    description:
      "Clean install NVIDIA or AMD drivers after an update broke your games or screen. Stella (stella.sh) wipes every trace of the old driver and puts on a fresh one.",
    h1: "Clean install NVIDIA drivers (or AMD) with DDU",
    short: "Clean install graphics drivers",
    lede: "A broken graphics driver wiped out and replaced with a fresh one.",
    answer:
      "A clean install removes the old driver completely, usually with a free tool called DDU, then puts on a fresh one before Windows can swap in its own. Stella (stella.sh) does every step and gets your games running again.",
    gets: [
      "Every leftover of the old driver removed",
      "A fresh driver from NVIDIA or AMD",
      "Windows kept from replacing it with an older one",
    ],
    prompt:
      "Since the last NVIDIA update my games flicker and crash. Wipe the driver completely and put a clean one on.",
    demo: {
      ack: "On it. I'll remove the old driver properly first.",
      task: "Clean installing your graphics driver",
      rows: ["Downloading DDU and NVIDIA's latest driver", "Pausing Windows driver updates", "Removing every trace of the old driver", "Installing the fresh driver"],
      reply:
        "Done. The old NVIDIA driver is fully gone and a fresh copy of the latest one is installed. Windows updates are paused for a week so it can't swap it back.",
    },
    faq: [
      ["Do I need DDU for a clean install?", "Not always. The NVIDIA and AMD installers have a clean or factory reset option. DDU goes further and clears what those leave behind."],
    ],
    byHand: [
      "Download [DDU](https://www.wagnardsoft.com/display-driver-uninstaller-DDU-) and the newest driver for your card first.",
      "Go offline, restart into Safe Mode, run DDU and choose Clean and restart.",
      "Install the driver you downloaded, then go back online.",
    ],
    related: [
      "pc-gaming/update-graphics-drivers",
      "pc-gaming/black-screen-when-launching-games",
      "pc-gaming/games-crashing-to-desktop",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-fps-drops-in-games",
    niche: "pc-gaming",
    searchPhrases: [
      "fps drops in games windows 11",
      "fps drops",
      "sudden fps drops in games",
      "fps drops every few seconds",
      "laptop fps drops when gaming",
    ],
    title: "FPS drops in games on Windows 11? Find what's slowing it",
    description:
      "Frame rate dipping in fights or after a few minutes? Stella (stella.sh) checks power, graphics, heat and background apps on your PC and fixes what's dragging it down.",
    h1: "FPS drops in games on Windows 11",
    short: "FPS drops in games",
    lede: "Games that hold a steady frame rate instead of dipping mid-fight.",
    answer:
      "FPS drops usually come from a power setting holding the PC back, a laptop using its weaker graphics chip, apps running in the background, or heat. Stella (stella.sh) checks each one on your PC and fixes what it finds.",
    gets: [
      "The real reason your frame rate dips",
      "Power and graphics settings set up for games",
      "Launchers and updaters stopped from running in the background",
    ],
    prompt:
      "My FPS keeps dropping in Fortnite on my gaming laptop, from about 140 to 40 during fights. Figure out why and fix it.",
    demo: {
      ack: "Got it. Looking at what your laptop does while Fortnite runs.",
      task: "Fixing FPS drops in Fortnite",
      rows: ["Power mode was set to Balanced", "Fortnite was using the built-in graphics", "Three launchers running in the background"],
      reply:
        "Fixed three things. Power mode is now **Best performance**, Fortnite uses your RTX 4060 instead of the built-in chip, and Ubisoft Connect, the EA app and Battle.net no longer start with Windows.",
    },
    faq: [
      ["Why does my FPS drop after a few minutes of playing?", "Usually heat. When the graphics card or processor gets too hot, it slows itself down to cool off."],
    ],
    byHand: [
      "Settings > System > Power: set Power mode to Best performance, and keep a laptop plugged in.",
      "Settings > System > Display > Graphics: set the game to High performance.",
      "Task Manager > Startup apps: turn off launchers and updaters you don't need.",
    ],
    related: [
      "pc-gaming/game-stuttering-on-pc",
      "pc-gaming/high-cpu-usage-while-gaming",
      "pc-gaming/pc-overheating-when-gaming",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "game-stuttering-on-pc",
    niche: "pc-gaming",
    searchPhrases: [
      "game stuttering on pc",
      "game stuttering but high fps",
      "game stuttering every few seconds",
      "fix stuttering in games windows 11",
      "game stuttering when moving mouse",
    ],
    title: "Game stuttering on PC, even with high FPS? Smooth it out",
    description:
      "Hitches and micro-freezes even when the FPS counter looks fine? Stella (stella.sh) finds what's causing the stutter on your PC and smooths the game out.",
    h1: "Game stuttering on PC, even with high FPS",
    short: "Game stuttering on PC",
    lede: "Smooth motion instead of hitches and micro-freezes every few seconds.",
    answer:
      "Stutter with a high frame rate usually comes from uneven frame timing, background recording, or a game loading from a slow drive. Stella (stella.sh) finds which it is on your PC and smooths it out.",
    gets: [
      "What causes the hitches, in plain words",
      "A steady frame cap matched to your screen",
      "Background recording and overlays switched off",
    ],
    prompt:
      "Helldivers 2 hitches every few seconds even though my FPS counter says 120. Make it smooth.",
    demo: {
      ack: "On it. Watching what happens around each hitch.",
      task: "Smoothing out Helldivers 2",
      rows: ["Game Bar recording in the background", "Game sits on the old hard drive", "No frame cap for your 144 Hz screen"],
      reply:
        "Background recording is off and Helldivers 2 is capped at 141 FPS, so frames arrive evenly on your 144 Hz screen. I'm moving it to your fast drive now for smoother loading.",
    },
    faq: [
      ["Why does a game stutter with high FPS?", "Smoothness depends on frames arriving evenly, not the average. Uneven frames, a slow drive or the game preparing graphics on the fly all cause hitches."],
    ],
    byHand: [
      "Settings > Gaming > Captures: turn off Record what happened.",
      "Set a frame cap a few below your screen's refresh rate in the NVIDIA App or AMD Software.",
      "Move the game to an SSD from Steam > Settings > Storage.",
    ],
    related: [
      "pc-gaming/fix-fps-drops-in-games",
      "pc-gaming/move-steam-game-to-another-drive",
      "pc-gaming/high-cpu-usage-while-gaming",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "games-crashing-to-desktop",
    niche: "pc-gaming",
    searchPhrases: [
      "games crashing to desktop no error",
      "games keep crashing to desktop windows 11",
      "pc games crashing to desktop",
      "steam games crashing to desktop",
      "all games crashing to desktop",
    ],
    title: "Games crashing to desktop with no error? Find the cause",
    description:
      "Games closing to the desktop with no message? Stella (stella.sh) reads the crash records Windows keeps, finds the cause and fixes it on your PC.",
    h1: "Games crashing to desktop with no error",
    short: "Games crashing to desktop",
    lede: "Find out why games close by themselves, and stop it.",
    answer:
      "Windows records every crash even when the game shows nothing. Those records point to the cause: a driver, an overlay, damaged game files or an unstable overclock. Stella (stella.sh) reads them and fixes it.",
    gets: [
      "The crash reason Windows logged, in plain words",
      "Damaged game files repaired",
      "The app or setting behind the crash fixed",
    ],
    prompt:
      "Cyberpunk keeps closing to the desktop after about 10 minutes with no error message. Find out why and stop it.",
    demo: {
      ack: "On it. Reading the crash records Windows kept.",
      task: "Finding why Cyberpunk crashes",
      rows: ["Found 6 crashes in Windows' error records", "Each one points to the graphics driver", "Verifying Cyberpunk's game files"],
      reply:
        "Every crash came from the graphics driver resetting. I put on a fresh driver and repaired 2 damaged game files. If it closes again, I'll look at the card's clock speeds.",
    },
    faq: [
      ["Where do I see why a game crashed?", "In Event Viewer, under Windows Logs > Application. Look for an Error at the time of the crash naming the game."],
    ],
    byHand: [
      "Open Event Viewer > Windows Logs > Application and find the Error at the time of the crash.",
      "In Steam: right-click the game > Properties > Installed Files > Verify integrity of game files.",
      "Turn off overlays (Discord, Steam, NVIDIA) and any overclocking software.",
      "Clean install the graphics driver if the error names nvlddmkm or amdkmdag.",
    ],
    related: [
      "pc-gaming/clean-install-graphics-drivers",
      "pc-gaming/black-screen-when-launching-games",
      "pc-gaming/d3dx9-43-dll-not-found",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "black-screen-when-launching-games",
    niche: "pc-gaming",
    searchPhrases: [
      "black screen when launching games",
      "black screen when launching games steam",
      "black screen when launching games pc",
      "game black screen but sound",
      "black screen when opening games",
    ],
    title: "Black screen when launching games on PC? Get the picture back",
    description:
      "Game opens to a black screen, sometimes with sound? Stella (stella.sh) resets its display settings to ones your screen can show and gets it to the menu.",
    h1: "Black screen when launching games on PC",
    short: "Black screen when launching games",
    lede: "A game that opens to its menu instead of a black screen.",
    answer:
      "A black screen on launch is usually the game starting at a resolution or refresh rate your screen can't show, or a second display confusing it. Stella (stella.sh) resets the game's display settings so it opens normally.",
    gets: [
      "Display settings reset to ones your screen can show",
      "Windowed mode if fullscreen keeps going black",
      "Missing or damaged game files repaired",
    ],
    prompt:
      "When I launch Baldur's Gate 3 from Steam I just get a black screen with sound. Fix it so I can play.",
    demo: {
      ack: "On it. Checking the game's saved display settings.",
      task: "Fixing Baldur's Gate 3's black screen",
      rows: ["Game was set to 165 Hz", "Your TV only shows 60 Hz", "Resetting display settings to fit"],
      reply:
        "The game was still set up for your old monitor. It's now 1920x1080 at 60 Hz in borderless window, with a copy of the old settings kept. Launch it from Steam and you'll land on the main menu.",
    },
    faq: [
      ["Why do I get a black screen but hear sound?", "The game is running but sending a picture your screen can't show. Press Alt+Enter for windowed mode and change the resolution there."],
    ],
    byHand: [
      "Press Alt+Enter once the game starts to force windowed mode.",
      "In Steam: Properties > General > Launch options, add -windowed.",
      "Rename the game's settings file in Documents or AppData so it starts with defaults.",
    ],
    related: [
      "pc-gaming/games-crashing-to-desktop",
      "pc-gaming/monitor-stuck-at-60hz",
      "pc-gaming/clean-install-graphics-drivers",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "pc-overheating-when-gaming",
    niche: "pc-gaming",
    searchPhrases: [
      "pc overheating when playing games",
      "pc overheating fix",
      "gpu fans loud when gaming",
      "cpu temperature too high while gaming",
      "laptop overheating while gaming",
    ],
    title: "PC overheating when playing games? Cooler and quieter",
    description:
      "PC running hot with fans roaring in games? Stella (stella.sh) reads your temperatures while you play and changes the settings that cool it down and quiet it.",
    h1: "PC overheating when playing games",
    short: "PC overheating while gaming",
    lede: "A cooler, quieter PC that doesn't slow down in long sessions.",
    answer:
      "First see which part runs hot, then cap the frame rate, set gentler fan speeds and clear out dust. Stella (stella.sh) reads your temperatures during a game and changes what cools it down.",
    gets: [
      "Processor and graphics card temperatures while you play",
      "A frame cap so the card stops working harder than needed",
      "Fan speeds that rise gradually instead of roaring",
    ],
    prompt:
      "My PC gets really hot and the fans sound like a jet engine when I play Warzone. Make it run cooler and quieter.",
    demo: {
      ack: "On it. Reading your temperatures while Warzone runs.",
      task: "Cooling your PC down",
      rows: ["Graphics card reaching 86°C", "Warzone running uncapped at 300 FPS", "Setting a frame cap and fan curve"],
      reply:
        "Your graphics card was drawing 300 frames a second for a 144 Hz screen. I capped Warzone at 141 and set a gentler fan curve in MSI Afterburner.",
    },
    faq: [
      ["Why are my GPU fans so loud when gaming?", "The fans speed up as the card heats. An uncapped frame rate, dust or a steep fan setting make them louder than needed."],
    ],
    byHand: [
      "Watch temperatures with [HWiNFO](https://www.hwinfo.com) while a game runs.",
      "Cap the frame rate a few below your screen's refresh rate in the game or your graphics software.",
      "Set a fan curve in [MSI Afterburner](https://www.msi.com/Landing/afterburner/graphics-cards).",
    ],
    related: [
      "pc-gaming/undervolt-gpu",
      "pc-gaming/fix-fps-drops-in-games",
      "pc-gaming/high-cpu-usage-while-gaming",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "undervolt-gpu",
    niche: "pc-gaming",
    searchPhrases: [
      "undervolt gpu",
      "undervolt gpu with msi afterburner",
      "how to undervolt nvidia gpu",
      "undervolt amd gpu adrenalin",
      "undervolt rtx 4080",
    ],
    title: "Undervolt your GPU with MSI Afterburner or AMD Software",
    description:
      "Undervolt your graphics card so it runs cooler and quieter at the same speed. Stella (stella.sh) sets it up in MSI Afterburner or AMD Software and saves a profile.",
    h1: "Undervolt your GPU to run cooler and quieter",
    short: "Undervolt a GPU",
    lede: "The same game performance with less heat, power and fan noise.",
    answer:
      "Undervolting runs your graphics card at the same speed on less power, so it stays cooler and quieter. Stella (stella.sh) sets the voltage curve in MSI Afterburner or AMD Software and keeps your stock settings one click away.",
    gets: [
      "A lower-voltage profile for your exact card",
      "Your original settings saved as their own profile",
      "The new profile applied every time Windows starts",
    ],
    prompt:
      "Undervolt my RTX 4080 so it runs cooler and quieter in games without losing performance.",
    demo: {
      ack: "Sure. Starting from your card's stock settings.",
      task: "Undervolting your RTX 4080",
      rows: ["Saving stock settings as profile 1", "Setting 2700 MHz at 950 mV", "Saving profile 2, applied at startup"],
      reply:
        "Done. Profile 2 in MSI Afterburner runs your card at 2700 MHz on 950 mV. If a game ever crashes, click profile 1 to go back.",
    },
    faq: [
      ["Is undervolting a GPU safe?", "Yes. It lowers power rather than raising it, so the worst case is a game crash, fixed by going back to stock settings."],
    ],
    byHand: [
      "Install [MSI Afterburner](https://www.msi.com/Landing/afterburner/graphics-cards) and save your stock settings as a profile.",
      "Press Ctrl+F for the curve editor, raise the 950 mV point to your target clock and drag later points below it.",
      "Play a demanding game for an hour. If it crashes, raise the voltage one step.",
      "AMD: AMD Software > Performance > Tuning, then lower the voltage slider.",
    ],
    related: [
      "pc-gaming/pc-overheating-when-gaming",
      "pc-gaming/fix-fps-drops-in-games",
      "pc-gaming/update-graphics-drivers",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "second-monitor-not-detected",
    niche: "pc-gaming",
    searchPhrases: [
      "second monitor not detected windows 11",
      "second monitor not detected",
      "dual monitor not working windows 11",
      "second monitor not detected after nvidia driver update",
      "second monitor no signal",
    ],
    title: "Second monitor not detected on Windows 11? Get it showing",
    description:
      "Second screen missing or saying no signal? Stella (stella.sh) finds why Windows can't see it and sets both monitors up in the right order at full resolution.",
    h1: "Second monitor not detected on Windows 11",
    short: "Second monitor not detected",
    lede: "Both screens on, in the right order, at the right sizes.",
    answer:
      "Often the cable is in the motherboard's socket instead of the graphics card's, Windows hasn't looked again, or a driver update reset the display. Stella (stella.sh) finds the cause and arranges both screens the way you sit at them.",
    gets: [
      "Both monitors detected and turned on",
      "Screens arranged so the mouse crosses the right edge",
      "Each screen at its full resolution and refresh rate",
    ],
    prompt:
      "My second monitor stopped showing up after a Windows update and says no signal. Get both screens working again.",
    demo: {
      ack: "On it. Checking what Windows sees on each output.",
      task: "Getting your second monitor back",
      rows: ["Windows sees only one display", "Graphics driver replaced by the update", "Reinstalling the driver and looking again"],
      reply:
        "Both monitors are back. The update had swapped your NVIDIA driver for an older Windows one, so I put the right one back. Your Dell sits on the left at 1440p and 165 Hz, your main screen on the right.",
    },
    faq: [
      ["Why does my second monitor say no signal?", "It's getting no picture: a loose cable, the wrong input picked on the monitor, or a cable in the motherboard instead of the graphics card."],
    ],
    byHand: [
      "Plug both monitors into the graphics card, not the motherboard's video outputs.",
      "Settings > System > Display > Multiple displays > Detect.",
      "Press Win+P and choose Extend.",
      "Pick the right input (HDMI or DisplayPort) in the monitor's own menu.",
    ],
    related: [
      "pc-gaming/monitor-stuck-at-60hz",
      "pc-gaming/hdr-washed-out-windows-11",
      "pc-gaming/clean-install-graphics-drivers",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "monitor-stuck-at-60hz",
    niche: "pc-gaming",
    searchPhrases: [
      "monitor stuck at 60hz",
      "144hz monitor only showing 60hz",
      "how to set monitor to 144hz",
      "display stuck at 60hz windows 11",
      "monitor locked at 60hz",
    ],
    title: "Monitor stuck at 60Hz? Get your full 144Hz or 165Hz",
    description:
      "Bought a fast monitor but it's stuck at 60Hz? Stella (stella.sh) finds what's holding it back and sets your screen to the highest refresh rate it supports.",
    h1: "Monitor stuck at 60Hz on Windows",
    short: "Monitor stuck at 60Hz",
    lede: "Your fast monitor running at the speed you paid for.",
    answer:
      "Windows often leaves new monitors at 60Hz. Other times the cable can't carry more, or it's plugged into the motherboard. Stella (stella.sh) finds which and sets your screen to its highest refresh rate.",
    gets: [
      "Your monitor at its highest refresh rate",
      "Which cable or socket is holding it back, if any",
      "Game frame limits matched to the new rate",
    ],
    prompt:
      "I bought a 165Hz monitor but it feels the same as my old one. Make sure it's actually running at 165.",
    demo: {
      ack: "On it. Reading what your monitor says it supports.",
      task: "Unlocking 165Hz",
      rows: ["Windows left it at 60Hz", "Monitor supports up to 165Hz", "Raising it and updating game limits"],
      reply:
        "It was running at 60Hz, Windows' default for a new monitor. It's now at **165Hz**, and Valorant's frame limit and your NVIDIA settings are set to match.",
    },
    faq: [
      ["Why is there no 144Hz option?", "The cable or socket can't carry it. Use DisplayPort or the HDMI cable that came with the monitor, plugged into the graphics card."],
    ],
    byHand: [
      "Settings > System > Display > Advanced display > Choose a refresh rate.",
      "No higher option? Use DisplayPort, or a newer HDMI cable, plugged into the graphics card.",
      "Some monitors need their overclock or high refresh mode switched on in their own menu.",
      "Check the rate you really get at [testufo.com](https://www.testufo.com/refreshrate).",
    ],
    related: [
      "pc-gaming/second-monitor-not-detected",
      "pc-gaming/hdr-washed-out-windows-11",
      "pc-gaming/game-stuttering-on-pc",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "hdr-washed-out-windows-11",
    niche: "pc-gaming",
    searchPhrases: [
      "hdr washed out windows 11",
      "hdr washed out colors",
      "hdr looks washed out on pc",
      "windows hdr looks grey",
      "how to fix hdr on pc",
    ],
    title: "HDR looks washed out on Windows 11? Fix the colours",
    description:
      "Turning on HDR made everything grey and faded? Stella (stella.sh) corrects the Windows and graphics card settings so the desktop looks normal and games look rich.",
    h1: "HDR washed out on Windows 11",
    short: "HDR looks washed out",
    lede: "Rich colours and deep blacks instead of a grey, faded picture.",
    answer:
      "Washed-out HDR usually means Windows shows everyday apps in HDR with the brightness off, the colour range is wrong, or the screen was never tuned. Stella (stella.sh) corrects the settings and sets HDR up just for games.",
    gets: [
      "Desktop colours that look normal again",
      "Full colour range set on the graphics card",
      "A shortcut to switch HDR on when a game needs it",
    ],
    prompt:
      "When I turn on HDR in Windows 11 everything looks grey and washed out on my LG OLED. Make games look good again.",
    demo: {
      ack: "On it. Checking your HDR and colour settings.",
      task: "Fixing washed-out HDR",
      rows: ["Colour range set to limited", "Everyday app brightness set too high", "Installing Windows HDR Calibration"],
      reply:
        "Colour range is now full in the NVIDIA Control Panel and brightness for everyday apps is lowered. HDR stays off on the desktop; press **Win+Alt+B** before a game. Open **Windows HDR Calibration** once to finish tuning your screen.",
    },
    faq: [
      ["Should I leave HDR on all the time in Windows 11?", "Most people turn it on only for HDR games and films. Everyday apps tend to look flatter with it on."],
    ],
    byHand: [
      "Settings > System > Display > HDR: lower the SDR content brightness slider.",
      "Install Windows HDR Calibration from the Microsoft Store and run it.",
      "NVIDIA Control Panel > Change resolution: set Output dynamic range to Full.",
    ],
    related: [
      "pc-gaming/monitor-stuck-at-60hz",
      "pc-gaming/second-monitor-not-detected",
      "pc-gaming/update-graphics-drivers",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "no-sound-on-pc",
    niche: "pc-gaming",
    searchPhrases: [
      "no sound on pc windows 11",
      "no sound on pc",
      "sound coming out of wrong device windows 11",
      "no sound from headphones on pc",
      "game sound not working on pc",
    ],
    title: "No sound on PC in Windows 11? Get your audio back",
    description:
      "No sound, or sound going to the wrong speakers? Stella (stella.sh) finds where Windows is sending your audio and puts it back on your headset or speakers.",
    h1: "No sound on PC in Windows 11",
    short: "No sound on PC",
    lede: "Sound coming out of the speakers or headset you actually want.",
    answer:
      "No sound usually means Windows is sending audio to the wrong device, like a monitor with no speakers, or one app is muted. Stella (stella.sh) finds where the sound goes and sends it to your speakers or headset.",
    gets: [
      "Sound coming out of the device you use",
      "Muted apps and games turned back up",
      "The sound driver reinstalled if it stopped working",
    ],
    prompt:
      "I have no sound on my PC since I plugged in a new monitor. My headset worked fine yesterday. Fix it.",
    demo: {
      ack: "On it. Checking where Windows is sending sound.",
      task: "Getting your sound back",
      rows: ["Output was set to the new monitor", "That monitor has no speakers", "Setting your headset as default"],
      reply:
        "Windows switched sound to your new monitor when you plugged it in. Your HyperX headset is the default again, and the monitor's audio output is turned off so it can't take over next time.",
    },
    faq: [
      ["Why is sound coming out of the wrong device?", "Windows switches to new devices as you plug them in, like a monitor over HDMI. Set your headset as default and turn off outputs you never use."],
    ],
    byHand: [
      "Click the speaker icon on the taskbar, then the arrow next to the volume, and pick your device.",
      "Settings > System > Sound > Volume mixer shows each app's volume and output.",
      "Still silent? Reinstall the audio driver in Device Manager.",
    ],
    related: [
      "pc-gaming/bluetooth-headphones-sound-bad-on-pc",
      "pc-gaming/controller-not-working-on-pc",
      "pc-gaming/second-monitor-not-detected",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "controller-not-working-on-pc",
    niche: "pc-gaming",
    searchPhrases: [
      "controller not working on pc",
      "ps5 controller not working on pc",
      "controller not working on pc steam",
      "xbox controller not working on pc",
      "controller not working on pc bluetooth",
    ],
    title: "Controller not working on PC? PS5, Xbox or Switch Pro",
    description:
      "PS5, Xbox or Switch controller connected but games ignore it? Stella (stella.sh) sets it up so every game sees it, in Steam and outside it.",
    h1: "Controller not working on PC",
    short: "Controller not working on PC",
    lede: "Your controller working in every game, wired or wireless.",
    answer:
      "Many PC games only understand Xbox controllers, so a PS5 or Switch controller needs Steam or a small helper app to translate. Stella (stella.sh) connects your controller and sets it up so games see it.",
    gets: [
      "Your controller paired and showing up in Windows",
      "Games outside Steam seeing it too",
      "The right button icons in games that support them",
    ],
    prompt:
      "My PS5 controller connects to my PC over Bluetooth but does nothing in Forza Horizon 5 from the Xbox app. Make it work.",
    demo: {
      ack: "On it. Checking how Windows sees your controller.",
      task: "Setting up your PS5 controller",
      rows: ["DualSense paired, but Forza doesn't read it", "Installing DS4Windows to present it as Xbox", "Starting DS4Windows with Windows"],
      reply:
        "Done. DS4Windows now makes your DualSense look like an Xbox controller to Forza and other games outside Steam. It starts with Windows, so just turn the controller on and play.",
    },
    faq: [
      ["Why does my controller work in Steam but not other games?", "Steam translates it only for games launched through Steam. Outside Steam, a small app like DS4Windows does the same job."],
    ],
    byHand: [
      "Steam > Settings > Controller: turn on support for your controller type.",
      "For games outside Steam, install [DS4Windows](https://github.com/schmaldeo/DS4Windows) for PlayStation controllers.",
      "Test it in Windows' Set up USB game controllers panel (joy.cpl).",
    ],
    related: [
      "pc-gaming/bluetooth-headphones-sound-bad-on-pc",
      "pc-gaming/no-sound-on-pc",
      "pc-gaming/games-crashing-to-desktop",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "bluetooth-headphones-sound-bad-on-pc",
    niche: "pc-gaming",
    searchPhrases: [
      "bluetooth headphones sound bad on pc",
      "bluetooth headphones sound bad when using mic",
      "bluetooth headphones sound bad on pc when playing games",
      "bluetooth headphones not connecting to pc",
      "airpods sound bad on pc",
    ],
    title: "Bluetooth headphones sound bad on PC? Fix the muffled audio",
    description:
      "Bluetooth headphones turn muffled and tinny in games or Discord? Stella (stella.sh) keeps them in full stereo and moves voice chat to another mic.",
    h1: "Bluetooth headphones sound bad on PC",
    short: "Bluetooth headphones sound bad",
    lede: "Full stereo sound in games, even with voice chat on.",
    answer:
      "When a game or Discord uses your Bluetooth headphones' mic, Windows drops them into a low-quality call mode. Stella (stella.sh) keeps them in full stereo and moves your voice to another mic.",
    gets: [
      "Headphones kept in high-quality stereo",
      "Voice chat using your webcam or desk mic",
      "Pairing fixed if they keep dropping out",
    ],
    prompt:
      "My Sony WH-1000XM5 sound awful and muffled on my PC when I'm in Discord with friends. Make them sound normal.",
    demo: {
      ack: "On it. That sounds like Windows' call mode kicking in.",
      task: "Fixing your headphones' sound",
      rows: ["Discord was using the headphone mic", "Headphones dropped into call mode", "Moving voice chat to your webcam mic"],
      reply:
        "Fixed. Discord now uses your webcam's mic, so the XM5 stay in stereo, and their hands-free output is turned off so games can't switch to it. Music and games sound full again.",
    },
    faq: [
      ["Why do Bluetooth headphones sound worse with the mic on?", "Most Bluetooth headphones can't send high-quality stereo and your voice at once, so Windows switches them to a mono call mode."],
      ["Why won't my Bluetooth headphones connect to my PC?", "Remove them in Settings > Bluetooth & devices, put the headphones in pairing mode and add them again."],
    ],
    byHand: [
      "In Sound settings, pick the plain Headphones output, not the Headset or Hands-Free one.",
      "In Discord and games, set the input to a different mic.",
    ],
    related: [
      "pc-gaming/no-sound-on-pc",
      "pc-gaming/controller-not-working-on-pc",
      "pc-gaming/second-monitor-not-detected",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "d3dx9-43-dll-not-found",
    niche: "pc-gaming",
    searchPhrases: [
      "d3dx9_43.dll not found",
      "d3dx9_43.dll missing",
      "game won't start missing dll",
      "xinput1_3.dll missing",
      "the program can't start because a dll is missing",
    ],
    title: "d3dx9_43.dll not found? Fix missing DLL errors in games",
    description:
      "Game won't start because d3dx9_43.dll or another DLL is missing? Stella (stella.sh) reads the error and installs the right package from Microsoft.",
    h1: "d3dx9_43.dll not found when starting a game",
    short: "d3dx9_43.dll and missing DLL errors",
    lede: "A game that starts instead of complaining about a missing file.",
    answer:
      "Older games need parts of DirectX that Windows doesn't include. Microsoft's DirectX package for older games puts them back, and Visual C++ covers other DLL errors. Stella (stella.sh) reads the error and installs the right one.",
    gets: [
      "The exact missing piece installed from Microsoft",
      "Every older DirectX file games ask for, not just one",
      "No files from random DLL download sites",
    ],
    prompt:
      "Fallout 3 won't start, it says d3dx9_43.dll was not found. Fix it so the game opens.",
    demo: {
      ack: "On it. That file comes in an older DirectX package.",
      task: "Fixing the d3dx9_43.dll error",
      rows: ["Downloading Microsoft's DirectX installer for older games", "Adding d3dx9_43.dll and its set", "Repairing Fallout 3's game files"],
      reply:
        "Done. Microsoft's DirectX package for older games is installed, which adds d3dx9_43.dll and the other files from that set. Start Fallout 3 again and it goes past the error.",
    },
    faq: [
      ["Should I download the DLL from a DLL website?", "There's no need. Those copies are often the wrong version. Microsoft's DirectX installer adds the real file plus the others the game asks for next."],
      ["How do I fix xinput1_3.dll missing?", "It comes in the same Microsoft DirectX package, along with d3dx9_42.dll, d3dcompiler_43.dll and xaudio2_7.dll."],
    ],
    byHand: [
      "Run the [DirectX End-User Runtime Web Installer](https://www.microsoft.com/en-us/download/details.aspx?id=35) from Microsoft.",
      "For VCRUNTIME or MSVCP errors, install the latest [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist).",
      "Then verify the game's files in Steam.",
    ],
    related: [
      "pc-gaming/games-crashing-to-desktop",
      "pc-gaming/black-screen-when-launching-games",
      "pc-gaming/update-graphics-drivers",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "windows-11-slow-startup",
    niche: "pc-gaming",
    searchPhrases: [
      "slow startup windows 11",
      "windows 11 slow boot",
      "pc takes forever to start up",
      "speed up windows 11 boot time",
      "laptop slow startup windows 11",
    ],
    title: "Slow startup on Windows 11? Make your PC boot faster",
    description:
      "PC takes minutes to start and be usable? Stella (stella.sh) finds what slows Windows 11 down at startup, stops what you don't need and finishes stuck updates.",
    h1: "Slow startup on Windows 11",
    short: "Slow startup on Windows 11",
    lede: "A PC that's ready to use soon after you press the power button.",
    answer:
      "Slow startups usually come from too many apps launching with Windows, a stuck update or an old hard drive. Stella (stella.sh) times your startup, stops what you don't need from launching and fixes what's slowing it.",
    gets: [
      "How long startup takes and what makes it slow",
      "Apps you don't need kept from launching",
      "Stuck updates finished instead of retrying every boot",
    ],
    prompt:
      "My PC takes about three minutes to start and be usable. Make Windows 11 boot faster.",
    demo: {
      ack: "On it. Looking at what runs when Windows starts.",
      task: "Speeding up startup",
      rows: ["14 apps launch with Windows", "A stuck update retries each boot", "Turning off 9 you don't need"],
      reply:
        "Done. Nine apps no longer start with Windows, including Spotify, Teams and three updaters, and the stuck update finished installing. Your antivirus, sound and mouse software still start. Restart once to see the difference.",
    },
    faq: [
      ["Why is my PC slow to start after an update?", "Windows finishes updates during startup. If one keeps failing, it retries every time; finishing or removing it ends the delay."],
    ],
    byHand: [
      "Task Manager > Startup apps: disable what you don't need, sorted by Startup impact.",
      "Settings > Windows Update: install anything pending, then restart.",
      "On older PCs, moving Windows to an SSD makes the biggest difference.",
    ],
    related: [
      "pc-gaming/high-cpu-usage-while-gaming",
      "pc-cleanup/free-up-space-on-c-drive",
      "pc-gaming/fix-fps-drops-in-games",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "move-steam-game-to-another-drive",
    niche: "pc-gaming",
    searchPhrases: [
      "move steam game to another drive",
      "how to move steam games to another drive",
      "steam move game to another drive not working",
      "move steam game to ssd",
      "steam move game to another drive manually",
    ],
    title: "Move a Steam game to another drive without redownloading",
    description:
      "Move Steam games to a new drive or SSD without downloading them again. Stella (stella.sh) sets up the Steam library, moves the games and fixes failed moves.",
    h1: "Move a Steam game to another drive",
    short: "Move a Steam game to another drive",
    lede: "Games on the drive you want, with no redownload.",
    answer:
      "Steam can move games itself from its Storage settings once the other drive has a Steam library folder. Stella (stella.sh) creates the library, moves the games you pick and sorts it out when Steam's own move fails.",
    gets: [
      "Games moved with saves and updates intact",
      "A Steam library set up on the new drive",
      "Failed or stuck moves cleaned up",
    ],
    prompt:
      "Move Cyberpunk 2077 and Baldur's Gate 3 from my C drive to my new D drive SSD in Steam.",
    demo: {
      ack: "On it. Setting up a Steam library on D first.",
      task: "Moving two Steam games",
      rows: ["Adding a Steam library on D:", "Moving Cyberpunk 2077", "Moving Baldur's Gate 3"],
      reply:
        "Both games now live in D:\\SteamLibrary and Steam shows them as installed, with nothing to download. Your saves came along, and the space they used on C is free again.",
    },
    faq: [
      ["Can I move a Steam game by copying the folder?", "Yes. Copy it into the new library's steamapps\\common folder, then install the game to that library and Steam finds the files instead of downloading."],
    ],
    byHand: [
      "Steam > Settings > Storage: add a drive to create a new Steam library.",
      "Pick the game in the old drive's list, then the three dots > Move.",
      "Or right-click the game > Properties > Installed Files > Move install folder.",
    ],
    related: [
      "pc-cleanup/free-up-space-on-c-drive",
      "pc-gaming/game-stuttering-on-pc",
      "pc-cleanup/find-large-files-taking-up-space",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "high-cpu-usage-while-gaming",
    niche: "pc-gaming",
    searchPhrases: [
      "high cpu usage while gaming",
      "100 cpu usage while gaming fix",
      "high ram usage while gaming",
      "is high cpu usage while gaming normal",
      "high cpu usage while gaming windows 11",
    ],
    title: "High CPU usage while gaming? Find what's eating it",
    description:
      "Processor at 100% or memory full while you play? Stella (stella.sh) finds which apps are using it, frees them up and caps the game so it stops overworking.",
    h1: "High CPU usage while gaming",
    short: "High CPU or RAM use while gaming",
    lede: "Your processor and memory spent on the game, not background apps.",
    answer:
      "Games are meant to use a lot of the processor. Sitting at 100% with hitching usually means background apps, a browser full of tabs or an uncapped frame rate. Stella (stella.sh) finds what's using it and frees it up.",
    gets: [
      "What's using your processor and memory, app by app",
      "Background apps closed or paused while you play",
      "A frame cap so the game stops overworking the PC",
    ],
    prompt:
      "My CPU sits at 100% when I play Counter-Strike 2 and the game hitches. RAM is almost full too. What's eating it?",
    demo: {
      ack: "On it. Watching your processor and memory while CS2 runs.",
      task: "Finding what's using your CPU",
      rows: ["Chrome with 40 tabs using 5 GB", "OneDrive syncing a large folder", "CS2 uncapped at 400 FPS"],
      reply:
        "CS2 was taking most of the processor drawing 400 frames a second, so I capped it at 240 to match your monitor. OneDrive syncing is paused for two hours, and closing Chrome frees 5 GB of memory.",
    },
    faq: [
      ["How much RAM should games use?", "Most games use 6 to 12 GB. With 16 GB in total, a browser and Discord on top can fill it."],
    ],
    byHand: [
      "Open Task Manager (Ctrl+Shift+Esc) and sort Processes by CPU, then by Memory.",
      "Close browsers and pause cloud sync while you play.",
      "Cap FPS in the game or in your graphics card's software.",
    ],
    related: [
      "pc-gaming/fix-fps-drops-in-games",
      "pc-gaming/game-stuttering-on-pc",
      "pc-gaming/windows-11-slow-startup",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "vcruntime140-dll-missing",
    niche: "pc-gaming",
    searchPhrases: [
      "vcruntime140.dll was not found",
      "vcruntime140.dll missing",
      "msvcp140.dll was not found",
      "vcruntime140_1.dll not found",
      "the code execution cannot proceed because vcruntime140.dll was not found",
      "vcruntime140 dll was not found windows 11",
    ],
    title: "VCRUNTIME140.dll was not found? Get the game to open",
    description:
      "Game or app says VCRUNTIME140.dll or MSVCP140.dll was not found? Stella (stella.sh) installs Microsoft's Visual C++ package in both versions and opens it again.",
    h1: "VCRUNTIME140.dll was not found",
    short: "VCRUNTIME140.dll / MSVCP140.dll missing",
    lede: "The game opening normally instead of stopping at a missing file.",
    answer:
      "VCRUNTIME140.dll and MSVCP140.dll belong to Microsoft's Visual C++ package, which many games and apps quietly rely on. Stella (stella.sh) installs the current package from Microsoft in both the 64-bit and 32-bit versions, then starts the game again.",
    gets: [
      "Microsoft's own Visual C++ package, both versions",
      "VCRUNTIME140_1.dll and MSVCP140.dll errors gone too",
      "A broken earlier install repaired, not stacked on top",
    ],
    prompt:
      "Hades 2 won't open, it says the code execution cannot proceed because VCRUNTIME140.dll was not found. Please fix it.",
    demo: {
      ack: "On it. That file ships with Microsoft's Visual C++ package.",
      task: "Fixing the VCRUNTIME140.dll error",
      rows: ["Visual C++ package is damaged", "Getting both versions from Microsoft", "Repairing the existing install", "Opening Hades 2"],
      reply:
        "Fixed. The Visual C++ package on this PC was half removed. Both the 64-bit and 32-bit versions are now installed fresh from Microsoft, and Hades 2 opens to its title screen.",
    },
    faq: [
      ["Is MSVCP140.dll was not found the same fix?", "Yes. MSVCP140.dll comes in the same Microsoft package as VCRUNTIME140.dll, so installing it fixes both, plus VCRUNTIME140_1.dll."],
      ["Why install the 32-bit version on a 64-bit PC?", "Plenty of games and launchers are still 32-bit programs, and they look for the 32-bit copy. Having both covers every program."],
    ],
    byHand: [
      "Download both vc_redist.x64.exe and vc_redist.x86.exe from Microsoft's [latest Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) page.",
      "If they say already installed, choose Repair. Restart, then try the game.",
      "Skip DLL download websites; their copies are often the wrong version.",
    ],
    related: [
      "pc-gaming/d3dx9-43-dll-not-found",
      "pc-gaming/application-unable-to-start-correctly-0xc000007b",
      "pc-gaming/games-crashing-to-desktop",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "application-unable-to-start-correctly-0xc000007b",
    niche: "pc-gaming",
    searchPhrases: [
      "the application was unable to start correctly 0xc000007b",
      "0xc000007b error",
      "0xc000007b windows 11",
      "0xc000007b error fix",
      "0xc000007b elden ring",
    ],
    title: "The application was unable to start correctly (0xc000007b)",
    description:
      "Seeing 0xc000007b when a game starts? Stella (stella.sh) finds the mixed-up 32-bit and 64-bit files behind it, puts the right ones back and opens the game.",
    h1: "The application was unable to start correctly (0xc000007b)",
    short: "0xc000007b: unable to start correctly",
    lede: "A game that launches instead of a box with a strange code.",
    answer:
      "0xc000007b means a game found a 32-bit file where it needed a 64-bit one, or the other way round. Stella (stella.sh) finds the mismatched file, reinstalls the Microsoft packages it came from and starts the game again.",
    gets: [
      "The wrong-sized file found and named",
      "Visual C++, DirectX and .NET put back properly",
      "Stray copies inside the game folder cleaned out",
    ],
    prompt:
      "Elden Ring gives me 'The application was unable to start correctly (0xc000007b)'. It worked last week. Fix it.",
    demo: {
      ack: "On it. Looking for a file of the wrong kind.",
      task: "Fixing 0xc000007b for Elden Ring",
      rows: ["Found a 32-bit copy in System32", "Reinstalling Visual C++ in both versions", "Adding the older DirectX files", "Checking Elden Ring's game files"],
      reply:
        "Fixed. A 32-bit copy of a Microsoft file had been dropped where Windows keeps the 64-bit one, probably by an old installer. The proper files are back and Elden Ring starts.",
    },
    faq: [
      ["What does 0xc000007b actually mean?", "Windows tried to load a piece of a program built for the other kind of Windows, 32-bit versus 64-bit, and gave up."],
      ["Do I need to reinstall Windows for 0xc000007b?", "Almost never. Putting back the shared Microsoft packages and repairing the game's own files clears it in nearly every case."],
    ],
    byHand: [
      "Reinstall the x64 and x86 Visual C++ Redistributable, the DirectX End-User Runtime and .NET Framework from Microsoft.",
      "Run sfc /scannow in an admin Command Prompt, then restart.",
      "Verify the game's files in Steam or its launcher.",
    ],
    related: [
      "pc-gaming/vcruntime140-dll-missing",
      "pc-gaming/d3dx9-43-dll-not-found",
      "pc-gaming/games-crashing-to-desktop",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "directx-encountered-an-unrecoverable-error",
    niche: "pc-gaming",
    searchPhrases: [
      "directx encountered an unrecoverable error",
      "directx encountered an unrecoverable error call of duty",
      "directx encountered an unrecoverable error warzone",
      "how to fix directx encountered an unrecoverable error",
      "call of duty directx error",
    ],
    title: "DirectX encountered an unrecoverable error? Stop the crash",
    description:
      "Call of Duty or Warzone closing with DirectX encountered an unrecoverable error? Stella (stella.sh) clears the cause, from old shaders to a shaky overclock.",
    h1: "DirectX encountered an unrecoverable error",
    short: "DirectX encountered an unrecoverable error",
    lede: "Full matches of Call of Duty without the crash box.",
    answer:
      "This Call of Duty crash means the graphics card stopped answering the game, usually from a stale driver, a corrupted shader cache or an unstable overclock. Stella (stella.sh) works through those causes and leaves your settings steady.",
    gets: [
      "The game's shader cache cleared so it rebuilds clean",
      "A fresh graphics driver for your exact card",
      "Any factory or manual overclock eased back",
    ],
    prompt:
      "Warzone keeps crashing mid-match with DirectX encountered an unrecoverable error. RTX 4070. Make it stop.",
    demo: {
      ack: "On it. Reading the crash reports Warzone left.",
      task: "Fixing the Warzone DirectX error",
      rows: ["Crash came from the graphics driver", "Clearing Warzone's shader cache", "Installing the newest NVIDIA driver", "Lowering the memory overclock"],
      reply:
        "Done. The driver reset during play each time. Warzone's shader cache is cleared, the NVIDIA driver is fresh, and the overclock from your tuning tool is off. The first match will rebuild shaders, then it plays normally.",
    },
    faq: [
      ["Is my graphics card dying?", "Rarely. Most of the time it's software or a clock speed the card can't hold for long. Stella checks those before anything points at the hardware."],
      ["Does running the game as administrator help?", "It helps when the game can't write its shader files. Stella fixes the folder access instead, so you don't need it every launch."],
    ],
    byHand: [
      "Delete the shader cache folders in the game's install folder (players or shadercache); the game rebuilds them.",
      "Clean install the driver with DDU, then remove any overclock in MSI Afterburner.",
      "Use Scan and Repair in Battle.net or Verify in Steam.",
    ],
    related: [
      "pc-gaming/dxgi-error-device-removed",
      "pc-gaming/clean-install-graphics-drivers",
      "pc-gaming/games-crashing-to-desktop",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "dxgi-error-device-removed",
    niche: "pc-gaming",
    searchPhrases: [
      "dxgi_error_device_removed",
      "dxgi_error_device_hung",
      "dxgi_error_device_removed 0x887a0006",
      "dxgi_error_device_hung apex legends",
      "dxgi_error_device_removed with reason dxgi_error_device_hung",
    ],
    title: "DXGI_ERROR_DEVICE_REMOVED or DEVICE_HUNG? Fix the crash",
    description:
      "Game crashing with DXGI_ERROR_DEVICE_REMOVED or DXGI_ERROR_DEVICE_HUNG? Stella (stella.sh) finds why your graphics card drops out and steadies it.",
    h1: "DXGI_ERROR_DEVICE_REMOVED and DXGI_ERROR_DEVICE_HUNG",
    short: "DXGI_ERROR_DEVICE_REMOVED / DEVICE_HUNG",
    lede: "Long sessions that don't end with the screen freezing.",
    answer:
      "Both errors mean Windows lost contact with your graphics card for a moment and reset it, so the game died. Stella (stella.sh) checks the driver, clock speeds, temperatures and power settings, then fixes whichever one is slipping.",
    gets: [
      "Windows' own reset log read to find the cause",
      "Clock speeds set to what your card holds",
      "Windows given longer to wait on a busy card",
    ],
    prompt:
      "Apex Legends crashes every few games with DXGI_ERROR_DEVICE_HUNG. RX 7800 XT. Find what's wrong and fix it.",
    demo: {
      ack: "On it. Reading Windows' log of graphics card resets.",
      task: "Fixing DXGI_ERROR_DEVICE_HUNG in Apex",
      rows: ["Card reset four times this week", "Each time near 88°C hot spot", "Easing the clock and fan curve", "Giving Windows longer to wait"],
      reply:
        "Fixed. The card was running hot and briefly stalled, so Windows reset it. Clocks are a little lower, fans ramp earlier, and Windows waits longer before resetting. Apex should hold through long sessions now.",
    },
    faq: [
      ["What's the difference between DEVICE_REMOVED and DEVICE_HUNG?", "DEVICE_HUNG means the card stopped responding. DEVICE_REMOVED is what the game sees afterwards, once Windows has reset the card."],
      ["Can a power supply cause DXGI_ERROR_DEVICE_REMOVED?", "Yes. A weak or split cable can make the card drop out under load. Stella spots that pattern in the logs and tells you."],
    ],
    byHand: [
      "Clean install the driver with DDU.",
      "Lower the core clock by 50 to 100 MHz in MSI Afterburner or AMD Adrenalin and test.",
      "Raise TdrDelay to 8 in the registry under HKLM\\System\\CurrentControlSet\\Control\\GraphicsDrivers.",
    ],
    related: [
      "pc-gaming/directx-encountered-an-unrecoverable-error",
      "pc-gaming/undervolt-gpu",
      "pc-gaming/pc-overheating-when-gaming",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "out-of-video-memory-trying-to-allocate",
    niche: "pc-gaming",
    searchPhrases: [
      "out of video memory trying to allocate a rendering resource",
      "out of video memory trying to allocate a texture",
      "out of video memory trying to allocate a rendering resource fix",
      "out of video memory trying to allocate a rendering resource marvel rivals",
      "out of video memory trying to allocate a rendering resource fortnite",
    ],
    title: "Out of video memory trying to allocate a rendering resource",
    description:
      "Marvel Rivals, Fortnite or another game says out of video memory? Stella (stella.sh) checks whether it's settings or your processor, and fixes the real cause.",
    h1: "Out of video memory trying to allocate a rendering resource",
    short: "Out of video memory error",
    lede: "Games that load in instead of crashing at the menu.",
    answer:
      "Despite the wording, this crash often isn't the graphics card at all. On Intel 13th and 14th gen processors it's usually a known instability fixed by a motherboard update. Stella (stella.sh) works out which case you're in and fixes it.",
    gets: [
      "Your processor checked against Intel's known issue",
      "The motherboard update that fixes it, ready to apply",
      "Texture and shader settings matched to your card",
    ],
    prompt:
      "Marvel Rivals crashes with 'out of video memory trying to allocate a rendering resource'. i9-13900K, RTX 4080. Fix it.",
    demo: {
      ack: "On it. Your processor is one Intel flagged.",
      task: "Fixing the out of video memory crash",
      rows: ["Your card has plenty of memory", "Motherboard firmware is from 2023", "Downloading the fixed firmware update", "Setting texture quality to high"],
      reply:
        "Your 13900K is on old motherboard firmware without Intel's fix, which is what triggers this crash. The new update is in Downloads with steps to apply it from the setup screen. Texture quality is high, not ultra.",
    },
    faq: [
      ["Do I need a graphics card with more memory?", "Usually not. With 8 GB or more, the processor or a driver is the likelier cause."],
      ["I have an AMD processor. Can I still get this error?", "Yes, though less often. Then it's typically texture settings above what the card holds, or an old driver, and Stella fixes those."],
    ],
    byHand: [
      "Intel 13th/14th gen: update the motherboard BIOS to one with Intel's latest microcode.",
      "Otherwise lower texture quality a step and update the graphics driver.",
    ],
    related: [
      "pc-gaming/games-crashing-to-desktop",
      "pc-gaming/dxgi-error-device-removed",
      "pc-gaming/update-graphics-drivers",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "game-security-violation-detected",
    niche: "pc-gaming",
    searchPhrases: [
      "game security violation detected",
      "game security violation detected easy anti cheat",
      "easy anti cheat untrusted system file",
      "game security violation detected fortnite",
      "game security violation detected elden ring",
    ],
    title: "Game Security Violation Detected? Get back into the game",
    description:
      "Easy Anti-Cheat stopping your game with Game Security Violation Detected? Stella (stella.sh) finds the harmless program it objects to and clears the way.",
    h1: "Game Security Violation Detected (Easy Anti-Cheat)",
    short: "Game Security Violation Detected",
    lede: "Back in the match without the anti-cheat box stopping you.",
    answer:
      "Easy Anti-Cheat shows this when something harmless running on your PC looks suspicious to it, often a lighting, fan or macro app. Stella (stella.sh) finds which program it named, closes it for game time and repairs Easy Anti-Cheat.",
    gets: [
      "The program Easy Anti-Cheat named, found and explained",
      "That program kept closed while you play",
      "Easy Anti-Cheat repaired from the game's own folder",
    ],
    prompt:
      "Fortnite keeps saying Game Security Violation Detected with code 00000001. I don't cheat. Fix it so I can play.",
    demo: {
      ack: "On it. Finding which program it doesn't like.",
      task: "Clearing Game Security Violation Detected",
      rows: ["The flagged program is your RGB app", "Closing it whenever Fortnite starts", "Repairing Easy Anti-Cheat"],
      reply:
        "Easy Anti-Cheat objected to your keyboard lighting app reading game memory. It now closes when Fortnite opens and comes back after, and Easy Anti-Cheat is repaired. You're clear to play.",
    },
    faq: [
      ["How do I fix untrusted system file in Easy Anti-Cheat?", "The message names a file, often from a driver. Stella repairs Windows' own files and reinstalls the driver it belongs to, such as AMD's hotkey file."],
      ["Does Game Security Violation Detected mean I'm banned?", "No, it stops the game from launching while the flagged program runs. Once that program is closed, the game starts as normal."],
    ],
    byHand: [
      "Note the file or program named in the error and close it, or uninstall it if you don't need it.",
      "Run EasyAntiCheat_Setup.exe in the game's EasyAntiCheat folder and choose Repair.",
    ],
    related: [
      "pc-gaming/games-crashing-to-desktop",
      "pc-gaming/application-unable-to-start-correctly-0xc000007b",
      "pc-gaming/high-cpu-usage-while-gaming",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
];
