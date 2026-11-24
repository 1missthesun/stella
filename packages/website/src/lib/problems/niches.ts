import type { Niche } from "./types";

export const NICHES: Niche[] = [
  {
    slug: "game-mods",
    recommended: "claude",
    name: "Game mods",
    h1: "Game mods, installed and working.",
    title: "Game mods: get them in your game, fixed or made for you",
    description:
      "Mods for GTA, Skyrim, Fallout, Baldur's Gate 3, Stardew Valley, Minecraft and more: installed, fixed or made for you by Stella (stella.sh).",
    intro:
      "Pick your game, say what you want, and play it. Stella (stella.sh) installs mods, fixes the ones that broke and makes new ones.",
    sections: [
      { title: "Grand Theft Auto and Red Dead.", slugs: ["gta-6-mods", "mod-gta-5", "gta-5-mods-not-working", "gta-5-car-mods", "install-script-hook-v", "install-fivem-mods", "mod-gta-san-andreas", "mod-rdr2"] },
      { title: "Skyrim, Fallout and Starfield.", slugs: ["mod-skyrim", "install-skse", "skyrim-load-order", "skyrim-crash-log", "mod-fallout-4", "downgrade-fallout-4", "install-f4se", "mod-fallout-new-vegas", "mod-starfield", "mod-oblivion-remastered"] },
      { title: "Big adventures.", slugs: ["mod-baldurs-gate-3", "bg3-mods-not-working", "bg3-script-extender", "mod-cyberpunk-2077", "cyberpunk-mods-not-working-after-2-5", "mod-elden-ring", "elden-ring-seamless-co-op", "mod-witcher-3", "witcher-3-script-merger", "mod-hogwarts-legacy", "mod-monster-hunter-wilds", "mod-resident-evil-4"] },
      { title: "Minecraft.", slugs: ["install-minecraft-mods", "install-sodium-iris-minecraft-1-21-fabric", "install-minecraft-shaders", "make-a-minecraft-mod", "make-a-minecraft-modpack", "install-minecraft-resource-pack", "install-minecraft-datapacks", "install-minecraft-map", "allocate-more-ram-to-minecraft", "minecraft-modpack-exit-code-1", "back-up-minecraft-worlds", "fix-corrupted-minecraft-world", "turn-on-cheats-in-minecraft-world", "find-all-minecraft-screenshots"] },
      { title: "Sims 4.", slugs: ["install-sims-4-mods",  "install-sims-4-cc",  "sims-4-cc-not-showing-up",  "find-broken-sims-4-mods",  "install-mc-command-center",  "install-wickedwhims",  "sims-4-tray-files",  "sims-4-reshade-presets",  "sims-4-duplicate-cc"] },
      { title: "Cosy, building and survival.", slugs: ["mod-stardew-valley",  "stardew-valley-mods-not-working",  "install-stardew-valley-expanded",  "stardew-valley-recolor-mods",  "cozy-minecraft-texture-packs",  "disney-dreamlight-valley-mods",  "coral-island-mods",  "mod-valheim",  "mod-terraria",  "mod-rimworld",  "mod-palworld",  "mod-subnautica",  "mod-project-zomboid",  "mod-cities-skylines-2",  "mod-lethal-company",  "mod-balatro",  "mod-silksong"] },
      { title: "Driving.", slugs: ["assetto-corsa-mods", "beamng-mods", "euro-truck-simulator-2-mods"] },
      { title: "Mod managers and making your own.", slugs: ["ai-mod-maker", "make-a-skyrim-mod", "install-nexus-mods", "vortex-mod-manager", "mod-organizer-2", "vortex-to-mod-organizer-2", "r2modman-thunderstore", "install-bepinex", "steam-deck-mods"] },
      { title: "Error messages.", slugs: ["skyrim-newer-version-than-skse",  "skse-dll-plugin-failed-to-load",  "fallout-4-newer-version-than-f4se",  "script-hook-v-critical-error"] },
    ],
  },
  {
    slug: "video",
    recommended: "claude",
    name: "Videos for TikTok and YouTube",
    h1: "Finished videos from your raw clips.",
    title: "Video editing made easy: TikToks, Reels, Shorts and YouTube",
    description:
      "Turn raw clips into finished TikToks, Reels, Shorts and YouTube videos: cuts, captions, music, B-roll and vertical crops. Just ask Stella (stella.sh).",
    intro:
      "Drop in your clips and say what you want. Stella (stella.sh) edits it into a finished video.",
    sections: [
      { title: "Finished TikToks, Reels and Shorts.", slugs: ["turn-long-video-into-shorts",  "make-instagram-reel",  "make-travel-video-from-clips",  "twitch-clips-to-tiktok",  "word-by-word-captions",  "auto-reframe-video",  "sync-video-to-music-beat"] },
      { title: "YouTube videos.", slugs: ["edit-raw-footage-into-youtube-video",  "remove-filler-words-from-video",  "add-b-roll-to-video",  "make-youtube-intro",  "make-gaming-montage",  "color-match-clips"] },
      { title: "Weddings, years and memories.", slugs: ["make-wedding-video-from-phone-clips",  "make-recap-video",  "make-slideshow-with-music"] },
      { title: "Cuts, captions and sound.", slugs: ["burn-subtitles-into-video-for-tiktok",  "cut-silences-from-video",  "add-music-to-video",  "crop-video-to-vertical",  "combine-videos-into-one",  "cut-out-part-of-video",  "speed-up-video",  "reverse-video",  "make-video-louder",  "make-srt-subtitle-file"] },
      { title: "Fix, shrink and convert.", slugs: ["stabilize-shaky-video",  "rotate-video",  "compress-video-for-discord",  "convert-mov-to-mp4",  "convert-mkv-to-mp4",  "convert-webm-to-mp4",  "convert-avi-to-mp4",  "make-gif-from-video",  "extract-frames-from-video",  "convert-srt-to-vtt"] },
    ],
  },
  {
    slug: "apps",
    recommended: "claude",
    name: "Your own apps",
    h1: "Little apps, made just for you.",
    title: "Make your own app without coding: trackers, planners, tools",
    description:
      "Describe the app you wish existed: a workout log, budget tracker, recipe box or trip planner. Stella (stella.sh) makes it on your computer.",
    intro:
      "Describe the app you wish you had. Stella (stella.sh) makes it, and changes it when you ask.",
    sections: [
      { title: "Start here.", slugs: ["make-an-app-without-coding",  "turn-a-spreadsheet-into-an-app"] },
      { title: "Health and habits.", slugs: ["make-your-own-workout-tracker",  "make-your-own-habit-tracker",  "make-a-reading-tracker"] },
      { title: "Food and trips.", slugs: ["make-a-recipe-app",  "make-a-meal-planner-with-shopping-list",  "make-a-trip-planner-app"] },
      { title: "Money and home.", slugs: ["make-your-own-budget-app",  "make-a-family-chore-chart-app",  "make-a-plant-watering-tracker",  "make-a-home-inventory-app"] },
    ],
  },
  {
    slug: "websites",
    recommended: "claude",
    name: "Your own website",
    h1: "Your own website, without code.",
    title: "Make a website without code: portfolio, wedding or business",
    description:
      "Get a portfolio, wedding site, small business page or personal site made and put online, with no code and no builder. Just ask Stella (stella.sh).",
    intro:
      "Say what the site is for. Stella (stella.sh) makes it, puts it online and changes it when you ask.",
    sections: [
      { title: "Make a website.", slugs: ["make-a-website-without-coding",  "make-a-small-business-website",  "make-a-landing-page"] },
      { title: "Portfolios, weddings and link in bio.", slugs: ["make-a-portfolio-website",  "make-a-wedding-website-with-rsvp",  "make-a-link-in-bio-page"] },
      { title: "Online, on your own domain.", slugs: ["host-a-website-for-free",  "connect-a-domain-to-your-website",  "move-your-website-off-wix-or-squarespace"] },
      { title: "Forms, Google and updates.", slugs: ["add-a-contact-form-to-your-website",  "get-your-website-on-google",  "update-your-website-by-asking"] },
    ],
  },
  {
    slug: "design",
    recommended: "claude",
    name: "Design and photos",
    h1: "Thumbnails, posters and photos that look done.",
    title: "Design made easy: thumbnails, posters, invites and photo edits",
    description:
      "Make YouTube thumbnails, posters, invites, flyers, menus, Twitch overlays and product photos, or fix your own pictures. Just ask Stella (stella.sh).",
    intro:
      "Say what you need made or fixed. Stella (stella.sh) designs it and hands you the files.",
    sections: [
      { title: "Posters, flyers and invitations.", slugs: ["make-an-event-poster",  "make-a-birthday-invitation",  "make-a-flyer-for-your-business",  "make-a-lost-pet-poster"] },
      { title: "YouTube, Instagram and Twitch.", slugs: ["make-a-youtube-thumbnail",  "make-an-instagram-carousel",  "make-twitch-overlays"] },
      { title: "For your business.", slugs: ["make-a-logo",  "make-a-cafe-menu",  "design-a-t-shirt",  "product-photos-white-background"] },
      { title: "Fixing your photos.", slugs: ["retouch-portrait-photos",  "restore-old-photos",  "colorize-black-and-white-photos"] },
    ],
  },
  {
    slug: "watches",
    recommended: "claude",
    name: "Alerts and watches",
    h1: "Told the moment it's available.",
    title: "Alerts made easy: tickets, tables, restocks and price drops",
    description:
      "Get told when concert tickets, restaurant tables, restocks, cheaper flights, rentals, class seats or campsites open up. Stella (stella.sh) keeps checking.",
    intro:
      "Say what you're waiting for. Stella (stella.sh) keeps checking and tells you the moment it's there.",
    sections: [
      { title: "Tickets and tables.", slugs: ["ticketmaster-ticket-alerts",  "concert-ticket-price-drop-alert",  "resy-opentable-reservation-alerts",  "disney-dining-alerts"] },
      { title: "Flights, hotels and campsites.", slugs: ["flight-price-drop-alert",  "hotel-price-drop-alert",  "campsite-cancellation-alerts"] },
      { title: "Restocks and price drops.", slugs: ["restock-alert",  "pokemon-restock-alerts",  "price-drop-alert"] },
      { title: "Homes, jobs, classes and appointments.", slugs: ["rental-listing-alerts",  "company-job-alerts",  "get-notified-when-a-class-opens",  "global-entry-appointment-alerts"] },
      { title: "Any web page.", slugs: ["website-change-alert"] },
    ],
  },
  {
    slug: "emulation",
    recommended: "gemini",
    name: "Emulators and retro games",
    h1: "Console and retro games, on your computer.",
    title: "Emulators made easy: Switch, PS2, PS3, 3DS, GameCube, RetroArch",
    description:
      "Set up Switch, PS2, PS3, 3DS, GameCube and RetroArch emulators, fix stutter and controllers, patch ROMs and move saves. Just ask Stella (stella.sh).",
    intro:
      "Say which console and which game. Stella (stella.sh) sets up the emulator, the controller and the saves.",
    sections: [
      { title: "Nintendo Switch and 3DS.", slugs: ["set-up-switch-emulator-on-pc",  "switch-emulator-firmware-and-keys",  "switch-emulator-stuttering",  "set-up-azahar-3ds-emulator"] },
      { title: "PlayStation.", slugs: ["set-up-pcsx2",  "pcsx2-stuttering-fix",  "set-up-rpcs3",  "ps1-emulator-for-pc",  "psp-emulator-for-pc"] },
      { title: "GameCube, Wii and retro consoles.", slugs: ["set-up-dolphin-emulator",  "set-up-retroarch",  "retroarch-missing-bios",  "patch-rom-hacks-and-fan-translations"] },
      { title: "Controllers, saves and Steam Deck.", slugs: ["emulator-controller-not-working",  "transfer-saves-between-emulators",  "set-up-emudeck-steam-deck"] },
    ],
  },
  {
    slug: "local-ai",
    recommended: "claude",
    name: "Local AI and ComfyUI",
    h1: "AI that runs on your own computer.",
    title: "Local AI made easy: ComfyUI, Ollama and models on your PC",
    description:
      "Install ComfyUI, fix broken nodes and workflows, add models and LoRAs, run Ollama and fix CUDA or VRAM errors. Just ask Stella (stella.sh).",
    intro:
      "Image makers and chat models that run on your own graphics card, set up and fixed by Stella (stella.sh).",
    sections: [
      { title: "Setting up ComfyUI.", slugs: ["install-comfyui",  "add-models-and-loras-to-comfyui",  "install-stable-diffusion-forge"] },
      { title: "Making pictures.", slugs: ["comfyui-text-to-image-workflow",  "comfyui-upscale-image-workflow",  "run-flux-locally"] },
      { title: "Fixing ComfyUI errors.", slugs: ["comfyui-missing-custom-nodes",  "fix-comfyui-workflow-errors",  "torch-not-compiled-with-cuda-enabled",  "comfyui-python-version"] },
      { title: "Small graphics cards.", slugs: ["comfyui-out-of-memory",  "make-comfyui-faster-low-vram"] },
      { title: "Chat AI on your computer.", slugs: ["run-ai-offline-on-your-computer",  "best-ollama-model-for-your-pc",  "ollama-open-webui-setup"] },
      { title: "Error messages.", slugs: ["torch-cuda-out-of-memory",  "cuda-driver-version-is-insufficient"] },
    ],
  },
  {
    slug: "pc-gaming",
    recommended: "claude",
    name: "PC and gaming fixes",
    h1: "A PC that runs games smoothly.",
    title: "PC gaming fixes: FPS drops, stutter, crashes, drivers, temps",
    description:
      "Fix FPS drops, stutter, crashes and black screens, update graphics drivers, cool a hot PC and sort monitors, sound and controllers. Just ask Stella (stella.sh).",
    intro:
      "Say what's wrong with your PC or your game. Stella (stella.sh) finds the cause and fixes it.",
    sections: [
      { title: "FPS drops, stutter and crashes.", slugs: ["fix-fps-drops-in-games",  "game-stuttering-on-pc",  "high-cpu-usage-while-gaming",  "games-crashing-to-desktop",  "black-screen-when-launching-games",  "d3dx9-43-dll-not-found"] },
      { title: "Graphics drivers and heat.", slugs: ["update-graphics-drivers",  "clean-install-graphics-drivers",  "pc-overheating-when-gaming",  "undervolt-gpu"] },
      { title: "Monitors and HDR.", slugs: ["second-monitor-not-detected",  "monitor-stuck-at-60hz",  "hdr-washed-out-windows-11"] },
      { title: "Sound, controllers and Bluetooth.", slugs: ["no-sound-on-pc",  "bluetooth-headphones-sound-bad-on-pc",  "controller-not-working-on-pc"] },
      { title: "Startup and game storage.", slugs: ["windows-11-slow-startup",  "move-steam-game-to-another-drive"] },
      { title: "Error messages.", slugs: ["vcruntime140-dll-missing",  "application-unable-to-start-correctly-0xc000007b",  "directx-encountered-an-unrecoverable-error",  "dxgi-error-device-removed",  "out-of-video-memory-trying-to-allocate",  "game-security-violation-detected"] },
    ],
  },
  {
    slug: "game-servers",
    recommended: "claude",
    name: "Game servers and Discord",
    h1: "A server for you and your friends.",
    title: "Game servers made easy: Minecraft, Palworld, Valheim, Discord",
    description:
      "Set up a modded Minecraft, Palworld, Terraria or Valheim server your friends can join, fix crashes, and set up Discord bots and roles. Just ask Stella (stella.sh).",
    intro:
      "Say which game and who's playing. Stella (stella.sh) sets up the server and gets your friends in.",
    sections: [
      { title: "Minecraft.", slugs: ["make-a-minecraft-server-for-friends",  "make-a-modded-minecraft-server",  "minecraft-java-and-bedrock-server",  "minecraft-server-without-port-forwarding",  "minecraft-server-crashing"] },
      { title: "Palworld, Valheim, Terraria and Zomboid.", slugs: ["palworld-dedicated-server",  "valheim-dedicated-server-with-mods",  "modded-terraria-server",  "project-zomboid-server-for-friends"] },
      { title: "Players and backups.", slugs: ["whitelist-and-admins-minecraft-server",  "automatic-game-server-backup"] },
      { title: "Discord.", slugs: ["make-a-discord-server",  "make-a-discord-bot",  "game-server-status-discord-bot"] },
    ],
  },
  {
    slug: "streaming",
    recommended: "claude",
    name: "Streaming and OBS",
    h1: "Go live looking and sounding right.",
    title: "Streaming made easy: OBS setup, audio, scenes and dropped frames",
    description:
      "Set up OBS scenes, split game and Discord audio, make your mic sound good and fix dropped frames or lag on Twitch, YouTube and Kick. Just ask Stella (stella.sh).",
    intro:
      "Say what you stream and what's wrong. Stella (stella.sh) sets up OBS and fixes it.",
    sections: [
      { title: "Go live.", slugs: ["set-up-obs-for-streaming",  "best-obs-settings-for-streaming",  "stream-to-twitch-and-youtube",  "capture-card-obs-setup"] },
      { title: "Lag and black screens.", slugs: ["obs-black-screen",  "obs-dropped-frames-encoding-overloaded"] },
      { title: "Voice and sound.", slugs: ["make-mic-sound-better-in-obs",  "separate-game-and-discord-audio-in-obs"] },
      { title: "Scenes, chat and camera.", slugs: ["set-up-obs-scenes",  "add-chat-and-alerts-to-obs",  "obs-virtual-camera"] },
      { title: "Recording and clips.", slugs: ["best-obs-settings-for-recording",  "obs-replay-buffer"] },
    ],
  },
  {
    slug: "make-games",
    recommended: "claude",
    name: "Make your own game",
    h1: "Your own game, from your idea.",
    title: "Make your own game without coding: Roblox, Ren'Py, browser games",
    description:
      "Make a Roblox game, a visual novel, a small browser game or a Minecraft datapack from your idea, and change it by asking. Just ask Stella (stella.sh).",
    intro:
      "Describe the game you want to play. Stella (stella.sh) makes it and changes it when you ask.",
    sections: [
      { title: "Start with an idea.", slugs: ["make-a-game-without-coding",  "make-a-2d-platformer-game",  "make-a-video-game-as-a-gift"] },
      { title: "Roblox.", slugs: ["make-a-roblox-game",  "make-an-obby-in-roblox",  "roblox-studio-scripts"] },
      { title: "Fortnite and Minecraft.", slugs: ["make-a-fortnite-map",  "make-a-minecraft-datapack"] },
      { title: "Stories and RPGs.", slugs: ["make-a-visual-novel-with-renpy",  "make-an-rpg-with-rpg-maker"] },
      { title: "Party games.", slugs: ["make-a-trivia-game",  "make-a-jackbox-style-party-game"] },
    ],
  },
  {
    slug: "sideloading",
    recommended: "gemini",
    name: "Phone, VR and console mods",
    h1: "Apps and mods on your phone, headset and console.",
    title: "Sideloading made easy: iPhone, Android, Quest and handhelds",
    description:
      "Sideload apps on iPhone with AltStore or SideStore, patch Android apps, add Quest mods with SideQuest and set up handhelds. Just ask Stella (stella.sh).",
    intro:
      "Say what you want on your device. Stella (stella.sh) sets it up from your computer.",
    sections: [
      { title: "iPhone and iPad.", slugs: ["install-altstore-on-iphone",  "sidestore-setup",  "install-ipa-on-iphone",  "altstore-apps-expire"] },
      { title: "Android.", slugs: ["install-apk-from-pc-to-android",  "youtube-revanced",  "remove-bloatware-android-with-pc"] },
      { title: "Meta Quest and VR.", slugs: ["sideload-quest-3-with-sidequest",  "beat-saber-custom-songs-quest",  "gorilla-tag-mods"] },
      { title: "Consoles and handhelds.", slugs: ["switch-custom-firmware",  "how-to-mod-3ds",  "ps-vita-homebrew",  "install-decky-loader-steam-deck"] },
    ],
  },
  {
    slug: "downloads",
    recommended: "gemini",
    name: "Download and convert media",
    h1: "Save the video, the playlist, the song.",
    title: "Download videos and music made easy: YouTube, TikTok, Twitch",
    description:
      "Save YouTube videos and playlists, TikToks, Twitch VODs and podcasts, rip CDs and DVDs, and fix files that won't play. Just ask Stella (stella.sh).",
    intro:
      "Paste the link or say what you want to keep. Stella (stella.sh) saves it in a format that plays.",
    sections: [
      { title: "YouTube.", slugs: ["download-youtube-videos",  "download-youtube-playlist",  "youtube-to-mp3"] },
      { title: "TikTok, Instagram, Twitch and other sites.", slugs: ["download-tiktok-without-watermark",  "download-instagram-reels",  "download-twitch-vods",  "download-video-from-website"] },
      { title: "Music and podcasts.", slugs: ["spotify-playlist-to-mp3",  "download-all-podcast-episodes",  "separate-song-into-stems"] },
      { title: "CDs, DVDs and Blu-rays.", slugs: ["rip-cd-to-flac-or-mp3",  "rip-dvd-to-mp4"] },
      { title: "Files that won't play right.", slugs: ["hevc-video-wont-play",  "fix-audio-out-of-sync-with-video"] },
    ],
  },
  {
    slug: "publishing",
    recommended: "claude",
    name: "Books, comics and printables",
    h1: "Your book, ready to print or publish.",
    title: "Make a book made easy: children's books, cookbooks, comics, KDP",
    description:
      "Make a children's book, family cookbook, photo book or comic, and get it ready for Amazon KDP, print or EPUB. Just ask Stella (stella.sh).",
    intro:
      "Bring the words, recipes or photos. Stella (stella.sh) lays out the book and gets it ready to print.",
    sections: [
      { title: "Books from your photos and keepsakes.", slugs: ["make-a-photo-book",  "make-a-memory-book",  "turn-kids-artwork-into-a-book"] },
      { title: "Picture books and comics.", slugs: ["make-a-childrens-book",  "turn-a-story-into-a-comic",  "make-a-coloring-book"] },
      { title: "Self-publishing on Amazon and Apple Books.", slugs: ["format-a-book-for-kdp",  "make-a-kdp-book-cover",  "make-an-ebook",  "self-publish-a-poetry-book"] },
      { title: "Printables.", slugs: ["make-a-printable-planner",  "make-recipe-cards",  "make-a-zine"] },
    ],
  },
  {
    slug: "3d-printing",
    recommended: "claude",
    name: "3D printing and making",
    h1: "From an idea to a finished print.",
    title: "3D printing made easy: custom STLs, fixes and slicer setup",
    description:
      "Get a custom STL made, fix broken models, set up Bambu Lab or Prusa slicing, and make cosplay parts or laser-cut files. Just ask Stella (stella.sh).",
    intro:
      "Say what you want to print or make. Stella (stella.sh) makes the file and gets it print-ready.",
    sections: [
      { title: "Make something to print.", slugs: ["make-a-custom-stl-file",  "3d-print-a-replacement-part",  "make-a-name-keychain-stl",  "make-a-lithophane-from-a-photo"] },
      { title: "Cosplay and sizing.", slugs: ["3d-print-a-cosplay-helmet",  "resize-a-3d-model-to-measurements",  "split-a-model-for-3d-printing"] },
      { title: "Fix files and prints.", slugs: ["fix-a-broken-stl-file",  "fix-3d-print-stringing"] },
      { title: "Slicer settings.", slugs: ["bambu-studio-best-settings",  "prusaslicer-best-settings"] },
      { title: "Laser cutting.", slugs: ["make-svg-files-for-laser-cutting"] },
    ],
  },
  {
    slug: "etsy-cricut",
    recommended: "claude",
    name: "Etsy and Cricut",
    h1: "Files ready for your shop and your Cricut.",
    title: "Etsy and Cricut made easy: SVGs, printables, mockups and listings",
    description:
      "Make SVG cut files, printable packs in every size, mockups and Etsy listings, and get designs ready for Cricut Design Space. Just ask Stella (stella.sh).",
    intro:
      "Say what you're selling or cutting. Stella (stella.sh) gets the files ready.",
    sections: [
      { title: "Cricut cut files.", slugs: ["make-svg-files-for-cricut",  "convert-png-to-svg-for-cricut",  "cricut-not-uploading-svg"] },
      { title: "Stickers and sublimation.", slugs: ["make-stickers-with-cricut",  "sublimation-size-chart"] },
      { title: "Printables and downloads.", slugs: ["printable-wall-art-sizes",  "sell-digital-downloads-on-etsy",  "make-worksheets-to-sell"] },
      { title: "Your Etsy shop.", slugs: ["etsy-mockups",  "etsy-listing-generator",  "etsy-listing-photo-size",  "etsy-bookkeeping-spreadsheet"] },
    ],
  },
  {
    slug: "ebooks",
    recommended: "claude",
    name: "Kindle and fanfic",
    h1: "Your library, on your Kindle.",
    title: "Kindle made easy: fanfic to EPUB, Calibre, covers and reading stats",
    description:
      "Save AO3 fanfic as EPUBs with covers, send books to Kindle, tidy a Calibre library and see your reading stats. Just ask Stella (stella.sh).",
    intro:
      "Say what you want to read and where. Stella (stella.sh) gets it there, tidy and with covers.",
    sections: [
      { title: "Fanfic.", slugs: ["ao3-to-kindle",  "download-all-ao3-bookmarks",  "fanfiction-to-epub",  "make-a-fanfic-cover"] },
      { title: "Books on your Kindle or Kobo.", slugs: ["send-epub-to-kindle",  "how-to-put-books-on-kobo"] },
      { title: "A tidy library.", slugs: ["organize-kindle-library",  "organize-calibre-library",  "export-kindle-library-list",  "remove-duplicate-ebooks"] },
      { title: "Goodreads and StoryGraph.", slugs: ["reading-wrapped",  "goodreads-to-storygraph"] },
    ],
  },
  {
    slug: "planning",
    recommended: "claude",
    name: "Notion and digital planners",
    h1: "Your planner, set up the way you think.",
    title: "Digital planning made easy: Notion dashboards, GoodNotes planners",
    description:
      "Get a Notion dashboard, a hyperlinked GoodNotes planner or a shared calendar made for how you plan. Just ask Stella (stella.sh).",
    intro:
      "Say how you like to plan. Stella (stella.sh) builds the dashboard, planner or calendar.",
    sections: [
      { title: "Notion pages.", slugs: ["make-a-notion-dashboard",  "make-an-aesthetic-notion-widget-page",  "make-a-notion-habit-tracker",  "make-a-notion-budget-from-your-bank-statement",  "make-a-notion-reading-list"] },
      { title: "Moving into Notion.", slugs: ["import-into-notion",  "sync-notion-calendar-with-google-calendar"] },
      { title: "GoodNotes and digital planners.", slugs: ["make-a-hyperlinked-digital-planner",  "make-a-custom-goodnotes-planner",  "import-a-planner-into-goodnotes"] },
      { title: "Calendars.", slugs: ["make-a-shared-family-calendar",  "make-a-weekly-planner-from-your-calendar"] },
    ],
  },
  {
    slug: "music-library",
    recommended: "claude",
    name: "Spotify and Apple Music",
    h1: "Your music, in the app you use.",
    title: "Music library made easy: Spotify, Apple Music and local files",
    description:
      "Move playlists between Spotify, Apple Music and YouTube Music, add local files and unreleased tracks, and tidy your library. Just ask Stella (stella.sh).",
    intro:
      "Say which app and which music. Stella (stella.sh) moves it, adds it and tidies it.",
    sections: [
      { title: "Switching services.", slugs: ["transfer-spotify-playlists-to-apple-music",  "transfer-apple-music-playlists-to-spotify",  "transfer-spotify-to-youtube-music",  "transfer-itunes-library-to-new-computer"] },
      { title: "Your own songs.", slugs: ["add-local-files-to-spotify",  "add-your-own-music-to-apple-music"] },
      { title: "Fixing and building playlists.", slugs: ["fix-greyed-out-songs-on-spotify",  "remove-duplicates-from-spotify-playlist",  "make-spotify-playlist-from-list-of-songs",  "sort-spotify-playlist-by-bpm"] },
      { title: "Backups and exports.", slugs: ["backup-spotify-playlists",  "export-apple-music-playlist"] },
    ],
  },
  {
    slug: "pc-cleanup",
    recommended: "claude",
    name: "Storage and photo cleanup",
    h1: "Get your space back, safely.",
    title: "Free up storage: Mac, Windows, iCloud and Google Photos",
    description:
      "Free up space on a Mac, PC, iPhone, iCloud or Google Photos: find what's big, clear duplicates and tidy folders. Just ask Stella (stella.sh).",
    intro:
      "Find what's filling your computer, phone or cloud and clear it out. Just ask Stella (stella.sh).",
    sections: [
      { title: "Mac running out of space.", slugs: ["free-up-space-on-mac",  "mac-system-data-too-large"] },
      { title: "Windows and a full C drive.", slugs: ["free-up-space-on-c-drive",  "system-and-reserved-storage-huge",  "onedrive-taking-up-space"] },
      { title: "Big files, duplicates and old apps.", slugs: ["find-large-files-taking-up-space",  "remove-leftover-files-after-uninstall",  "find-duplicate-files",  "organize-downloads-folder",  "delete-empty-folders"] },
      { title: "iCloud, Google and phone storage.", slugs: ["icloud-storage-full",  "download-all-photos-from-icloud",  "google-photos-storage-full",  "whatsapp-media-taking-up-space"] },
      { title: "Photo library cleanup.", slugs: ["delete-duplicate-photos-in-icloud",  "delete-blurry-photos",  "transfer-photos-from-old-laptop"] },
    ],
  },
  {
    slug: "photos-files",
    name: "Photos and files",
    h1: "Photos and files, put in order.",
    title: "Photos and files: convert, resize, de-duplicate, sort, rename",
    description:
      "Convert HEIC, WebP, TIFF or RAW to JPG, remove backgrounds, split scans, watermark or date-stamp photos, fix dates and duplicates. Just ask Stella (stella.sh).",
    intro:
      "Convert, sort, fix and tidy hundreds of photos in one go. Just ask Stella (stella.sh).",
  },
  {
    slug: "files-folders",
    name: "Files and folders",
    h1: "Files and folders, opened and tidied.",
    title: "Files and folders: open RAR and 7z, unzip, rename, search",
    description:
      "Open RAR and 7z files, unzip many zips at once, rename files in bulk, search inside documents and split folders for email. Just ask Stella (stella.sh).",
    intro:
      "Open it, rename it, find it, shrink it. Tell Stella (stella.sh) what you need done with your files.",
  },
  {
    slug: "pdf-excel",
    name: "PDFs and Excel",
    h1: "PDFs and spreadsheets, sorted.",
    title: "PDF and Excel how-tos: merge, split, sign, convert",
    description:
      "Merge, split, sign and edit PDFs, pull text and tables out of them, and get JSON, XML, text or Numbers files into Excel. Just ask Stella (stella.sh).",
    intro:
      "Merge it, split it, sign it, or get the numbers out of it. Give the file to Stella (stella.sh) and ask.",
    sections: [
      {
        title: "Merge, split and tidy PDFs.",
        slugs: [
          "merge-pdf-files",
          "split-pdf-into-multiple-files",
          "extract-pages-from-pdf",
          "delete-pages-from-pdf",
          "reorder-pdf-pages",
          "rotate-pdf-pages",
          "split-pdf-pages-in-half",
          "add-page-numbers-to-pdf",
          "compress-pdf-too-large-to-email",
        ],
      },
      {
        title: "Edit, sign and protect PDFs.",
        slugs: ["edit-text-in-pdf", "add-signature-to-pdf", "fill-pdf-form-from-spreadsheet", "add-watermark-to-pdf", "redact-pdf", "remove-password-from-pdf"],
      },
      {
        title: "Get text, tables and pictures out of PDFs.",
        slugs: [
          "extract-text-from-pdf",
          "make-scanned-pdf-searchable",
          "extract-table-from-pdf-to-excel",
          "extract-images-from-pdf",
          "convert-pdf-to-jpg",
          "convert-excel-to-pdf-without-cutting-off",
          "convert-epub-to-pdf",
          "convert-mobi-to-epub",
        ],
      },
      {
        title: "Get files into Excel, and back out.",
        slugs: [
          "convert-json-to-excel",
          "convert-xml-to-excel",
          "convert-text-file-to-excel",
          "convert-numbers-to-excel",
          "convert-word-table-to-excel",
          "convert-excel-to-csv",
        ],
      },
      {
        title: "Split, combine and clean spreadsheets.",
        slugs: [
          "split-excel-sheet-into-multiple-files",
          "split-csv-file-into-multiple-files",
          "combine-excel-files-into-one-sheet",
          "merge-two-spreadsheets-by-matching-column",
          "compare-two-excel-files",
          "remove-duplicate-rows-in-excel",
          "fix-dates-in-excel",
          "fix-garbled-characters-in-csv",
          "summarize-spreadsheet-by-category",
        ],
      },
      {
        title: "Statements, receipts and bills.",
        slugs: ["bank-statement-pdf-to-excel", "find-subscriptions-in-bank-statement", "receipts-to-spreadsheet", "split-bills-with-roommates"],
      },
    ],
  },
  {
    slug: "money-household",
    recommended: "claude",
    name: "Money, subscriptions and inbox",
    h1: "Your money and inbox, sorted.",
    title: "Money made easy: budgets, subscriptions, receipts and bill splits",
    description:
      "Find forgotten subscriptions, unsubscribe in bulk, sort receipts, split bills with friends and build a budget from your bank files. Just ask Stella (stella.sh).",
    intro:
      "Bank files, receipts and a busy inbox, sorted by Stella (stella.sh).",
    sections: [
      { title: "Subscriptions.", slugs: ["find-subscriptions-in-gmail",  "cancel-forgotten-subscriptions",  "find-duplicate-charges-on-credit-card"] },
      { title: "Your inbox.", slugs: ["bulk-unsubscribe-from-emails",  "gmail-storage-full",  "email-receipts-to-spreadsheet",  "return-deadline-tracker"] },
      { title: "Budgets, bills and net worth.", slugs: ["make-a-budget-from-bank-statement",  "bill-due-date-tracker",  "net-worth-spreadsheet",  "find-unclaimed-money",  "how-much-have-i-spent-on-amazon",  "convert-ofx-to-excel"] },
      { title: "Splitting costs.", slugs: ["splitwise-alternative",  "split-bill-by-item"] },
      { title: "Taxes and work.", slugs: ["organize-tax-documents",  "mileage-log-for-taxes",  "calculate-hours-worked-from-timesheet"] },
    ],
  },
  {
    slug: "documents",
    name: "Word and documents",
    h1: "Word documents, letters and PDFs, sorted.",
    title: "Document how-tos: Word, PDF, invoices and mail merge",
    description:
      "Mail merge from Excel, merge or bulk-convert Word files, PDF to Word, slides with notes, invoices and a cookbook. Just ask Stella (stella.sh).",
    intro:
      "Letters, slides, invoices and whole folders of Word files, done in one go by Stella (stella.sh).",
  },
  {
    slug: "audio",
    recommended: "claude",
    name: "Podcasts, audio and music",
    h1: "Podcasts and recordings that sound finished.",
    title: "Audio made easy: podcast editing, clean-up, stems and music files",
    description:
      "Edit and mix a podcast, clean up noisy recordings, split vocals and stems, convert and tag music, and make ringtones or audiobooks. Just ask Stella (stella.sh).",
    intro:
      "Bring the recording and say what it needs. Stella (stella.sh) edits it, cleans it up and hands it back.",
    sections: [
      { title: "Podcasts and voice-overs.", slugs: ["edit-podcast-episode",  "mix-two-person-podcast",  "master-podcast-loudness",  "zoom-recording-to-podcast",  "make-voice-over-sound-better",  "background-music-for-voice-over"] },
      { title: "Clean up a recording.", slugs: ["remove-background-noise-from-audio",  "remove-echo-from-audio",  "fix-distorted-audio",  "remove-background-music-from-video",  "trim-silence-from-recordings",  "normalize-audio-volume"] },
      { title: "Remixes, mashups and karaoke.", slugs: ["make-karaoke-version-of-song",  "make-mashup-of-two-songs",  "make-extended-mix",  "change-key-of-song",  "slow-down-song-without-changing-pitch"] },
      { title: "Convert and tag music files.", slugs: ["convert-flac-to-mp3",  "convert-m4a-to-mp3",  "convert-wma-to-mp3",  "convert-midi-to-mp3",  "extract-audio-from-video",  "edit-mp3-tags-in-bulk"] },
      { title: "Split, join, ringtones and audiobooks.", slugs: ["merge-mp3-files",  "split-audio-into-tracks",  "make-audiobook-with-chapters",  "make-ringtone",  "transcribe-voice-memos-to-text"] },
    ],
  },
  {
    slug: "contacts-calendar-email",
    name: "Contacts, calendars and email",
    h1: "Contacts, calendars and email, converted.",
    title: "Contacts, calendar and email files: VCF, CSV, ICS, EML",
    description:
      "Convert contacts between CSV and VCF, merge duplicate contacts, turn a calendar into a spreadsheet and saved emails into one PDF. Just ask Stella (stella.sh).",
    intro:
      "Contacts, calendars and emails moved, cleaned up or turned into a file by Stella (stella.sh).",
  },
  {
    slug: "chats-data-exports",
    name: "Chats and data exports",
    h1: "Read the data apps give you.",
    title: "Chat and data exports: WhatsApp, Messenger, Instagram, Spotify",
    description:
      "Turn a WhatsApp or Messenger export into a readable PDF, see who doesn't follow you back on Instagram, or your all-time Spotify stats, from your own data download.",
    intro:
      "Your chats and account downloads, turned into something you can read by Stella (stella.sh).",
  },
  {
    slug: "study",
    recommended: "claude",
    name: "College and study",
    h1: "Coursework, deadlines and revision, handled.",
    title: "College made easy: syllabus to calendar, Anki, citations, charts",
    description:
      "Put every deadline in your calendar, turn lectures into Anki decks, format APA or MLA, chart lab data and track applications. Just ask Stella (stella.sh).",
    intro:
      "Syllabi, lectures, sources and deadlines, turned into what you need by Stella (stella.sh).",
    sections: [
      { title: "Classes and deadlines.", slugs: ["syllabus-to-google-calendar",  "canvas-assignments-to-google-calendar",  "make-a-class-timetable"] },
      { title: "Lectures, notes and revision.", slugs: ["lecture-recording-to-notes",  "make-a-study-guide-from-notes",  "lecture-slides-to-anki-deck",  "make-anki-flashcards-from-notes",  "print-flashcards-double-sided",  "split-textbook-pdf-into-chapters",  "export-kindle-highlights"] },
      { title: "Papers, labs and presentations.", slugs: ["format-a-paper-in-apa-7",  "make-a-bibliography-from-a-list-of-sources",  "set-up-zotero-citations-in-word",  "graph-lab-data-in-excel",  "lab-report-statistics-in-r-or-matlab",  "group-project-slides-from-notes"] },
      { title: "Internships, scholarships and rent.", slugs: ["tailor-resume-for-internship",  "internship-application-tracker",  "find-scholarships-and-track-applications",  "roommate-agreement"] },
      { title: "Puzzles for the classroom.", slugs: ["make-a-word-search",  "make-a-crossword-puzzle"] },
    ],
  },
  {
    slug: "printing-labels",
    name: "Printing and labels",
    h1: "Labels, badges and cards, printed from your own lists.",
    title: "Printing how-tos: labels, name tags, certificates, QR codes",
    description:
      "Print address and barcode labels from Excel, name tags, certificates, QR codes, business cards, passport photos and posters. Just ask Stella (stella.sh).",
    intro:
      "Labels, badges, posters and cards, ready to print from your list. Just ask Stella (stella.sh).",
  },
  {
    slug: "weddings-events",
    recommended: "claude",
    name: "Weddings, trips and events",
    h1: "Weddings, trips and parties, planned.",
    title: "Event planning made easy: weddings, trips, parties and guest lists",
    description:
      "Plan a wedding, trip or party: guest lists, seating charts, place cards, budgets, vendor quotes and day-by-day itineraries. Just ask Stella (stella.sh).",
    intro:
      "Bring the guest list, the dates or the ideas. Stella (stella.sh) turns them into the plan.",
    sections: [
      { title: "Wedding plans and money.", slugs: ["make-wedding-budget-spreadsheet",  "compare-wedding-vendor-quotes",  "wedding-day-timeline"] },
      { title: "Guests, invitations and seating.", slugs: ["wedding-guest-list-with-addresses",  "address-wedding-invitations",  "count-wedding-rsvps",  "make-wedding-seating-chart",  "make-place-cards-from-guest-list",  "write-wedding-thank-you-notes"] },
      { title: "Trips.", slugs: ["travel-itinerary-from-booking-emails",  "plan-a-road-trip-with-stops",  "make-a-packing-list-for-a-trip",  "split-group-trip-costs"] },
      { title: "Parties and showers.", slugs: ["plan-a-bachelorette-party",  "plan-a-kids-birthday-party",  "baby-shower-checklist-and-guest-list",  "make-numbered-raffle-tickets"] },
    ],
  },
  {
    slug: "reading-writing",
    name: "Reading and writing",
    h1: "Books, comics and writing in the format you need.",
    title: "Reading and writing: ebooks, comics, Markdown and manuscripts",
    description:
      "Convert PDF and Word to EPUB, merge ebooks, turn comics into PDFs, Markdown notes into Word or PDF, and format a manuscript. Just ask Stella (stella.sh).",
    intro:
      "Ebooks, comics, notes and manuscripts in the format you need. Just ask Stella (stella.sh).",
  },
  {
    slug: "hobbies",
    name: "Hobbies",
    h1: "Hobby files, rewritten or ready to print.",
    title: "Hobby how-tos: transpose chords, scale recipes, family trees",
    description:
      "Transpose a folder of chord sheets, scale recipes for a crowd and print a family tree chart from a GEDCOM file. Just ask Stella (stella.sh).",
    intro:
      "Chord sheets, recipes and family records, tidied up by Stella (stella.sh).",
  },
  {
    slug: "torrenting",
    recommended: "gemini",
    name: "Torrenting",
    h1: "Torrents, set up, fixed and automated.",
    title: "Torrenting made easy: set up, fixed and sorted",
    description:
      "Set up qBittorrent, fix stuck or slow torrents, get new releases by themselves and sort it all for Plex. Just ask Stella (stella.sh).",
    intro:
      "Say what you want to download, or what's stuck. Stella (stella.sh) does the rest on your computer.",
  },
  {
    slug: "reverse-engineering",
    recommended: "gemini",
    name: "Reverse engineering",
    h1: "Programs, games and files, taken apart.",
    title: "Reverse engineering made easy: just ask",
    description:
      "See what's inside a program, app, game or old file, or change it. Decompile, edit, patch and extract by asking Stella (stella.sh).",
    intro:
      "See what's inside a program, app or game, or change it. Give it to Stella (stella.sh) and ask.",
    sections: [
      {
        title: "Programs.",
        slugs: ["decompile-exe-to-source-code", "use-ai-with-ghidra", "decompile-dotnet-dll-to-csharp", "decompile-python-exe", "patch-exe-file", "is-this-exe-safe", "extract-files-from-exe-installer"],
      },
      { title: "Android, Java and scripts.", slugs: ["decompile-apk", "edit-apk", "decompile-jar-file", "deobfuscate-javascript", "extract-electron-asar", "decompile-lua"] },
      { title: "Games.", slugs: ["edit-save-file", "extract-unity-game-assets", "decompile-unity-game", "decompile-godot-game", "extract-renpy-rpa", "extract-pak-files"] },
      { title: "Formats, networks and devices.", slugs: ["reverse-engineer-a-file-format", "decode-network-protocol-from-pcap", "reverse-engineer-website-api", "inspect-app-traffic-with-mitmproxy", "extract-firmware"] },
    ],
  },
];

export function getNiche(slug: string) {
  return NICHES.find((niche) => niche.slug === slug);
}
