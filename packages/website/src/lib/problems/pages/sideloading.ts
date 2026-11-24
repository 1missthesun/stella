import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const SIDELOADING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "install-altstore-on-iphone",
    niche: "sideloading",
    searchPhrases: [
      "how to install altstore on iphone",
      "how to sideload apps on iphone",
      "altstore setup windows",
      "how to sideload apps on iphone with windows",
      "altstore setup mac",
    ],
    title: "How to install AltStore on iPhone, from Windows or Mac",
    description:
      "Install AltStore on your iPhone and sideload apps that aren't in the App Store. Stella (stella.sh) sets it up from your Windows PC or Mac and adds your first app.",
    h1: "How to install AltStore on your iPhone",
    short: "Install AltStore on iPhone",
    lede: "Apps from outside the App Store on your iPhone, set up from your computer.",
    answer:
      "AltStore puts apps from outside the App Store on your iPhone using your free Apple ID and a small helper on your computer. Stella (stella.sh) installs the helper, puts AltStore on the phone and adds your first app.",
    gets: [
      "AltStore on your iPhone, signed with your own Apple ID",
      "The helper on your computer, starting by itself",
      "Your first sideloaded app on the home screen",
    ],
    prompt:
      "Put AltStore on my iPhone 15 from my Windows laptop so I can install Kodi, which isn't in the App Store.",
    demo: {
      ack: "On it. Plug the iPhone in with its cable and tap Trust.",
      task: "Installing AltStore on your iPhone",
      rows: [
        "Installing Apple's iTunes and iCloud apps",
        "Starting AltServer on your laptop",
        "Putting AltStore on the iPhone",
        "Adding Kodi from your Downloads",
      ],
      reply:
        "Done. AltStore and Kodi are on your iPhone. Trust your Apple ID once in Settings, General, VPN & Device Management. AltServer now starts with Windows.",
    },
    faq: [
      [
        "Do I need a computer for AltStore?",
        "Outside the EU, yes: it signs your apps and renews them weekly. In the EU, AltStore PAL installs from its website.",
      ],
      [
        "How many apps can I sideload with a free Apple ID?",
        "Three at once, AltStore included, and each one lasts 7 days before it needs renewing.",
      ],
    ],
    byHand: [
      "On Windows, install iTunes and iCloud from Apple's site, then AltServer from [altstore.io](https://altstore.io).",
      "Plug in the iPhone, click AltServer in the tray or menu bar, then Install AltStore.",
      "On the iPhone, trust your Apple ID and turn on Developer Mode.",
    ],
    related: [
      "sideloading/install-ipa-on-iphone",
      "sideloading/altstore-apps-expire",
      "sideloading/sidestore-setup",
    ],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sidestore-setup",
    niche: "sideloading",
    searchPhrases: [
      "sidestore setup",
      "sidestore setup guide",
      "sidestore pairing file",
      "altstore vs sidestore",
      "sidestore pairing file not working",
    ],
    title: "SideStore setup: sideloaded apps that renew on the iPhone",
    description:
      "Set up SideStore so your sideloaded iPhone apps renew from the phone, no weekly computer trips. Stella (stella.sh) does the setup and pairing file for you.",
    h1: "SideStore setup, done from your computer",
    short: "SideStore setup",
    lede: "Sideloaded apps that renew from the phone, with no computer each week.",
    answer:
      "SideStore is a free app store for iPhone that renews sideloaded apps on the phone itself, so you need a computer only once. Stella (stella.sh) installs it and sets up the pairing file.",
    gets: [
      "SideStore on your iPhone, signed with your Apple ID",
      "The pairing file in place, so apps renew on any Wi-Fi",
      "LocalDevVPN ready, the switch SideStore needs to renew",
    ],
    prompt:
      "Set up SideStore on my iPhone 14 from this Linux PC so my apps stop expiring when I'm away from home.",
    demo: {
      ack: "Plug the iPhone in and tap Trust. I'll take it from there.",
      task: "Setting up SideStore",
      rows: [
        "Getting iloader for Linux",
        "Signing in with your Apple ID",
        "Installing SideStore and its pairing file",
        "Looking for LocalDevVPN on the phone",
      ],
      reply:
        "SideStore is on your iPhone. Switch on LocalDevVPN, then open SideStore and tap Refresh All. From now on your apps renew over any Wi-Fi.",
    },
    faq: [
      [
        "What is the SideStore pairing file?",
        "It lets SideStore act as if a computer were plugged in. Updating or resetting iOS can break it; Stella makes a fresh one.",
      ],
      [
        "Why does SideStore need a VPN?",
        "LocalDevVPN sends nothing anywhere. It lets the iPhone talk to itself as it would to a computer, so SideStore can renew apps.",
      ],
    ],
    byHand: [
      "Get [iloader](https://github.com/nab138/iloader) on the computer (Windows also needs iTunes), plug in the iPhone and sign in.",
      "Install SideStore from iloader; it places the pairing file too.",
      "On the iPhone, install LocalDevVPN from the App Store, trust your Apple ID, turn on Developer Mode and open SideStore.",
    ],
    related: [
      "sideloading/altstore-apps-expire",
      "sideloading/install-ipa-on-iphone",
      "sideloading/install-altstore-on-iphone",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-ipa-on-iphone",
    niche: "sideloading",
    searchPhrases: [
      "install ipa file on iphone",
      "install ipa on iphone",
      "install ipa on ipad",
      "how to install ipa on iphone with windows",
      "sideloadly install ipa",
    ],
    title: "Install an IPA file on your iPhone or iPad",
    description:
      "Got an IPA file and want it on your iPhone or iPad? Stella (stella.sh) signs it with your Apple ID and installs it from your computer, so the app just opens.",
    h1: "Install an IPA file on your iPhone",
    short: "Install an IPA file",
    lede: "That app file in your Downloads, installed and opening on your phone.",
    answer:
      "An IPA is an iPhone app file. To install one, it gets signed with your Apple ID and sent over from a computer. Stella (stella.sh) does both with Sideloadly or your AltStore, and the app opens on your phone.",
    gets: [
      "Any IPA from your computer on your iPhone or iPad",
      "Signed with your own Apple ID",
      "Your other apps and their data left as they are",
    ],
    prompt:
      "Install the uYouEnhanced IPA I downloaded onto my iPad. It's in my Downloads folder and the iPad is plugged in.",
    demo: {
      ack: "Found it. Unlock the iPad and keep it plugged in.",
      task: "Installing an IPA on your iPad",
      rows: ["Reading the IPA in Downloads", "Signing it with your Apple ID", "Sending it to the iPad"],
      reply:
        "Installed. It's on your iPad's home screen; trust your Apple ID once in Settings, General, VPN & Device Management. It runs for 7 days, and I can make it renew by itself.",
    },
    faq: [
      [
        "Can I install an IPA without a computer?",
        "In the EU, through AltStore PAL. Elsewhere you need a computer once, and SideStore renews it on the phone after that.",
      ],
      [
        "Why does it say Unable to Install?",
        "Usually it was signed for another device, or your free Apple ID already has three apps. Stella signs it again for your phone.",
      ],
    ],
    byHand: [
      "Install [Sideloadly](https://sideloadly.io) on Windows or Mac (Windows also needs iTunes and iCloud).",
      "Plug in the iPhone, drag the .ipa into Sideloadly, enter your Apple ID and click Start.",
      "On the phone, trust your Apple ID and turn on Developer Mode.",
    ],
    related: [
      "sideloading/install-altstore-on-iphone",
      "sideloading/altstore-apps-expire",
      "sideloading/sidestore-setup",
    ],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "altstore-apps-expire",
    niche: "sideloading",
    searchPhrases: [
      "altstore apps expire",
      "do sideloaded apps expire",
      "how long do sideloaded apps last",
      "refresh altstore failed",
      "altstore refresh over wifi",
    ],
    title: "AltStore apps expire after 7 days? Keep them renewing",
    description:
      "AltStore apps stop opening after 7 days. Stella (stella.sh) sets them to renew over your home Wi-Fi and reminds you before one runs out, so they keep working.",
    h1: "AltStore apps expire? Keep them renewing by themselves",
    short: "Stop sideloaded apps expiring",
    lede: "Sideloaded apps that keep opening, week after week.",
    answer:
      "Apps signed with a free Apple ID stop opening after 7 days unless they're renewed. Stella (stella.sh) sets AltStore to renew them over your home Wi-Fi and reminds you if the phone has been away too long.",
    gets: [
      "Apps renewed over Wi-Fi, no cable",
      "The computer side starting by itself",
      "A heads-up before anything runs out",
    ],
    prompt:
      "My AltStore apps keep expiring and I forget to plug my iPhone in. Make them renew by themselves.",
    demo: {
      ack: "On it. Plug the iPhone in once so I can turn on Wi-Fi syncing.",
      task: "Keeping your sideloaded apps alive",
      rows: [
        "Turning on Wi-Fi sync for the iPhone",
        "Starting AltServer with your computer",
        "Renewing all three apps now",
        "Setting a reminder for day 6",
      ],
      reply:
        "All three apps have 7 days again, and AltStore renews them in the background on home Wi-Fi. If a week passes without that, I'll remind you here and on your phone.",
    },
    faq: [
      [
        "Why does AltStore say refresh failed?",
        "Usually AltServer isn't running, or the phone and computer are on different networks. Stella fixes both and renews again.",
      ],
      [
        "Do sideloaded apps lose their data when they expire?",
        "No. An expired app just won't open. Renew it and it opens with everything still there.",
      ],
    ],
    byHand: [
      "In iTunes (Windows) or Finder (Mac), turn on Show this iPhone when on Wi-Fi.",
      "Set AltServer to start with the computer and leave it running.",
      "On the iPhone, allow Background App Refresh for AltStore, or add a daily Shortcuts automation running Refresh All.",
    ],
    related: [
      "sideloading/sidestore-setup",
      "sideloading/install-altstore-on-iphone",
      "sideloading/install-ipa-on-iphone",
    ],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-apk-from-pc-to-android",
    niche: "sideloading",
    searchPhrases: [
      "install apk from pc to android",
      "adb install apk",
      "install apk on android via usb",
      "install apk from pc to phone",
      "install apk from pc to android tv",
    ],
    title: "Install an APK from your PC to your Android phone",
    description:
      "Install APK files from your computer onto your Android phone, tablet or TV. Stella (stella.sh) sets up the Android tools and installs them over USB or Wi-Fi.",
    h1: "Install an APK from your PC to Android",
    short: "Install APKs from your PC",
    lede: "App files from your computer, installed on your phone or TV.",
    answer:
      "Plug the phone in, turn on USB debugging once, and your computer can put any APK straight onto it. Stella (stella.sh) sets up the Android tools, installs your files and tells you plainly if one doesn't suit your phone.",
    gets: [
      "One APK or a whole folder installed at once",
      "Phones, tablets, Android TV and Fire TV",
      "Split app bundles like APKM put on in one go",
    ],
    prompt:
      "Install the three APKs in my Downloads/apps folder on my Samsung phone. It's plugged in with USB.",
    demo: {
      ack: "Okay. Tap Allow on the phone when it asks about this computer.",
      task: "Installing APKs on your Samsung",
      rows: ["Setting up Android's tools on this PC", "Connecting to the Galaxy S23", "Installing 3 apps"],
      reply:
        "All three are installed: NewPipe, Aurora Store and Termux. They're in your app drawer. USB debugging is still on; say the word and I'll switch it off.",
    },
    faq: [
      [
        "How do I turn on USB debugging?",
        "Settings, About phone, tap Build number seven times. Then Developer options, USB debugging on.",
      ],
      [
        "Can I install APKs on Android TV or Fire TV from my PC?",
        "Yes, over Wi-Fi. Turn on network debugging in the TV's developer options and Stella installs them from your computer.",
      ],
    ],
    byHand: [
      "Download Android's [platform tools](https://developer.android.com/tools/releases/platform-tools) and unzip them.",
      "On the phone turn on USB debugging, plug it in and tap Allow.",
      "In that folder run adb install app.apk, or adb install-multiple for split APKs.",
    ],
    related: [
      "sideloading/remove-bloatware-android-with-pc",
      "sideloading/youtube-revanced",
      "reverse-engineering/edit-apk",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "youtube-revanced",
    niche: "sideloading",
    searchPhrases: [
      "youtube revanced",
      "how to install youtube revanced",
      "revanced manager install",
      "youtube without ads on android",
      "youtube revanced sign in not working",
    ],
    title: "YouTube ReVanced: no ads and background play on Android",
    description:
      "Get YouTube ReVanced on your Android phone: no ads, background play, sponsor skipping, still signed in. Stella (stella.sh) patches and installs it from your PC.",
    h1: "Install YouTube ReVanced on Android",
    short: "YouTube ReVanced on Android",
    lede: "YouTube with no ads and screen-off playback, on your phone.",
    answer:
      "YouTube ReVanced is the official YouTube app, patched on your own computer to drop ads and keep playing with the screen off. Stella (stella.sh) gets the matching YouTube version, patches it and installs it with Google sign-in working.",
    gets: [
      "No video ads, sponsor segments skipped",
      "Background play and picture in picture",
      "Still signed in to your Google account",
    ],
    prompt:
      "Put YouTube ReVanced on my Pixel 8 so I get no ads and background play. Keep my Google account signed in.",
    demo: {
      ack: "On it. Plug the Pixel in and allow this computer.",
      task: "Making YouTube ReVanced",
      rows: [
        "Getting the YouTube version the patches need",
        "Patching it with ReVanced patches",
        "Installing GmsCore for Google sign-in",
        "Installing YouTube ReVanced",
      ],
      reply:
        "YouTube ReVanced is on your Pixel next to the normal YouTube. Open it, sign in when GmsCore asks, and let GmsCore ignore battery limits. Ads are gone and SponsorBlock is on.",
    },
    faq: [
      [
        "Why does YouTube ReVanced stop at 1 minute or keep buffering?",
        "Usually a YouTube change the patches haven't caught up with, or an old GmsCore. Stella updates both and patches YouTube again.",
      ],
      [
        "How do I update YouTube ReVanced?",
        "Ask Stella. It gets the version the newest patches support, patches it and installs it over your current one, keeping your settings.",
      ],
    ],
    byHand: [
      "Install ReVanced Manager from [revanced.app](https://revanced.app) and GmsCore from ReVanced's releases page.",
      "In Manager, pick YouTube, get the version it suggests from APKMirror, then Patch and Install.",
      "Open GmsCore once, allow its battery and notification prompts, then sign in to YouTube ReVanced.",
    ],
    related: [
      "sideloading/install-apk-from-pc-to-android",
      "sideloading/remove-bloatware-android-with-pc",
      "reverse-engineering/edit-apk",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "remove-bloatware-android-with-pc",
    niche: "sideloading",
    searchPhrases: [
      "remove bloatware android with pc",
      "adb debloat samsung",
      "remove bloatware android without root",
      "adb debloater",
      "remove bloatware samsung phone",
    ],
    title: "Remove bloatware on Android from your PC, without root",
    description:
      "Clear the junk apps off your Android phone without root. Stella (stella.sh) lists them, removes the ones you pick from your PC and saves a list to undo it.",
    h1: "Remove bloatware on Android with your PC",
    short: "Remove Android bloatware",
    lede: "A phone without the junk it came with, and nothing broken.",
    answer:
      "You can remove the preinstalled apps on any Android phone over USB, without root, and bring them back later. Stella (stella.sh) lists what's on the phone, removes the junk you pick and keeps everything the phone needs.",
    gets: [
      "What each app is, in plain words",
      "Junk removed, the apps your phone needs left alone",
      "A saved list to bring any app back",
    ],
    prompt:
      "Remove the bloatware from my Samsung Galaxy A55: Facebook, Bixby and the Samsung copies of Google apps. It's plugged in.",
    demo: {
      ack: "Okay. Allow this computer on the phone and I'll list the apps.",
      task: "Debloating your Galaxy A55",
      rows: [
        "Listing the installed apps",
        "Matching them to a safe-to-remove list",
        "Removing the 41 you picked",
        "Saving a list to undo it",
      ],
      reply:
        "Done. 41 apps are gone, including Facebook, Bixby and Samsung Free. Calls, camera and system updates are untouched. The list is in Documents; ask me to bring any app back.",
      files: ["galaxy-a55-removed-apps.txt"],
    },
    faq: [
      [
        "Is it safe to debloat with ADB?",
        "Yes when you skip the apps the phone runs on. Removal only applies to your user, so Stella or a factory reset brings any app back.",
      ],
      [
        "Do removed apps come back after an update?",
        "Big system updates sometimes return a few. Ask Stella and it removes them again from your saved list.",
      ],
    ],
    byHand: [
      "Turn on USB debugging, plug the phone in and allow this computer.",
      "Run [Universal Android Debloater Next Generation](https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation) and stick to apps marked Recommended.",
      "Select them, Uninstall, and export the list so you can restore later.",
    ],
    related: [
      "sideloading/install-apk-from-pc-to-android",
      "sideloading/youtube-revanced",
      "pc-cleanup/free-up-space-on-c-drive",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sideload-quest-3-with-sidequest",
    niche: "sideloading",
    searchPhrases: [
      "how to sideload quest 3",
      "sidequest setup quest 3",
      "install apk from pc to quest 3",
      "sidequest not detecting quest 3",
      "how to sideload apps on quest 2",
    ],
    title: "How to sideload on Quest 3 with SideQuest",
    description:
      "Sideload games and apps onto your Meta Quest 3 or Quest 2 with SideQuest. Stella (stella.sh) sets it up on your computer and installs what you want.",
    h1: "How to sideload apps on your Quest 3",
    short: "Sideload on Quest with SideQuest",
    lede: "Games and apps from outside the Meta store, on your headset.",
    answer:
      "Sideloading on Quest takes developer mode, switched on once in the Meta Horizon phone app, plus SideQuest on your computer. Stella (stella.sh) sets up SideQuest, connects the headset and installs the games and apps you want.",
    gets: [
      "SideQuest set up and seeing your headset",
      "Games and apps installed from your computer",
      "Everything under Unknown Sources in your library",
    ],
    prompt:
      "Set up my Quest 3 for sideloading and install the VR game APK I downloaded. It's in my Downloads folder.",
    demo: {
      ack: "Plug the Quest in with its cable and put it on when I ask.",
      task: "Setting up your Quest for sideloading",
      rows: [
        "Looking for developer mode on the headset",
        "Installing SideQuest on this PC",
        "Waiting for you to allow USB debugging",
        "Installing the APK from Downloads",
      ],
      reply:
        "Done. Your game is on the Quest. In the headset, open the Library, pick Unknown Sources from the menu and start it there. Next time, plug in and ask.",
    },
    faq: [
      [
        "Why is SideQuest not detecting my Quest 3?",
        "Developer mode is off, the Allow USB debugging prompt in the headset was missed, or the cable only charges.",
      ],
      [
        "How do I turn on developer mode on Quest?",
        "Make a free developer account at developers.meta.com, then in the Meta Horizon phone app open your headset's settings and switch on Developer Mode.",
      ],
    ],
    byHand: [
      "Create a developer organization at [developers.meta.com](https://developers.meta.com) with a verified Meta account.",
      "In the Meta Horizon phone app: Devices, your headset, Headset settings, Developer Mode, on.",
      "Install [SideQuest](https://sidequestvr.com) Advanced Installer, plug in the Quest and tap Allow in the headset.",
    ],
    related: [
      "sideloading/beat-saber-custom-songs-quest",
      "sideloading/gorilla-tag-mods",
      "sideloading/install-apk-from-pc-to-android",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "beat-saber-custom-songs-quest",
    niche: "sideloading",
    searchPhrases: [
      "beat saber custom songs quest 3",
      "beat saber mods quest 3",
      "beat saber custom songs quest 2",
      "how to mod beat saber quest",
      "beat saber custom songs pc",
    ],
    title: "Beat Saber custom songs on Quest 3, Quest 2 and PC",
    description:
      "Get custom songs and mods in Beat Saber on your Quest 3 or Quest 2. Stella (stella.sh) patches the game from your computer and loads the maps you ask for.",
    h1: "Beat Saber custom songs on Quest 3",
    short: "Beat Saber custom songs",
    lede: "Fan-made maps in your Beat Saber, with a song browser inside the game.",
    answer:
      "Custom songs on Quest need Beat Saber moved to a moddable version and patched, which ModsBeforeFriday does from a browser over USB. Stella (stella.sh) runs it, adds the core mods and loads the songs you ask for.",
    gets: [
      "Beat Saber patched with the core mods",
      "A song browser inside the game",
      "The maps you named, waiting in Custom Levels",
    ],
    prompt:
      "Get custom songs on Beat Saber on my Quest 3. Add the top ranked maps and a few Imagine Dragons songs.",
    demo: {
      ack: "Plug the Quest in. Developer mode needs to be on first.",
      task: "Modding Beat Saber on your Quest 3",
      rows: [
        "Backing up your scores and settings",
        "Moving Beat Saber to a moddable version",
        "Patching it with ModsBeforeFriday",
        "Adding 25 maps from BeatSaver",
      ],
      reply:
        "Done. Your maps are under Custom Levels, and Song Downloader in the main menu finds more. Turn off automatic updates for Beat Saber so it stays modded.",
    },
    faq: [
      [
        "Why did my custom songs disappear after an update?",
        "The update replaced the modded game. Stella moves it back to the newest moddable version and patches it again; your songs are still on the headset.",
      ],
      [
        "How do I get custom songs on Beat Saber PC?",
        "On PC, mods go in with BSManager or Mod Assistant and songs come from BeatSaver. Stella sets that up too.",
      ],
    ],
    byHand: [
            "Plug in, open [ModsBeforeFriday](https://mbf.bsquest.xyz) in Chrome or Edge, connect, and let it downgrade and patch the game.",
      "Start the game and use Song Downloader, or get maps from [BeatSaver](https://beatsaver.com).",
    ],
    related: [
      "sideloading/sideload-quest-3-with-sidequest",
      "sideloading/gorilla-tag-mods",
      "game-mods/steam-deck-mods",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "gorilla-tag-mods",
    niche: "sideloading",
    searchPhrases: [
      "how to mod gorilla tag on pc",
      "gorilla tag mods",
      "gorilla tag mods quest 3",
      "monke mod manager",
      "gorilla tag mods download",
    ],
    title: "Gorilla Tag mods: how to mod it on PC and play on Quest",
    description:
      "Mod Gorilla Tag on your PC and play it on your Quest with a cable or Air Link. Stella (stella.sh) installs Monke Mod Manager and the mods you want.",
    h1: "How to mod Gorilla Tag on PC, played on your Quest",
    short: "Gorilla Tag mods",
    lede: "Modded Gorilla Tag in your headset, run from your PC.",
    answer:
      "Gorilla Tag mods run on the Steam version, which you play on your Quest over a cable or Air Link. Stella (stella.sh) installs the mods you pick with Monke Mod Manager and gets the game ready to start.",
    gets: [
      "Your mods in the Steam version of Gorilla Tag",
      "Mods that switch on in modded lobbies",
      "Your Quest set to play it from the PC",
    ],
    prompt:
      "Install Gorilla Tag mods on my PC so I can play with my Quest 3. I want Utilla and Computer Interface like my friends.",
    demo: {
      ack: "On it. First I'll find Gorilla Tag in your Steam library.",
      task: "Modding Gorilla Tag",
      rows: [
        "Finding Gorilla Tag in Steam",
        "Running Monke Mod Manager",
        "Installing Utilla and Computer Interface",
        "Looking at the Meta Quest app for Link",
      ],
      reply:
        "Done. Connect your Quest with Air Link or a cable, start Gorilla Tag from Steam and join a modded lobby. Your mods switch on there.",
    },
    faq: [
      [
        "Can I get Gorilla Tag mods on Quest 3 without a PC?",
        "No, mods now work only on the PC version. Any Quest plus a Windows PC plays it through Air Link or a cable.",
      ],
      [
        "Why did my mods stop working after an update?",
        "Game updates often break mods until their makers catch up. Stella looks for new versions and reinstalls them through Monke Mod Manager.",
      ],
    ],
    byHand: [
      "Get Gorilla Tag on Steam and start it once.",
      "Run MonkeModManager.exe from its GitHub page; it finds the game folder.",
      "Tick the mods you want, click Install/Update, then join a modded lobby in game.",
    ],
    related: [
      "sideloading/sideload-quest-3-with-sidequest",
      "sideloading/beat-saber-custom-songs-quest",
      "pc-gaming/controller-not-working-on-pc",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "how-to-mod-3ds",
    niche: "sideloading",
    searchPhrases: [
      "how to mod 3ds",
      "3ds custom firmware",
      "how to hack 3ds 2026",
      "3ds homebrew",
      "how to mod 3ds xl",
    ],
    title: "How to mod a 3DS: custom firmware and homebrew",
    description:
      "Mod your 3DS, 2DS or New 3DS XL with custom firmware and homebrew. Stella (stella.sh) backs up and prepares the SD card on your computer and guides each step.",
    h1: "How to mod your 3DS",
    short: "Mod your 3DS",
    lede: "Your 3DS with homebrew, themes, save backups and its own app store.",
    answer:
      "Modding a 3DS starts with its SD card, set up on a computer for your model and system version. Stella (stella.sh) copies the card first, prepares it and tells you what to press on the console.",
    gets: [
      "Custom firmware on any 3DS, 2DS or New 3DS",
      "A homebrew app store and a save backup app",
      "A copy of the console's memory, kept on your computer",
    ],
    prompt:
      "Mod my New 3DS XL so I can run homebrew and themes. The SD card is in my laptop right now.",
    demo: {
      ack: "Okay. What system version does Settings show at the bottom of the top screen?",
      task: "Setting up your 3DS SD card",
      rows: [
        "Copying your SD card to the laptop",
        "Adding MSET9 for system 11.17",
        "Adding Luma3DS and the finishing apps",
      ],
      reply:
        "The card is ready. Put it in the 3DS, open System Settings, Data Management, Nintendo 3DS, Extra Data, and I'll guide each screen from there. The memory copy goes in Documents/3DS backup.",
    },
    faq: [
      [
        "Does it work on system 11.17?",
        "Yes. MSET9 works on every 3DS and 2DS from 11.8 up to 11.17, the newest version.",
      ],
      [
        "Can I still use Pokémon Bank and online play?",
        "Yes. Pokémon Bank, eShop redownloads and online play keep working with custom firmware.",
      ],
    ],
    byHand: [
      "Follow [3ds.hacks.guide](https://3ds.hacks.guide), which picks the method for your system version.",
      "Copy the files to the SD card, run the MSET9 script, then trigger it from Data Management on the 3DS.",
      "Install boot9strap with SafeB9SInstaller, then do Finalizing Setup and back up your NAND.",
    ],
    related: [
      "emulation/set-up-azahar-3ds-emulator",
      "sideloading/ps-vita-homebrew",
      "sideloading/switch-custom-firmware",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "ps-vita-homebrew",
    niche: "sideloading",
    searchPhrases: [
      "how to hack ps vita",
      "ps vita homebrew",
      "how to jailbreak ps vita",
      "how to hack ps vita 2000",
      "ps vita henkaku",
    ],
    title: "How to hack a PS Vita and install homebrew",
    description:
      "Hack your PS Vita or PS Vita 2000 on 3.60 to 3.74 and add homebrew and emulators. Stella (stella.sh) guides it and sends the apps over Wi-Fi.",
    h1: "How to hack your PS Vita",
    short: "Hack your PS Vita",
    lede: "Homebrew apps and emulators on your Vita, on any recent firmware.",
    answer:
      "Any PS Vita on firmware 3.60 to 3.74 can be hacked from its own web browser, then filled with homebrew over Wi-Fi. Stella (stella.sh) talks you through the Vita screens and sends the apps from your computer.",
    gets: [
      "Homebrew on any Vita, Vita Slim or Vita TV",
      "VitaShell for moving files over Wi-Fi",
      "The apps and emulators you name, installed",
    ],
    prompt:
      "Hack my PS Vita 2000 on 3.74 and put RetroArch and Adrenaline on it. It's on the same Wi-Fi as my PC.",
    demo: {
      ack: "Okay. Open the Vita's browser and I'll give you the address to type.",
      task: "Setting up homebrew on your PS Vita",
      rows: [
        "Guiding you through HENlo on the Vita",
        "Installing VitaShell with VitaDeploy",
        "Copying RetroArch and Adrenaline over Wi-Fi",
        "Waiting for you to press X on each",
      ],
      reply:
        "Done. RetroArch and Adrenaline are on your home screen. After a full restart, run HENlo from the browser again, or ask me to make it start by itself.",
    },
    faq: [
      [
        "Can I hack a PS Vita on firmware 3.74?",
        "Yes. HENlo runs on 3.60 to 3.74, the latest, straight from the Vita's browser.",
      ],
      [
        "What's the best homebrew for PS Vita?",
        "VitaShell for files, Adrenaline for PSP games, RetroArch for older consoles, and Vita Homebrew Browser to find more.",
      ],
    ],
    byHand: [
      "Follow [vita.hacks.guide](https://vita.hacks.guide): on 3.60 to 3.74, open the HENlo page in the Vita's browser.",
      "In the HENlo menu, install HENkaku and VitaDeploy, then get VitaShell through VitaDeploy.",
      "In VitaShell press Select to start FTP, copy .vpk files to ux0: and press X on each.",
    ],
    related: [
      "emulation/psp-emulator-for-pc",
      "sideloading/how-to-mod-3ds",
      "sideloading/switch-custom-firmware",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "switch-custom-firmware",
    niche: "sideloading",
    searchPhrases: [
      "switch custom firmware",
      "how to hack switch v1",
      "switch homebrew",
      "switch homebrew appstore",
      "atmosphere switch",
    ],
    title: "Switch custom firmware: homebrew on an unpatched Switch",
    description:
      "Put Atmosphère custom firmware and homebrew on your original Switch. Stella (stella.sh) checks your model, sets up the SD card and starts it from your PC.",
    h1: "Switch custom firmware on your own console",
    short: "Switch custom firmware",
    lede: "Homebrew, save backups and a homebrew store on your own Switch.",
    answer:
      "An unpatched first-model Switch runs custom firmware from its SD card, started from your computer over USB with a small jig. Stella (stella.sh) checks your serial, sets up Atmosphère and starts it.",
    gets: [
      "Atmosphère on a copy of the system, the real one untouched",
      "A full copy of the console's memory on your computer",
      "The Homebrew App Store and a save manager",
    ],
    prompt:
      "Set up custom firmware on my original Switch from 2017. I have a jig and the SD card is in my PC.",
    demo: {
      ack: "Okay. Read me the serial number from the sticker on the box.",
      task: "Setting up Atmosphère on your Switch",
      rows: [
        "Checking the serial: unpatched",
        "Putting Hekate and Atmosphère on the SD card",
        "Starting the Switch from this PC over USB",
        "Copying its memory before any change",
      ],
      reply:
        "Done. Your Switch runs Atmosphère from a copy of its system on the SD card, with the Homebrew App Store and JKSV for saves. The backup is in Documents/Switch backup.",
    },
    faq: [
      [
        "Is my Switch hackable?",
        "First-model Switches sold up to mid-2018 usually are; the serial number tells. Later, Lite and OLED models need a modchip.",
      ],
      [
        "What is the Switch Homebrew App Store?",
        "A free store on the console that installs and updates homebrew apps and emulators over Wi-Fi.",
      ],
    ],
    byHand: [
      "Check your serial at [ismyswitchpatched.com](https://ismyswitchpatched.com).",
      "Follow [switch.hacks.guide](https://switch.hacks.guide): Hekate and Atmosphère on the card, RCM with the jig, then send Hekate with TegraRcmGUI.",
      "In Hekate, back up the NAND, make an emuMMC and boot it.",
    ],
    related: [
      "emulation/switch-emulator-firmware-and-keys",
      "sideloading/how-to-mod-3ds",
      "emulation/set-up-switch-emulator-on-pc",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "install-decky-loader-steam-deck",
    niche: "sideloading",
    searchPhrases: [
      "how to install decky loader on steam deck",
      "decky loader plugins",
      "decky loader not showing up",
      "steam deck plugins",
      "decky loader disappeared",
    ],
    title: "Install Decky Loader on Steam Deck and add plugins",
    description:
      "Install Decky Loader on your Steam Deck and add plugins for themes, game art and performance. Stella (stella.sh) sets it up from desktop mode in one go.",
    h1: "Install Decky Loader on your Steam Deck",
    short: "Decky Loader and plugins",
    lede: "Extra menus on your Deck: themes, game art, performance and more.",
    answer:
      "Decky Loader adds a store of plugins to the Steam Deck's quick access menu. Stella (stella.sh) runs in desktop mode, installs it with the plugins you want and brings it back whenever a SteamOS update removes it.",
    gets: [
      "Decky Loader in the quick access menu in gaming mode",
      "Plugins for themes, game art and performance",
      "Back in place after a SteamOS update wipes it",
    ],
    prompt:
      "Install Decky Loader on my Steam Deck with CSS Loader, SteamGridDB and PowerTools.",
    demo: {
      ack: "On it. A box will ask for your Deck's password once.",
      task: "Installing Decky Loader",
      rows: [
        "Running Decky's installer",
        "Adding CSS Loader, SteamGridDB and PowerTools",
        "Restarting Steam for gaming mode",
      ],
      reply:
        "Done. Go back to gaming mode and press the three dots button: Decky is the plug icon at the bottom, with your three plugins inside. If an update ever removes it, ask again.",
    },
    faq: [
      [
        "Why is Decky Loader not showing up after an update?",
        "SteamOS updates often remove it. Running the installer again brings it back with your plugins and their settings.",
      ],
      [
        "What are the best Decky Loader plugins?",
        "CSS Loader for themes, SteamGridDB for game art, PowerTools for performance and Decky Recorder for clips.",
      ],
    ],
    byHand: [
      "Switch to Desktop mode and, if you never have, set a password with passwd in Konsole.",
      "Download the installer from [decky.xyz](https://decky.xyz), run it and pick the release version.",
      "Back in gaming mode, press the three dots button and open the plug icon to browse the plugin store.",
    ],
    related: [
      "game-mods/steam-deck-mods",
      "emulation/set-up-emudeck-steam-deck",
      "sideloading/switch-custom-firmware",
    ],
    platforms: ["linux"],
    lastChecked: "2026-11-24",
  }),
];
