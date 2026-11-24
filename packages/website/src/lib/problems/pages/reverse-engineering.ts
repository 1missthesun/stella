import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const REVERSE_ENGINEERING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "decompile-exe-to-source-code",
    niche: "reverse-engineering",
    searchPhrases: [
      "decompile exe",
      "decompile exe to source code",
      "ai decompiler",
      "decompile exe file to source code",
      "can you decompile an exe",
    ],
    title: "Decompile an EXE to readable C source code",
    description:
      "Lost the source code of a program? Stella (stella.sh) turns the EXE back into source code you can read, change and build again.",
    h1: "Decompile an EXE back to source code",
    short: "Decompile an EXE to source",
    lede: "A program with no source code, turned back into code.",
    answer:
      "Give Stella (stella.sh) the EXE and it writes the source code back for you. It runs both side by side, so you know the new code does the same thing.",
    gets: [
      "Source code you can read and change",
      "A check that it works like the original",
      "What the program does, in plain words",
    ],
    prompt:
      "I lost the source code for this program. Turn the EXE back into code I can build, and tell me what it does.",
    demo: {
      ack: "On it. Reading the program now.",
      task: "Turning parcelquote.exe into code",
      rows: ["Taking the program apart", "Writing it back as readable C", "Running old and new side by side"],
      reply:
        "Done. **parcelquote.c** is 441 readable lines, and it gives the same results as the original every time. It quotes parcel prices by zone and weight, then adds fuel, insurance and discounts.",
      files: ["parcelquote.c"],
    },
    faq: [
      ["Can AI really decompile an EXE?", "Yes. Stella reads the program, writes it back as code and runs both side by side until they behave the same."],
      ["Will I get the original names back?", "You get clear new ones that say what each part does."],
    ],
    byHand: [
      "Install Ghidra, free from [its GitHub releases](https://github.com/NationalSecurityAgency/ghidra/releases), with the Java version it asks for.",
      "Make a project, import the .exe and let it analyze. Window → Decompile shows each function as C.",
      "Rename things as you work out what they do, then File → Export Program → C/C++ and tidy it until it builds.",
    ],
    related: [
      "reverse-engineering/use-ai-with-ghidra",
      "reverse-engineering/decompile-dotnet-dll-to-csharp",
      "reverse-engineering/decompile-python-exe",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "use-ai-with-ghidra",
    niche: "reverse-engineering",
    searchPhrases: [
      "ghidra mcp",
      "ghidra ai",
      "ghidra tutorial",
      "ida pro mcp",
    ],
    title: "Ghidra MCP and AI: name a binary's functions",
    description:
      "Use AI with Ghidra without the setup: Stella (stella.sh) opens the program, works out what every part does and saves it all for you.",
    h1: "Use AI with Ghidra to name a binary's functions",
    short: "Use AI with Ghidra",
    lede: "Ghidra does the digging, and every part gets explained.",
    answer:
      "Stella (stella.sh) runs Ghidra for you. It opens the program, gives every part a clear name and note, and tells you what the program does.",
    gets: [
      "What the program does, in plain words",
      "Every function named and explained",
      "A Ghidra project you can open",
    ],
    prompt:
      "Open this program in Ghidra, name and explain everything in it, and tell me what it does.",
    demo: {
      ack: "On it. Opening it in Ghidra.",
      task: "Explaining frostlog in Ghidra",
      rows: ["Installing Ghidra 12.2", "Naming all 23 functions", "Writing a note on each one"],
      reply:
        "Done. frostlog reads a greenhouse temperature logger's files: it unlocks the data, then reports lows, highs and frost nights. All 23 parts are named and explained in a Ghidra project in your folder.",
    },
    faq: [
      ["Do I need a Ghidra MCP?", "No. Stella works with Ghidra directly."],
      ["Do I have to install Ghidra?", "No. Stella sets it up if you don't have it."],
    ],
    byHand: [
      "Download Ghidra from [its GitHub releases](https://github.com/NationalSecurityAgency/ghidra/releases) and open your program in a new project.",
      "To let an AI app drive it, add a Ghidra MCP bridge such as GhidrAssistMCP or GhidraMCP built for your Ghidra version.",
      "By hand: in Window → Decompile, press L to rename and right-click → Comments to add notes, then save the project.",
    ],
    related: [
      "reverse-engineering/decompile-exe-to-source-code",
      "reverse-engineering/is-this-exe-safe",
      "reverse-engineering/patch-exe-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decompile-dotnet-dll-to-csharp",
    niche: "reverse-engineering",
    searchPhrases: [
      "decompile dll",
      "decompile c# dll to source code",
      "decompile c# exe",
      "how to decompile a dll",
      "decompile dll visual studio",
      "ilspy save as project",
    ],
    title: "Decompile a DLL back to C# source code you can build",
    description:
      "Only have the DLL? Stella (stella.sh) turns it back into C# source code as a project you can open, change and build.",
    h1: "Decompile a DLL back to C# source code",
    short: "Decompile a .NET DLL to C#",
    lede: "Lost C# code, back as a project you can open.",
    answer:
      "Give Stella (stella.sh) the DLL or EXE and it gets the C# source code back as a project that opens in Visual Studio and builds.",
    gets: ["The C# code, as a project", "A check that it builds and works the same", "Your original files left alone"],
    prompt:
      "I lost the source code for our program. Get the C# code back out of this DLL as a project I can build.",
    demo: {
      ack: "On it. Opening the DLL now.",
      task: "Getting ShiftPay's C# back",
      rows: ["Turning the DLL back into C#", "Recovering the pay rates inside", "Building it and comparing results"],
      reply:
        "Done. Open **ShiftPay.sln** in the new ShiftPay-RecoveredSource folder. It builds cleanly, and on your Nov 9 shifts it prints the same report as the original, down to the $4,021.11 total.",
      files: ["ShiftPay-RecoveredSource"],
    },
    faq: [
      ["How close is it to the original code?", "Very close. Most names come back too."],
      ["Can I change it and use it again?", "Yes. It builds like any other project."],
      ["Can I decompile a DLL in Visual Studio?", "To read it, yes: turn on Enable navigation to decompiled sources and press F12 on a type. For a project you can build, ask Stella."],
    ],
    byHand: [
      "Download ILSpy from its GitHub releases page and open the DLL with File → Open.",
      "Select it in the tree, then File → Save Code to write a Visual Studio project with one .cs file per class.",
      "Open the .csproj in Visual Studio and build it. Comments and local variable names don't come back.",
    ],
    related: [
      "reverse-engineering/decompile-exe-to-source-code",
      "reverse-engineering/decompile-unity-game",
      "reverse-engineering/decompile-python-exe",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decompile-python-exe",
    niche: "reverse-engineering",
    searchPhrases: [
      "decompile pyc",
      "decompile python exe",
      "decompile python exe pyinstaller",
      "decompile python exe to py",
      "decompile pyc python 3.12",
      "pyinstxtractor",
    ],
    title: "Decompile a Python EXE back to .py source code",
    description:
      "Lost the Python code behind your EXE? Stella (stella.sh) gets the .py source back out of it so you can open and edit it again.",
    h1: "Decompile a Python EXE back to .py source",
    short: "Decompile a Python EXE",
    lede: "Your Python code, back out of the EXE.",
    answer:
      "Stella (stella.sh) takes a Python EXE apart and gives you the .py files back, then checks they do the same as the EXE.",
    gets: ["Your .py files, ready to edit", "A check against the EXE", "Everything in one folder"],
    prompt:
      "I made this EXE years ago and lost the Python code. Get it back so I can edit it.",
    demo: {
      ack: "On it. Unpacking the EXE.",
      task: "Getting RentSplit's Python back",
      rows: ["Unpacking the EXE", "Turning each file back into Python", "Running both on the same inputs"],
      reply:
        "Done. Your code is in a **RentSplit-source** folder in Downloads, starting with rentsplit_app.py. It gives the same output as the EXE on every input I tried. Your old comments weren't kept inside, so there are none.",
      files: ["RentSplit-source"],
    },
    faq: [
      ["Does it work on any Python EXE?", "It works on the usual kind, where Python was packed into one program."],
      ["How do I decompile a .pyc file from Python 3.12?", "Give it to Stella and ask for the code. New versions like 3.12 trip up most decompilers, so Stella fixes what they get wrong."],
    ],
    byHand: [
      "Download pyinstxtractor.py and run it on the EXE with the same Python version it was built with.",
      "Turn the .pyc files back into .py with PyLingual at pylingual.io, or pycdc.",
      "Fix any function that came out wrong, then run your .py and the EXE on the same inputs and compare.",
    ],
    related: [
      "reverse-engineering/decompile-exe-to-source-code",
      "reverse-engineering/decompile-dotnet-dll-to-csharp",
      "reverse-engineering/decompile-jar-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "patch-exe-file",
    niche: "reverse-engineering",
    searchPhrases: [
      "patch exe file",
      "patch binary",
      "patch binary file",
      "binary patch tool",
      "compare two binary files",
      "hex edit exe",
    ],
    title: "Patch an EXE file to fix a bug in an old program",
    description:
      "Old program with a bug and no source code? Stella (stella.sh) patches the EXE itself and keeps a copy of the original.",
    h1: "Patch an EXE file to fix a bug",
    short: "Patch an EXE file",
    lede: "A bug fixed in a program nobody supports anymore.",
    answer:
      "Even without the source code, Stella (stella.sh) can find the bug inside an EXE and patch just that part. Your original is kept.",
    gets: ["The bug found and fixed", "The smallest possible change", "A copy of the original"],
    prompt:
      "This old program shows the wrong dates and the company is gone. Fix the program itself and keep a copy of the original.",
    demo: {
      ack: "On it. Finding where the dates go wrong.",
      task: "Fixing the dates in LOANTRAK",
      rows: ["Finding how it reads years", "Changing one byte", "Checking dates before and after 2000"],
      reply:
        "Fixed. It read any year from 20 up as 19-something, so every loan looked a century overdue. Now it lists **9 overdue books** and $30.75 in fines. The original is saved as LOANTRAK.ORIGINAL.EXE.",
      files: ["LOANTRAK.EXE", "LOANTRAK.ORIGINAL.EXE"],
    },
    faq: [
      ["Can you change a program without its code?", "Yes. Stella works on the program itself."],
      ["Can I undo it?", "Yes. The original sits next to the fixed one."],
    ],
    byHand: [
      "Copy the EXE first, then open it in Ghidra or x64dbg and find the code behind the bug.",
      "Make the smallest change you can with Patch Instruction and File → Export Program, or a hex editor such as HxD.",
      "Compare the two binary files with fc /b on Windows or cmp -l on Mac and Linux, then try the fix on real data.",
    ],
    related: [
      "reverse-engineering/decompile-exe-to-source-code",
      "reverse-engineering/use-ai-with-ghidra",
      "reverse-engineering/edit-save-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "is-this-exe-safe",
    niche: "reverse-engineering",
    searchPhrases: [
      "is this exe safe",
      "analyze malware",
      "malware analysis",
      "how to analyze malware safely",
      "is .exe safe to open",
    ],
    title: "Is this EXE safe? Check a file without running it",
    description:
      "Not sure about an EXE? Stella (stella.sh) takes it apart without opening it and tells you what it would do, verdict first.",
    h1: "Is this EXE safe? Find out without running it",
    short: "Is this EXE safe?",
    lede: "Know what a suspicious file does before you open it.",
    answer:
      "Ask Stella (stella.sh) before you open it. It looks inside the EXE without running it and tells you plainly whether it's safe and what it would do.",
    gets: ["A clear verdict", "What it would do to your computer", "Any websites it would contact"],
    prompt:
      "I got this EXE by email and haven't opened it. Is it safe? Tell me what it would do.",
    demo: {
      ack: "Looking inside it now, without running it.",
      task: "Checking Invoice_2291.pdf.exe",
      rows: ["Reading the file without opening it", "Decoding its hidden messages", "Listing what it would do"],
      reply:
        "**Not safe: don't open it.** It's a Windows program dressed up as a PDF. It would show a fake “Converting… done” message and put an advert on your Desktop. Nothing in it steals or downloads anything.",
    },
    faq: [
      ["Is it risky to check?", "The file is never run, only read."],
      ["What if my antivirus says it's fine?", "Ask anyway. Stella reads what the file actually does."],
    ],
    byHand: [
      "Turn on file extensions in File Explorer: Invoice.pdf.exe is a program, not a PDF.",
      "Search the file's SHA-256 on [VirusTotal](https://www.virustotal.com/) to see what antivirus engines say about it.",
      "Detect It Easy and PEStudio show what it's made with and what it can do. Run it only in a throwaway virtual machine.",
    ],
    related: [
      "reverse-engineering/use-ai-with-ghidra",
      "reverse-engineering/extract-files-from-exe-installer",
      "reverse-engineering/decompile-exe-to-source-code",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decompile-apk",
    niche: "reverse-engineering",
    searchPhrases: [
      "decompile apk",
      "how to decompile apk",
      "reverse engineer android app",
      "decompile apk to source code",
      "decompile apk with jadx",
    ],
    title: "Decompile an APK to its source code",
    description:
      "Curious what an Android app does? Stella (stella.sh) opens the APK, shows you its code and lists what it can access and who it contacts.",
    h1: "Decompile an APK to read its code",
    short: "Decompile an APK",
    lede: "See what an Android app really does.",
    answer:
      "Give Stella (stella.sh) an APK and it shows you the app's code, what it's allowed to access and which servers it talks to.",
    gets: ["The app's code in a folder", "What it can access on your phone", "Every server it connects to"],
    prompt:
      "Open up this Android app and tell me what it can access and who it connects to.",
    demo: {
      ack: "On it. Opening the app up.",
      task: "Looking inside Currencies 1.23",
      rows: ["Turning the app back into code", "Listing what it's allowed to do", "Finding every server it contacts"],
      reply:
        "Done, without installing it. Currencies only asks for internet access. It gets exchange rates from six servers, including the European Commission and the Bank of Canada. The code is in a folder in Downloads.",
    },
    faq: [
      ["Do I need an Android phone?", "No. It all happens on your computer."],
      ["Can Stella change the app too?", "Yes. See [edit an APK](/how/reverse-engineering/edit-apk)."],
    ],
    byHand: [
      "Download jadx from [its releases](https://github.com/skylot/jadx/releases) and open the APK in jadx-gui.",
      "Open AndroidManifest.xml under Resources: each uses-permission line is something the app asks for.",
      "Search the code for http to find its servers. jadx -d out app.apk saves everything to a folder.",
    ],
    related: [
      "reverse-engineering/edit-apk",
      "reverse-engineering/inspect-app-traffic-with-mitmproxy",
      "reverse-engineering/decompile-jar-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "edit-apk",
    niche: "reverse-engineering",
    searchPhrases: ["edit apk", "apktool", "modify apk", "recompile apk", "edit apk package name"],
    title: "Edit an APK: rename it, rebuild and sign it",
    description:
      "Want to change an Android app? Stella (stella.sh) edits the APK, rebuilds it and gives you one you can install on your phone.",
    h1: "Edit an APK and rebuild it into a signed app",
    short: "Edit and rebuild an APK",
    lede: "Your own version of an Android app.",
    answer:
      "Tell Stella (stella.sh) what to change in the app, like its name, icon or text. It rebuilds the APK so you can install it.",
    gets: ["The change you asked for", "An app ready to install", "The original left as it was"],
    prompt:
      "Rename this app to “FX Watch” and give me a version I can install on my phone.",
    demo: {
      ack: "On it. Renaming the app now.",
      task: "Making FX Watch",
      rows: ["Unpacking the app", "Changing the name under the icon", "Rebuilding and signing it"],
      reply:
        "Done. **FX-Watch-1.58.apk** is in your Downloads. Uninstall the original app from your phone first, then open this one. Keep the key file beside it, since updates need it.",
      files: ["FX-Watch-1.58.apk"],
    },
    faq: [
      ["What can I change?", "The name, pictures, colours, wording and how things work. Just describe it."],
      ["How do I install it?", "Send it to your phone and open it."],
    ],
    byHand: [
      "Unpack the app with [apktool](https://apktool.org/): apktool d app.apk.",
      "For a new name, change app_name in res/values/strings.xml, then rebuild with apktool b yourfolder -o new.apk.",
      "Sign it with your own key using apksigner, and uninstall the original from your phone before installing yours.",
    ],
    related: [
      "reverse-engineering/decompile-apk",
      "reverse-engineering/decompile-jar-file",
      "reverse-engineering/inspect-app-traffic-with-mitmproxy",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decompile-jar-file",
    niche: "reverse-engineering",
    searchPhrases: [
      "decompile jar file",
      "decompile jar",
      "decompile jar to source code",
      "decompile jar file in intellij",
      "decompile jar online",
      "java decompiler",
    ],
    title: "Decompile a JAR file back to Java source that compiles",
    description:
      "Only have the JAR file? Stella (stella.sh) turns it back into Java source code that builds and works the same as the original.",
    h1: "Decompile a JAR file back to Java source code",
    short: "Decompile a JAR to Java",
    lede: "Java code back from the only file you have.",
    answer:
      "Stella (stella.sh) gets the Java source code back out of a JAR file and makes sure it builds and behaves like the original.",
    gets: ["Java code you can change", "A check that it still builds", "Everything in one folder"],
    prompt:
      "I only have the JAR of our old program. Get the Java code back so we can change it.",
    demo: {
      ack: "On it. Opening the JAR.",
      task: "Getting RouteSheet's Java back",
      rows: ["Turning the JAR back into Java", "Fixing the parts that don't build", "Comparing old and new side by side"],
      reply:
        "Done. The code is in a **source** folder next to the JAR, with the original class names. Prices sit in rates.properties, so changing one is a small edit. The rebuilt version gives the same results as the old one.",
    },
    faq: [
      ["Will it build straight away?", "Yes. Stella fixes what doesn't before handing it over."],
      ["Do I need Java installed?", "No. Stella gets what it needs."],
    ],
    byHand: [
      "Download Vineflower from [its GitHub releases](https://github.com/Vineflower/vineflower/releases) and run java -jar vineflower.jar app.jar src.",
      "To just read it in IntelliJ IDEA, add the JAR as a library and open any class.",
      "Build with a JDK of the version the JAR targets, fix what doesn't build, and compare both on the same inputs.",
    ],
    related: [
      "reverse-engineering/decompile-dotnet-dll-to-csharp",
      "reverse-engineering/decompile-apk",
      "reverse-engineering/deobfuscate-javascript",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "deobfuscate-javascript",
    niche: "reverse-engineering",
    searchPhrases: [
      "deobfuscate javascript",
      "deobfuscate javascript code",
      "deobfuscate javascript file",
      "deobfuscate javascript obfuscator io",
      "deobfuscate javascript hex",
      "javascript deobfuscator",
      "unminify js",
    ],
    title: "Deobfuscate JavaScript back to readable code that works the same",
    description:
      "Stuck with scrambled JavaScript? Stella (stella.sh) turns it into clean code you can read, and checks it still does the same thing.",
    h1: "Deobfuscate JavaScript back to readable code",
    short: "Deobfuscate JavaScript",
    lede: "Scrambled code made readable again.",
    answer:
      "Give Stella (stella.sh) the scrambled JavaScript. It gives you a clean version with sensible names that works exactly the same.",
    gets: ["Readable JavaScript", "A check that nothing changed", "Any hidden text, revealed"],
    prompt:
      "This script is scrambled. Turn it into JavaScript I can read that still works the same.",
    demo: {
      ack: "On it. Unscrambling the script.",
      task: "Making billing.js readable",
      rows: ["Undoing the scrambling", "Giving everything a real name", "Running both on the same inputs"],
      reply:
        "Done. **billing-readable.js** sits next to the original and works exactly the same. The scrambling was hiding the prices and three promo codes, which now sit as named values at the top.",
      files: ["billing-readable.js"],
    },
    faq: [
      ["How is this different from a beautifier?", "A beautifier only adds spacing. Stella brings back names and meaning."],
      ["Can it explain the code too?", "Yes. Just ask what it does."],
    ],
    byHand: [
      "Work on a copy, and save what the original prints for a few inputs.",
      "Run npx webcrack billing.js > clean.js, which undoes most obfuscator.io output. synchrony is another option.",
      "Rename what's left with Rename Symbol (F2) in VS Code, then check the output still matches.",
    ],
    related: [
      "reverse-engineering/decompile-jar-file",
      "reverse-engineering/extract-electron-asar",
      "reverse-engineering/decompile-lua",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-electron-asar",
    niche: "reverse-engineering",
    searchPhrases: [
      "extract asar",
      "extract asar file",
      "extract asar file windows",
      "asar extract command",
      "asar extract tool",
      "extract electron app",
      "modify electron app",
    ],
    title: "Extract and edit an Electron app's app.asar, then repack it",
    description:
      "Stella (stella.sh) opens an Electron app's app.asar, makes the change you want and puts it back, so the app just works your way.",
    h1: "Extract an Electron app's app.asar, edit it and repack it",
    short: "Extract and edit app.asar",
    lede: "Change a desktop app that has no setting for it.",
    answer:
      "Many desktop apps keep their code in one ASAR file. Stella (stella.sh) opens it, makes your change and packs it up again.",
    gets: ["The app working the way you want", "A backup of the original", "Everything else unchanged"],
    prompt:
      "This timer app always starts at 25 minutes. Change the app so it starts at 50.",
    demo: {
      ack: "On it. Opening the app's files.",
      task: "Changing Pomodoro Desk",
      rows: ["Unpacking app.asar", "Changing the timer and the button", "Packing it back, with a backup"],
      reply:
        "Done. Pomodoro Desk now opens at **50:00** with a **Go** button, and short breaks last 10 minutes. The original is saved beside it, so you can switch back.",
    },
    faq: [
      ["Which apps does it work on?", "Apps built with Electron, which is a lot of chat, music and notes apps."],
      ["What if the app updates?", "The update brings the old version back. Ask Stella to do it again."],
    ],
    byHand: [
      "Find resources/app.asar in the app's folder, close the app and copy the file somewhere safe.",
      "With Node.js installed, run npx @electron/asar extract app.asar app and change what you need.",
      "Pack it with npx @electron/asar pack app app.asar and put it back. If the app closes at once, restore your copy.",
    ],
    related: [
      "reverse-engineering/deobfuscate-javascript",
      "reverse-engineering/extract-files-from-exe-installer",
      "reverse-engineering/patch-exe-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decompile-lua",
    niche: "reverse-engineering",
    searchPhrases: [
      "decompile lua",
      "decompile luac",
      "decompile lua bytecode",
      "decompile lua script",
      "luac decompiler",
      "lua decompiler",
    ],
    title: "Decompile Lua bytecode (.luac) back to readable Lua",
    description:
      "Only have the compiled Lua? Stella (stella.sh) turns it back into a readable Lua script that does exactly the same.",
    h1: "Decompile Lua bytecode back to readable Lua source",
    short: "Decompile Lua bytecode",
    lede: "A luac file turned back into a Lua script you can edit.",
    answer:
      "Stella (stella.sh) turns a luac file back into a Lua script you can read and edit, and checks it does exactly the same thing.",
    gets: ["A readable Lua script", "Clear names instead of gibberish", "A check that it works the same"],
    prompt:
      "Our game server's loot rules only exist as a luac file. Turn it back into a Lua script I can edit.",
    demo: {
      ack: "On it. Reading the luac file.",
      task: "Turning loot.luac back into Lua",
      rows: ["Rebuilding the script", "Giving every value a real name", "Comparing old and new side by side"],
      reply:
        "Done. **loot.lua** is next to the original and works exactly the same. The rules: common drops 60%, legendary 1%, luck makes rare finds likelier, and prices go up 25% on Fridays and Saturdays.",
      files: ["loot.lua"],
    },
    faq: [
      ["What's a luac file?", "A Lua script that's been turned into a form only the computer reads."],
      ["Can Stella change it too?", "Yes. Say what you want different."],
    ],
    byHand: [
      "Check the version: the file starts with .Lua, and the next byte gives it (54 means Lua 5.4).",
      "Run java -jar unluac.jar loot.luac > loot.lua, with unluac from its SourceForge page.",
      "Rename the L0_1 style names by hand, and compare old and new with the matching Lua from LuaBinaries.",
    ],
    related: [
      "reverse-engineering/deobfuscate-javascript",
      "reverse-engineering/decompile-jar-file",
      "reverse-engineering/extract-pak-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "edit-save-file",
    niche: "reverse-engineering",
    searchPhrases: [
      "edit save file",
      "save game editor",
      "how to edit a save file",
      "save file checksum fix",
      "edit save file corrupted after editing",
      "hex edit save file gold",
    ],
    title: "Edit a save file: values, scrambling and the checksum",
    description:
      "Want to edit a save file? Tell Stella (stella.sh) what you want, like more gold, and it changes your save so the game still loads it.",
    h1: "How to edit a save file (and keep the game loading it)",
    short: "Edit a save file",
    lede: "Give yourself the gold, items or level you want.",
    answer:
      "Tell Stella (stella.sh) which game and what you want changed. It edits your save file, keeps a copy of the old one and makes sure the game accepts it.",
    gets: ["The gold, items or stats you asked for", "A save the game still loads", "Your old save, kept"],
    prompt:
      "Give me 50,000 gold and 25 potions in my Lantern Hollow save.",
    demo: {
      ack: "On it. Opening your Lantern Hollow save.",
      task: "Editing your save",
      rows: ["Backing up slot 1", "Finding your gold and potions", "Updating the game's tamper check"],
      reply:
        "Done. Slot 1 now has **50,000 gold** (was 1,380) and **25 potions** (was 2). The game loads it with no corrupted warning, and the rest of Mira's progress is unchanged.",
      files: ["slot1.sav.before-gold-edit.bak"],
    },
    faq: [
      ["Does it work for any game?", "It works for most games that keep saves on your computer."],
      ["Can I go back?", "Yes. Your old save is kept next to the new one."],
      ["Why does my save say corrupted after editing?", "The game checks a checksum, and the edit broke it. Stella updates the checksum along with the value, so the game accepts it."],
    ],
    byHand: [
      "Find the save, often in Documents\\My Games or %APPDATA% under the game's name, and copy it first.",
      "Save, spend some gold, save to a second slot, and compare both in a hex editor such as ImHex to find the value.",
      "If the game then calls the save corrupted, it checks a checksum: work out how it's made and update it too.",
    ],
    related: [
      "reverse-engineering/reverse-engineer-a-file-format",
      "game-mods/turn-on-cheats-in-minecraft-world",
      "game-mods/fix-corrupted-minecraft-world",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-unity-game-assets",
    niche: "reverse-engineering",
    searchPhrases: [
      "extract assets from unity game",
      "unity asset extractor",
      "extract images from unity game",
      "extract music from unity game",
      "how to extract unity assets",
      "assetstudio alternative mac",
    ],
    title: "Extract assets from a Unity game: sprites, textures and music",
    description:
      "Want the sprites or music from a Unity game? Stella (stella.sh) pulls them out into a folder of normal pictures and sounds.",
    h1: "How to extract assets from a Unity game",
    short: "Extract Unity game assets",
    lede: "The art and music out of a Unity game.",
    answer:
      "Point Stella (stella.sh) at a Unity game and it pulls out the art, music and sounds as normal files you can open.",
    gets: ["Every picture, full size", "Music and sounds you can play", "All of it sorted in one folder"],
    prompt:
      "Get all the art and music out of this game into a folder on my Desktop.",
    demo: {
      ack: "On it. Opening the game's files.",
      task: "Pulling art and music from Unguided",
      rows: ["Finding the game's data folder", "Saving every picture as PNG", "Saving music and sounds as WAV"],
      reply:
        "Done. **Unguided Assets** on your Desktop has 448 pictures, with the game's own art kept apart from stock engine images, plus 4 music tracks and 8 sound effects. Your game files weren't changed.",
    },
    faq: [
      ["How do I know if a game is Unity?", "Just ask Stella. It checks for you."],
      ["Can I get 3D models too?", "Yes. Ask for the models."],
      ["What's the best Unity asset extractor?", "AssetRipper for most people: free, and it runs on Windows, Mac and Linux. AssetStudio is quick on Windows."],
    ],
    byHand: [
      "Find the <Game>_Data folder next to the game's .exe. On a Mac it's inside the app, under Contents/Resources/Data.",
      "Open it in [AssetRipper](https://github.com/AssetRipper/AssetRipper/releases) with File → Open Folder, then export.",
      "Sounds left as .fsb files play once you convert them with vgmstream.",
    ],
    related: [
      "reverse-engineering/edit-save-file",
      "reverse-engineering/reverse-engineer-a-file-format",
      "game-mods/install-minecraft-resource-pack",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decompile-unity-game",
    niche: "reverse-engineering",
    searchPhrases: [
      "decompile unity game",
      "decompile Assembly-CSharp.dll",
      "decompile unity game for modding",
      "il2cpp dumper",
      "decompile unity game to project",
      "dnspy unity game mod",
    ],
    title: "Decompile a Unity game to C# and patch it",
    description:
      "See how a Unity game works, or change it: Stella (stella.sh) gets the C# code out and can make the change you want.",
    h1: "How to decompile a Unity game (and change how it plays)",
    short: "Decompile a Unity game",
    lede: "Read a Unity game's code, or change how it plays.",
    answer:
      "Stella (stella.sh) gets the code out of a Unity game so you can read it, and changes how it plays if you ask, like never losing health.",
    gets: ["The game's C# code in a folder", "The change you asked for", "The original kept, so you can undo it"],
    prompt:
      "Get the code out of this game so I can read it, and make it so I never lose health.",
    demo: {
      ack: "On it. Getting the code out first.",
      task: "Opening up Unguided",
      rows: ["Turning the game's code into C#", "Finding where damage is handled", "Changing it, with a backup"],
      reply:
        "Done. **Unguided Source** on your Desktop has the game's C#. Every hit now goes through a changed TakeDamage that keeps your health where it was. The original game file is backed up.",
    },
    faq: [
      ["Can I make a mod this way?", "Yes. Say what you want the mod to do."],
      ["Does it work on every Unity game?", "It works on most PC games made with Unity."],
      ["What about IL2CPP games?", "They keep no readable code file, so Il2CppDumper recovers the names instead. Stella works with both kinds."],
    ],
    byHand: [
      "Look in <Game>_Data/Managed: if Assembly-CSharp.dll is there, the code can be read back as C#.",
      "Copy that DLL somewhere safe, open it in ILSpy or dnSpyEx and search for words like health or damage.",
      "In dnSpyEx, right-click a method → Edit Method (C#), change it, Compile, then File → Save Module.",
    ],
    related: [
      "reverse-engineering/extract-unity-game-assets",
      "reverse-engineering/edit-save-file",
      "reverse-engineering/decompile-godot-game",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decompile-godot-game",
    niche: "reverse-engineering",
    searchPhrases: [
      "godot decompiler",
      "godot pck extractor",
      "decompile godot game",
      "gdre tools",
      "extract pck file godot",
      "recover godot project from exe",
    ],
    title: "Godot decompiler: turn a game back into a project",
    description:
      "Lost your Godot project, or curious how a game was made? Stella (stella.sh) turns the finished game back into a project you can open.",
    h1: "Godot decompiler: recover a project from an exported game",
    short: "Decompile a Godot game",
    lede: "A finished Godot game, back as a project.",
    answer:
      "Stella (stella.sh) works as a Godot decompiler: give it the game and it gives you back a project that opens in Godot.",
    gets: ["A project that opens in Godot", "Scripts, scenes, pictures and sounds", "The game itself left alone"],
    prompt:
      "Turn this game back into a Godot project I can open.",
    demo: {
      ack: "On it. Recovering the project.",
      task: "Turning Marble into a project",
      rows: ["Opening the game's pack file", "Recovering scripts, scenes and sounds", "Opening it in Godot 4.2.1"],
      reply:
        "Done. **Marble (Godot project)** is on your Desktop. Open it in Godot 4.2.1, the version the game was made with. The scripts came back exactly as written, comments included.",
    },
    faq: [
      ["Can I get my own lost project back?", "Yes, from the finished game."],
      ["Which Godot do I open it with?", "Stella tells you the right version."],
    ],
    byHand: [
      "Download GDRE Tools from the [gdsdecomp releases](https://github.com/GDRETools/gdsdecomp/releases).",
      "Choose RE Tools → Recover project and pick the game's .pck or .exe.",
      "Open the result with Import in the same Godot version, from the [Godot archive](https://godotengine.org/download/archive/).",
    ],
    related: [
      "reverse-engineering/decompile-unity-game",
      "reverse-engineering/extract-unity-game-assets",
      "reverse-engineering/extract-renpy-rpa",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-renpy-rpa",
    niche: "reverse-engineering",
    searchPhrases: ["rpa extractor", "renpy decompiler", "extract rpa files", "rpyc to rpy", "unrpa", "how to open rpa files"],
    title: "RPA extractor: unpack a Ren'Py game and decompile .rpyc",
    description:
      "Stella (stella.sh) opens a Ren'Py game's RPA file and gives you the pictures, the music and the story script to read.",
    h1: "RPA extractor and Ren'Py decompiler: get a game's files and script back",
    short: "Extract a Ren'Py .rpa",
    lede: "Pictures, music and script out of a Ren'Py game.",
    answer:
      "Stella (stella.sh) is an RPA extractor and Ren'Py decompiler in one: ask, and you get the game's pictures, music and readable story script in a folder.",
    gets: ["All the pictures and music", "The story script, readable", "Everything in one folder"],
    prompt:
      "Unpack this Ren'Py game and give me its pictures and the story script.",
    demo: {
      ack: "On it. Unpacking the archive.",
      task: "Unpacking The Question",
      rows: ["Opening archive.rpa", "Turning the scripts back into text", "Putting it all in one folder"],
      reply:
        "Done. **The Question - unpacked** is on your Desktop: 60 pictures, the music and 4 scripts. The story is in script.rpy, and any text editor opens it. Your game folder wasn't touched.",
    },
    faq: [
      ["What's an RPA file?", "The one big file where a Ren'Py game keeps its pictures, sounds and story."],
      ["Can I change the story?", "Yes. Tell Stella what to change."],
    ],
    byHand: [
      "Open the game's folder, then game, and find the .rpa files.",
      "With Python installed, run pip install unrpa, then unrpa -mp out game/archive.rpa.",
      "Turn the .rpyc files into readable .rpy with [unrpyc](https://github.com/CensoredUsername/unrpyc).",
    ],
    related: [
      "reverse-engineering/decompile-godot-game",
      "reverse-engineering/extract-unity-game-assets",
      "reverse-engineering/edit-save-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-pak-files",
    niche: "reverse-engineering",
    searchPhrases: [
      "extract pak files",
      "unpack pak files",
      "extract pak files unreal engine",
      "extract pak files ue5",
      "unreal pak extractor",
      "unreal pak tool",
      "open pak files",
    ],
    title: "Extract Unreal Engine .pak files and make a mod pak",
    description:
      "Want to change an Unreal game? Stella (stella.sh) opens its PAK files, makes your change and packs it as a mod you can remove anytime.",
    h1: "Extract Unreal Engine .pak files and pack a mod",
    short: "Extract .pak files and mod",
    lede: "Change something in an Unreal game.",
    answer:
      "Games made with Unreal Engine keep everything in PAK files. Stella (stella.sh) opens them, finds what to change and makes you a small mod.",
    gets: ["The change you asked for, as a mod", "The game's own files untouched", "Delete the mod to undo it"],
    prompt:
      "The lanterns in this game burn out too fast. Make a mod that makes them last twice as long.",
    demo: {
      ack: "On it. Looking inside the game's pak.",
      task: "Making a longer lanterns mod",
      rows: ["Finding the burn time setting", "Doubling it in a small mod", "Leaving the game's pak alone"],
      reply:
        "Done. **LongerLanterns_P.pak** doubles every lantern: tin goes from 3 to 6 minutes, miner's from 6 to 12. It goes in the game's Paks folder, and deleting it undoes it.",
      files: ["LongerLanterns_P.pak"],
    },
    faq: [
      ["Can I just extract the files?", "Yes. Ask for the pictures, sounds or anything else inside."],
      ["How do I install the mod?", "Stella puts it in the right folder for you."],
    ],
    byHand: [
      "Download repak from [its GitHub releases](https://github.com/trumank/repak/releases) and run repak info on the game's pak in Content\\Paks.",
      "Run repak unpack, then copy only the files you change into a new folder, keeping their path inside the pak.",
      "Pack it with repak pack --version V11 mod MyMod_P.pak and put it in Content\\Paks\\~mods.",
    ],
    related: [
      "reverse-engineering/extract-electron-asar",
      "reverse-engineering/decompile-lua",
      "reverse-engineering/edit-save-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "reverse-engineer-a-file-format",
    niche: "reverse-engineering",
    searchPhrases: [
      "reverse engineer file format",
      "open dat file",
      "reverse engineer binary file format",
      "open unknown file type",
      "convert old dat file to csv",
      "how to reverse engineer a binary file",
    ],
    title: "Reverse engineer a file format and convert it to CSV",
    description:
      "Old file that nothing can open? Stella (stella.sh) works out the file format and turns your data into a spreadsheet.",
    h1: "How to reverse engineer a file format (and get your data out)",
    short: "Reverse engineer a file format",
    lede: "Get your data out of a file nothing opens.",
    answer:
      "If a program is gone and its file won't open, give the file to Stella (stella.sh). It works out the format and gets your data out.",
    gets: ["Your data in a spreadsheet", "A converter for your other old files", "Anything odd, pointed out"],
    prompt:
      "This .dat file is from an old money program that's gone. Get my data out into a spreadsheet.",
    demo: {
      ack: "On it. Working out how the file is laid out.",
      task: "Getting your TallyHome data out",
      rows: [
        "Finding where each record starts",
        "Matching amounts, dates and payees",
        "Writing a converter for other files",
      ],
      reply:
        "Done. **household.csv** has all 223 transactions from Sep 2003 to Apr 2005, and March 2004 matches your printed register to the penny. tallyhome_to_csv.py converts any other TallyHome file.",
      files: ["household.csv", "tallyhome_to_csv.py"],
    },
    faq: [
      ["What if I don't know which program made it?", "That's fine. Stella works from the file itself."],
      ["Which files does this work on?", "Data from old money, address book, photo and business programs, and many more."],
      ["How do I open a .dat file?", ".dat only means data, so no single program opens them all. Give it to Stella and it works out what's inside."],
    ],
    byHand: [
      "Work on a copy, and gather anything showing the same data: a printout, an old export, a total you remember.",
      "Open it in [ImHex](https://imhex.werwolv.net/) and find a name you know. Amounts are often whole pennies just before it.",
      "Once one record makes sense, write a short script that reads them all and saves a CSV.",
    ],
    related: ["reverse-engineering/edit-save-file", "pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/fix-dates-in-excel"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "reverse-engineer-website-api",
    niche: "reverse-engineering",
    searchPhrases: [
      "reverse engineer website api",
      "find hidden api",
      "reverse engineer api calls",
      "claude reverse engineer api",
      "scrape data from website api instead of html",
      "find api endpoint of a website",
    ],
    title: "Reverse engineer a website's API and export its data",
    description:
      "A website with no export button? Stella (stella.sh) finds where the page gets its data and saves it all in a spreadsheet.",
    h1: "How to reverse engineer a website API (and download the data)",
    short: "Reverse engineer a website API",
    lede: "Get all the data off a page with no export button.",
    answer:
      "Stella (stella.sh) finds the hidden API a website uses and downloads everything into a spreadsheet, with a script to do it again whenever you like.",
    gets: ["Everything in a spreadsheet", "A script to run it again", "No copying by hand"],
    prompt:
      "This price list has no export button. Get every product into a spreadsheet, and let me do it again next month.",
    demo: {
      ack: "On it. Watching how the page gets its data.",
      task: "Exporting the price list",
      rows: ["Finding the page's hidden API", "Following every page of products", "Saving a script for next time"],
      reply:
        "Done. **products-2026-11-23.csv** has all 137 products with name, category, price and stock. Run export_products.py next month for a fresh copy.",
      files: ["products-2026-11-23.csv", "export_products.py"],
    },
    faq: [
      ["Can Stella run it every week?", "Yes. Ask for it every week and it does."],
      ["Does it work if I have to log in?", "Yes, Stella can use your browser where you're already signed in."],
    ],
    byHand: [
      "Open the page, press F12, go to the Network tab, filter to Fetch/XHR and reload.",
      "Right-click the request that holds the data → Copy → Copy as cURL, and check it works on its own.",
      "Find where any token comes from, follow the next-page value to the end, and save it all with a short script.",
    ],
    related: [
      "reverse-engineering/reverse-engineer-a-file-format",
      "reverse-engineering/edit-save-file",
      "pdf-excel/bank-statement-pdf-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "inspect-app-traffic-with-mitmproxy",
    niche: "reverse-engineering",
    searchPhrases: [
      "mitmproxy",
      "intercept https traffic",
      "see what an app sends",
      "mitmproxy install",
      "mitmproxy certificate",
      "mitmproxy python",
    ],
    title: "mitmproxy: see exactly what an app sends over HTTPS",
    description:
      "What does that app send home? Stella (stella.sh) uses mitmproxy to watch it and tells you everything it sent, in plain words.",
    h1: "mitmproxy: intercept an app's HTTPS traffic and read every request",
    short: "See what an app sends with mitmproxy",
    lede: "Find out what an app sends about you.",
    answer:
      "Stella (stella.sh) sets up mitmproxy, watches one app while it runs and tells you what it sends over the internet and to whom.",
    gets: ["Everything the app sent, in plain words", "Who it sent it to", "Anything that stands out"],
    prompt:
      "Tell me what this notes app sends over the internet when it syncs.",
    demo: {
      ack: "On it. Setting up mitmproxy.",
      task: "Watching Pocketnote sync",
      rows: ["Setting up mitmproxy for one app", "Recording one sync", "Reading each request in plain words"],
      reply:
        "Pocketnote sent 6 requests in one sync:\n- The full text of all your notes\n- Your login and device name\n- An advertising ID\n- Usage data",
    },
    faq: [
      ["What is mitmproxy?", "A free tool that lets you see what an app sends. Stella sets it up for you."],
      ["Does it change my computer?", "It's set up just for that one app."],
      ["How do I install the mitmproxy certificate?", "With mitmproxy running, browse to mitm.it and follow the steps for your system. For one app, Stella points just that app at it."],
    ],
    byHand: [
      "Install mitmproxy from [mitmproxy.org](https://mitmproxy.org/downloads/) and run mitmdump once to create its certificate.",
      "Record with mitmdump -w capture.flows while the app runs through it, or use mitmproxy --mode local:appname.",
      "Open it with mitmproxy -r capture.flows and go request by request: where it went and what it sent.",
    ],
    related: [
      "reverse-engineering/reverse-engineer-website-api",
      "reverse-engineering/reverse-engineer-a-file-format",
      "reverse-engineering/edit-save-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "decode-network-protocol-from-pcap",
    niche: "reverse-engineering",
    searchPhrases: [
      "reverse engineer protocol",
      "wireshark decode",
      "reverse engineer smart device protocol",
      "how to reverse engineer a network protocol",
      "pcap to python",
      "control smart bulb without app",
    ],
    title: "Reverse engineer a device protocol from a pcap capture",
    description:
      "Want to control a smart gadget without its app? Stella (stella.sh) works out how the app talks to it and gives you your own controls.",
    h1: "How to reverse engineer a device's protocol from a capture",
    short: "Decode a protocol from a pcap",
    lede: "Control a gadget without its app.",
    answer:
      "Give Stella (stella.sh) a recording of the app talking to your gadget. It reverse engineers the protocol and makes you a controller.",
    gets: ["Your own controls for the gadget", "How it works, in plain words", "It tried out on your device"],
    prompt:
      "Here's a recording of my lamp's app talking to the lamp. Make me something that controls it, and set it to orange.",
    demo: {
      ack: "On it. Reading the recording.",
      task: "Working out how the lamp talks",
      rows: ["Lining up each message with an action", "Working out the key it uses", "Writing a small controller"],
      reply:
        "Done. The lamp is on, at **40% brightness** in **orange**. From now on lumio.py switches it on and off, changes the brightness and sets any colour.",
      files: ["lumio.py"],
    },
    faq: [
      ["What's a pcap?", "A recording of what goes over your network. Stella can make one for you."],
      ["Which gadgets does it work with?", "Lamps, plugs, speakers and most gadgets on your Wi-Fi."],
    ],
    byHand: [
      "Record with [Wireshark](https://www.wireshark.org/) while you use the app, and note the time of each action.",
      "Filter to the gadget's address, right-click → Follow → TCP Stream, and line up each message with your notes.",
      "Work out which parts repeat and which change, then write a short Python script that sends the same messages.",
    ],
    related: [
      "reverse-engineering/inspect-app-traffic-with-mitmproxy",
      "reverse-engineering/reverse-engineer-website-api",
      "reverse-engineering/reverse-engineer-a-file-format",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-firmware",
    niche: "reverse-engineering",
    searchPhrases: [
      "extract firmware",
      "extract firmware bin file",
      "reverse engineer router firmware",
      "reverse engineer firmware",
      "binwalk",
      "binwalk windows",
      "binwalk extract",
    ],
    title: "Extract a router firmware .bin and see what's inside",
    description:
      "Curious what's inside your router? Stella (stella.sh) unpacks the firmware file and tells you what it runs and what stands out.",
    h1: "Extract router firmware and see what's inside",
    short: "Extract router firmware",
    lede: "See what your router is really running.",
    answer:
      "Give Stella (stella.sh) the firmware file and it unpacks everything inside, then tells you in plain words what's running and what to look at.",
    gets: ["All the files inside, in a folder", "A short report in plain words", "Anything worth fixing"],
    prompt:
      "Unpack this router firmware and tell me what's inside and if anything looks off.",
    demo: {
      ack: "On it. Unpacking the firmware.",
      task: "Looking inside OpenWrt 25.12.6",
      rows: ["Unpacking the firmware file", "Reading versions and startup services", "Writing a short report"],
      reply:
        "It's the genuine, unchanged OpenWrt 25.12.6 for your Archer C6. It runs Linux 6.12 with 24 standard services. One thing to fix: the main account has no password until you set one.",
      files: ["firmware-report.html"],
    },
    faq: [
      ["Where do I get my router's firmware?", "From the maker's website. Stella can find it for you."],
      ["Does it work for cameras and other gadgets?", "Yes, if you have the firmware file."],
    ],
    byHand: [
      "Run binwalk firmware.bin to list the parts inside, then binwalk -e firmware.bin to unpack them.",
      "In the unpacked files, etc/openwrt_release names the release and etc/rc.d lists what starts at boot.",
      "etc/passwd lists the accounts. Note where each finding came from, to check again after an update.",
    ],
    related: [
      "reverse-engineering/extract-files-from-exe-installer",
      "reverse-engineering/decompile-exe-to-source-code",
      "reverse-engineering/patch-exe-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-files-from-exe-installer",
    niche: "reverse-engineering",
    searchPhrases: [
      "extract files from exe",
      "extract files from exe installer",
      "extract msi",
      "extract msi without installing",
      "innoextract",
      "inno setup unpacker",
      "unpack installer",
    ],
    title: "Extract files from an EXE or MSI installer without installing it",
    description:
      "Stella (stella.sh) opens EXE and MSI installers and gives you the program inside, without installing anything on your PC.",
    h1: "Extract files from an EXE or MSI installer without installing",
    short: "Extract files from an installer",
    lede: "Get a program out of its installer without installing it.",
    answer:
      "Stella (stella.sh) extracts the files from an EXE or MSI installer into a folder, so you can use or look at them without installing.",
    gets: ["The program in its own folder", "Nothing installed", "Any number of installers at once"],
    prompt:
      "Get the program files out of these three installers without installing anything.",
    demo: {
      ack: "On it. Unpacking all three.",
      task: "Unpacking three installers",
      rows: ["Working out each installer's type", "Unpacking each into its own folder", "Checking nothing got installed"],
      reply:
        "Done. KeePass 2.62, Notepad++ 8.9.9.1 and PuTTY 0.85 are each in their own folder in Downloads. Nothing was installed, and the installers are unchanged.",
    },
    faq: [
      ["Why would I want that?", "To use a program without setup, or grab one file from it."],
      ["Will the program run?", "Often, yes. Stella tells you if something is missing."],
      ["Why does innoextract say the version is not supported?", "innoextract reads Inno Setup only up to 6.0.5. Newer installers open with innounp, or just ask Stella."],
    ],
    byHand: [
      "Open the setup file in [7-Zip](https://www.7-zip.org/): many installers open like a zip.",
      "For Inno Setup installers use innounp. For an MSI, run msiexec /a file.msi /qb TARGETDIR=C:\\Out.",
      "If you find one big .msi or .cab inside, unpack that the same way.",
    ],
    related: [
      "reverse-engineering/extract-electron-asar",
      "reverse-engineering/decompile-exe-to-source-code",
      "reverse-engineering/decompile-python-exe",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
];
