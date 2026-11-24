import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const REVERSE_ENGINEERING_PAGES: ProblemPage[] = [
  {
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
      "Turn a Windows .exe with no source back into readable, buildable C using Ghidra and an AI cleanup, or let Stella (stella.sh) decompile and test it for you.",
    h1: "Decompile an EXE back to source code",
    short: "Decompile an EXE to source",
    lede: "A Windows program with no source, turned back into C you can read and rebuild.",
    answer:
      "Open the .exe in Ghidra, the NSA's free reverse-engineering tool, let it analyze the file, and read its decompiler output; an AI such as Claude then rewrites that into clean code. You get equivalent, readable C with reconstructed names and comments, which you build and run beside the original to confirm it behaves the same. Stella (stella.sh) does the job end to end on your computer: in the recorded run it worked from the program's disassembly, wrote the C, and tested it against the original under Wine.",
    stellaSteps: [
      "Disassembles the .exe (here with objdump, which comes with the Mac's developer tools) and reads every function",
      "Rewrites the machine code as clean C, with real names, structs and comments, from what the code actually does",
      "Builds the C back into a Windows program and runs both under Wine on thousands of inputs until the output, errors and exit codes match",
      "Hands you a single .c file you can build, plus a short note on what the program does and the quirks it kept",
    ],
    prompt:
      "I lost the source code for parcelquote.exe in my Documents/Fernhollow folder. Turn it back into readable C I can build, test it, and give me the file. Keep your reply short, with a few lines on what the program does.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 14 minutes Stella disassembled parcelquote.exe and rebuilt it as 441 lines of readable, commented C across 25 functions, then built Windows versions of that C and ran them beside the original under Wine: identical in all 2,852 of its own test runs. Checked afterwards: the recovered C, compiled with the system compiler, matched the original's output, error messages and exit codes on all 3,000 test command lines, covering valid quotes, edge cases and bad input.",
      note: "The test program is our own parcel-rate calculator, compiled to a stripped 64-bit Windows exe with no third-party code. The long wait is sped up 60×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-exe-to-source-code/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-exe-to-source-code"),
        poster: `${PROOFS}/reverse-engineering/decompile-exe-to-source-code/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 39.7,
        realDuration: 857,
        speed: 60,
      },
      moments: [
        { at: 0, text: "On the Mac: parcelquote.exe sits in Documents/Fernhollow with no source code." },
        { at: 4.03, text: "The prompt: turn parcelquote.exe back into readable C I can build, and say what it does." },
        { at: 10.03, text: "Stella replies that it's recovering the C source and will send the file with test results." },
        { at: 21.7, text: "It disassembles the exe, rewrites it as C, and builds and tests it under Wine against the original: about fourteen minutes, sped up here." },
        { at: 28.8, text: "Done: readable, commented C in the folder, Windows builds that matched the original on every test run, and a plain rundown of what the program does." },
      ],
    },
    manualTitle: "Do it yourself",
    manualSteps: [
      {
        title: "Install Ghidra and Java",
        body: "Ghidra is free, from the NSA. Download the release zip from [its GitHub releases](https://github.com/NationalSecurityAgency/ghidra/releases) and unzip it anywhere. Ghidra 12.2 runs on 64-bit JDK 25, free from [Adoptium](https://adoptium.net/). Start it with `ghidraRun.bat` on Windows or `./ghidraRun` on Mac and Linux.",
      },
      {
        title: "Import the exe and analyze it",
        body: "File > New Project, then File > Import File and pick your .exe. Double-click the imported file to open the CodeBrowser; when it offers to analyze, click Yes and accept the defaults. Analysis finds the functions, strings and cross-references and builds the decompiler's view, in a minute or two for a small program.",
      },
      {
        title: "Read the decompiled C",
        body: "Open Window > Decompile. Click a function in the Symbol Tree or Listing and its C-like code appears. Start at `main` or `entry` and follow the calls. As you work out what something is, rename it (press L on a function or variable) and fix its type; the decompiler re-renders straight away, so the code reads better as you go.",
      },
      {
        title: "Export it as C",
        body: "File > Export Program, choose the C/C++ format, and Ghidra writes a .c and .h covering every function and data type. The generated file usually needs its includes and Ghidra's own types tidied before it compiles. For buildable output one function at a time, use the community Function C/C++ Exporter, or [ghidrecomp](https://pypi.org/project/ghidrecomp/) to write every function to its own file.",
      },
      {
        title: "Clean it up, then prove it still behaves",
        body: "Ghidra's output is correct but raw: `FUN_00401000`, `DAT_` globals, casts everywhere. Rename things to what they do, swap the auto types for real structs and add comments, or paste a function into Claude or ChatGPT and ask for a readable rewrite. Then compile it (MSVC in Visual Studio, or MinGW or `zig cc` for a Windows target) and run it next to the original on the same inputs: matching output means you kept the behaviour.",
      },
      {
        title: "Or get rough C in one shot with RetDec",
        body: "For a quick first look, [RetDec](https://github.com/avast/retdec) (free, from Avast) decompiles straight to C: run `retdec-decompiler your.exe` and it writes `your.exe.c`. Its output is rougher than Ghidra's on larger programs and usually needs fixing before it compiles, and it shows the shape of the logic in one command.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can you really decompile an exe back to source code?",
        a: "You recover equivalent C that compiles to the same behaviour, with reconstructed names and comments. The author's original names, comments and file layout aren't stored in the exe, so those are new; the logic is faithful. For native Windows programs, Ghidra is the usual tool for the job.",
      },
      {
        q: "What is an 'AI decompiler'?",
        a: "Two steps working together. A decompiler like Ghidra turns machine code into rough, correct C full of auto-generated names, and an AI model rewrites that into clean, named, commented code a person can read. A strong model can also work from plain disassembly: in the recorded run Stella read objdump's output, wrote the C, and compiled it to check it matched the original.",
      },
      {
        q: "Is Ghidra or IDA Pro better for decompiling?",
        a: "Ghidra is free and its decompiler is very good, which is why most people start there. IDA Pro's Hex-Rays decompilers come with the paid editions, and IDA Free includes a cloud-based decompiler for x86 and x64 programs. For recovering C from a normal Windows exe at no cost, Ghidra covers it.",
      },
      {
        q: "Will the recovered code compile straight away?",
        a: "Expect small fixes first: Ghidra's exported C needs its types and includes tidied before it builds. The test that counts is behaviour: compile it and run it beside the original on the same inputs. When every output, error and exit code matches, the logic is right, and that comparison is what Stella runs for you.",
      },
      {
        q: "Does this work on .NET or Python exes?",
        a: "Those take different tools, because they aren't native machine code. ILSpy decompiles a .NET exe (C# or VB) back to near-original source, and a PyInstaller exe needs an extractor plus a Python bytecode decompiler. Ghidra and RetDec are for native C and C++ programs, so check what kind of exe you have first.",
      },
    ],
    related: ["reverse-engineering/use-ai-with-ghidra", "reverse-engineering/decompile-dotnet-dll-to-csharp", "reverse-engineering/decompile-python-exe", "reverse-engineering/patch-exe-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Ghidra releases (NSA)", href: "https://github.com/NationalSecurityAgency/ghidra/releases" },
      { label: "Ghidra exporter help (C/C++)", href: "https://ghidradocs.com/12.0.1_PUBLIC/help/Base/help/topics/ExporterPlugin/exporter.htm" },
      { label: "Adoptium (free JDK)", href: "https://adoptium.net/" },
      { label: "ghidrecomp (decompile every function)", href: "https://pypi.org/project/ghidrecomp/" },
      { label: "RetDec decompiler (Avast)", href: "https://github.com/avast/retdec" },
      { label: "IDA Free (Hex-Rays)", href: "https://hex-rays.com/ida-free" },
    ],
  },
  {
    slug: "use-ai-with-ghidra",
    niche: "reverse-engineering",
    searchPhrases: [
      "ghidra mcp",
      "ai reverse engineering",
      "ghidra ai",
      "best ai for reverse engineering",
      "ghidra tutorial",
      "ida pro mcp",
    ],
    title: "Ghidra MCP and AI: name a binary's functions",
    description:
      "Connect an AI to Ghidra with a Ghidra MCP bridge to name and comment functions in a program, or let Stella (stella.sh) load it into Ghidra and do it for you.",
    h1: "Use AI with Ghidra to name a binary's functions",
    short: "Use AI with Ghidra",
    lede: "A stripped program read in Ghidra, its functions named and commented, saved as a project.",
    answer:
      "Install a Ghidra MCP bridge such as GhidrAssistMCP or LaurieWired's GhidraMCP, enable it in Ghidra, and add it as an MCP server in Claude or another AI app. The model can then list and decompile functions, rename them and write comments inside your Ghidra project, using Ghidra, the NSA's free disassembler and decompiler. Stella (stella.sh) does the job with no bridge to set up: in the recorded run it installed Ghidra, scripted it directly, named and commented every function, and saved a project you can open.",
    stellaSteps: [
      "Installs Ghidra and a matching Java, loads your program, and runs Ghidra's auto-analysis",
      "Decompiles each function and works out what it is (a checksum, a decryptor, a date routine) from the code itself",
      "Renames every function and writes a comment explaining it, straight into the Ghidra database",
      "Saves a Ghidra project in your folder, so you open it to named, commented code instead of FUN_00101fe0 everywhere",
    ],
    prompt:
      "Use Ghidra on the frostlog program in Documents/Frost logger. Name and comment all of its functions, and save it as a Ghidra project in that folder I can open. Keep your reply short: what the program does and the main functions.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In under six minutes Stella installed Ghidra 12.2, loaded the stripped frostlog binary, and named and commented all 23 of its functions, including the CRC and Adler checksums, the XTEA decryption, the thermistor maths and the delta decoder. Checked afterwards: the saved project, reopened in a separate Ghidra 12.2, has a correct, descriptive name and a comment on every one of the 23 functions, matched against the original source by address.",
      note: "The test program is our own greenhouse temperature-logger reader with no third-party code, compiled to a stripped 64-bit Linux binary. The wait while Ghidra downloads and analyzes is sped up 60×.",
      video: {
        src: `${PROOFS}/reverse-engineering/use-ai-with-ghidra/proof.mp4`,
        cuts: webCuts("reverse-engineering/use-ai-with-ghidra"),
        poster: `${PROOFS}/reverse-engineering/use-ai-with-ghidra/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.67,
        realDuration: 355,
        speed: 60,
      },
      moments: [
        { at: 0, text: "On the Mac: the stripped frostlog program in Documents/Frost logger, no symbols." },
        { at: 4.03, text: "The prompt: open it in Ghidra, name and comment every function, and save a project I can open." },
        { at: 10.03, text: "Stella says it has started on frostlog in Ghidra." },
        { at: 17.1, text: "Installing Ghidra and Java, analyzing the binary, then naming and commenting each function: about five minutes, sped up 60×." },
        { at: 19.93, text: "Done: what the program does, its main functions by their new names, the saved project, and two findings (a weak key and a possible bug)." },
      ],
    },
    manualTitle: "Do it yourself",
    manualSteps: [
      {
        title: "Get Ghidra running on your binary",
        body: "Download Ghidra from [its GitHub releases](https://github.com/NationalSecurityAgency/ghidra/releases) and unzip it; Ghidra 12.2 runs on 64-bit JDK 25 from [Adoptium](https://adoptium.net/). Launch `ghidraRun`, make a project, and use File > Import File on your program. Double-click it and let auto-analysis finish: that's what finds the functions, strings and references.",
      },
      {
        title: "Add a Ghidra MCP bridge",
        body: "Bridges are built for specific Ghidra versions, so match yours. [GhidrAssistMCP](https://github.com/symgraph/GhidrAssistMCP) 3.1.0 has builds for Ghidra 12.0, 12.1 and 12.2; LaurieWired's [GhidraMCP](https://github.com/LaurieWired/GhidraMCP) 2.0 is built for Ghidra 12.1.4. Download the release zip, then in Ghidra choose File > Install Extensions, add the zip and restart. If the plugin doesn't show, enable it under File > Configure in the CodeBrowser.",
      },
      {
        title: "Point your AI app at the bridge",
        body: "GhidrAssistMCP runs an MCP server inside Ghidra (port 8080 by default, settings under Window > GhidrAssistMCP), and GhidraMCP connects through its `ghidra-mcp` command; each README gives the exact config. Add the server in Claude Desktop, Claude Code, Cline or Cursor, then ask the model to list the functions, decompile one, rename it and comment it. IDA Pro users get the same with [ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp).",
      },
      {
        title: "Or annotate by hand in the Decompiler",
        body: "Open Window > Decompile, click a function, and read the C-like code. Press L to rename a function or variable, and right-click > Comments to add a comment. Work outward from `main` or `entry`. When a function is cryptic, paste it into Claude or ChatGPT, ask what it does, then write the name and comment yourself; the decompiler updates as you go.",
      },
      {
        title: "Save the project",
        body: "Use File > Save in the CodeBrowser, or close it and let Ghidra save for you. Everything you named and commented lives in the project (a `.gpr` file plus a `.rep` folder), not in the binary, so the program file stays as it was. Reopen the project from the Ghidra project window and your analysis is all there.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is Ghidra MCP?",
        a: "A small server that connects an AI model to a running Ghidra over the Model Context Protocol. The model gets tools to list and decompile functions, rename them, set comments and read data, so it analyzes the binary inside your project while you ask questions. GhidrAssistMCP and GhidraMCP are two free, widely used bridges.",
      },
      {
        q: "Is there an IDA Pro MCP as well?",
        a: "Yes: ida-pro-mcp connects a model to IDA Pro the same way, which suits anyone who already owns IDA with the Hex-Rays decompiler. For a free setup that does the same job, Ghidra plus a Ghidra MCP bridge is the usual choice.",
      },
      {
        q: "Which AI is best for reverse engineering?",
        a: "Any strong coding model reasons well about decompiled code; the bigger gain is connecting it to Ghidra so it renames, comments and navigates itself while you guide it. The recorded run uses Claude, scripting Ghidra directly.",
      },
      {
        q: "Does naming functions change the program?",
        a: "Names and comments live in Ghidra's own database, so the program file stays byte-for-byte the same. You're recording your understanding of the binary, which is why you save a project rather than a new executable.",
      },
      {
        q: "Can it really name every function?",
        a: "On a small program, yes: in the recorded run it named and commented all 23 of the program's own functions. On a large binary, point it at the functions you care about first, then let it label the routine ones and review what it wrote.",
      },
    ],
    related: ["reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/is-this-exe-safe", "reverse-engineering/patch-exe-file", "reverse-engineering/extract-firmware"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Ghidra releases (NSA)", href: "https://github.com/NationalSecurityAgency/ghidra/releases" },
      { label: "GhidrAssistMCP", href: "https://github.com/symgraph/GhidrAssistMCP" },
      { label: "GhidraMCP (LaurieWired)", href: "https://github.com/LaurieWired/GhidraMCP" },
      { label: "ida-pro-mcp", href: "https://github.com/mrexodia/ida-pro-mcp" },
      { label: "Adoptium (free JDK)", href: "https://adoptium.net/" },
    ],
  },
  {
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
      "Turn a .NET DLL or EXE back into a C# project that builds, with the free ILSpy decompiler, or let Stella (stella.sh) decompile, rebuild and compare it for you.",
    h1: "Decompile a DLL back to C# source code",
    short: "Decompile a .NET DLL to C#",
    lede: "A lost program's DLL back as a Visual Studio project that builds and runs the same.",
    answer:
      "If the DLL was built with C# or another .NET language, the free ILSpy decompiler turns it back into readable C#: open it and use File › Save Code to write a .csproj project, or run `ilspycmd -p -o <folder> <file>.dll`. Comments and local variable names don't come back; class names, method names and embedded resources do. Stella (stella.sh) installs the decompiler, writes the project, builds it and checks the rebuilt DLL gives the same results as the original.",
    stellaSteps: [
      "Reads the program folder and fingerprints the original files, to prove later they weren't changed",
      "Installs ILSpy's command-line decompiler (ilspycmd) in a scratch folder, using the .NET SDK on the computer",
      "Decompiles ShiftPay.Core.dll to a C# project, embedded pay rates included, plus the small ShiftPay.exe launcher",
      "Puts both in one Visual Studio solution next to the original folder and tidies the clumsiest decompiled code",
      "Builds it, swaps the rebuilt DLL in beside the original program and compares the reports byte for byte on your data and on edge cases",
    ],
    prompt:
      "I lost the source code for our ShiftPay program (it's in Documents\\ShiftPay). Get the C# code back out of ShiftPay.Core.dll as a project I can open and build in Visual Studio, and tell me where you put it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 3 minutes Stella decompiled ShiftPay.Core.dll with ILSpy into a Visual Studio solution next to the original folder, with the pay rates recovered from inside the DLL. Checked afterwards by us: the project builds, and its rebuilt DLL dropped next to the original ShiftPay.exe printed identical reports, error messages and exit codes on 8 test files it had never seen, covering overtime, Sundays, night shifts, rounding and bad rows. The original files were unchanged.",
      note: "ShiftPay is a small .NET 8 payroll program written for this test, with invented names; the test PC already had the .NET SDK. The wait is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-dotnet-dll-to-csharp/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-dotnet-dll-to-csharp"),
        poster: `${PROOFS}/reverse-engineering/decompile-dotnet-dll-to-csharp/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 32.07,
        realDuration: 201,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Documents\\ShiftPay holds ShiftPay.exe and ShiftPay.Core.dll, and no source code." },
        { at: 4, text: "The prompt: get the C# code back out of ShiftPay.Core.dll as a project that builds in Visual Studio." },
        { at: 10.7, text: "Stella starts a task to decompile the DLL into a new folder and check it builds, leaving the originals alone." },
        { at: 15.4, text: "Installing ilspycmd, decompiling, building and comparing the rebuilt program with the original, sped up 30×." },
        { at: 20.2, text: "Done: ShiftPay.sln in ShiftPay-RecoveredSource builds with no errors, and the reports match the original to the cent." },
        { at: 25, text: "It also points out that the program pays all of a week's hours at the rate of the last shift's role." },
      ],
    },
    manualTitle: "Decompile it yourself",
    manualSteps: [
      {
        title: "Check it's a .NET file",
        body: "Only DLLs and EXEs built with C#, VB.NET or F# decompile back to C#. Open the file in ILSpy: a .NET assembly shows its namespaces and classes, anything else won't load. For a .NET 5+ program the code usually sits in the `.dll` named like the `.exe`. Native C or C++ files need a disassembler such as Ghidra instead.",
      },
      {
        title: "Install ILSpy",
        body: "On Windows, download `ILSpy_windows_…-x64.zip` (or the `.msi` installer) from the ILSpy releases page on GitHub, unzip it and run `ILSpy.exe`. It runs on the .NET 10 runtime; the `selfcontained` zip brings its own. There are Mac (Apple Silicon) and Linux builds on the same page. dnSpyEx and JetBrains dotPeek are free alternatives on Windows.",
      },
      {
        title: "Save the code as a project",
        body: "Use File › Open to load the DLL, select it in the tree on the left, then File › Save Code… and choose a folder. ILSpy writes a `.csproj` with one `.cs` file per class, plus any embedded resources (settings, JSON, images) the code reads at run time. In dotPeek the same command is Export to Project in the assembly's right-click menu.",
      },
      {
        title: "Or use the command line",
        body: "With the .NET 10 SDK installed, run `dotnet tool install --global ilspycmd`, then `ilspycmd -p -o C:\\decompiled ShiftPay.Core.dll`. `-p` makes a buildable project and `-o` sets the output folder. It works the same on Windows, Mac and Linux.",
      },
      {
        title: "Build it and compare",
        body: "Open the `.csproj` in Visual Studio, or run `dotnet build` in its folder. Then copy the program folder, put the rebuilt DLL in place of the old one and run both on the same input: identical output is the proof nothing was lost. If the build fails, it's usually a missing reference to another DLL from the program folder: add it as a reference.",
      },
      {
        title: "Tidy what the decompiler guessed",
        body: "Local variables come back as `num`, `text` and so on, and comments are gone. For a quick look without saving anything, Visual Studio's Go To Definition shows decompiled code once you tick Enable navigation to decompiled sources under Tools › Options › Text Editor › C# › Advanced.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can you decompile a DLL?",
        a: "A .NET DLL, yes, and close to the original: classes, methods, logic and embedded files come back, which is why tools like ILSpy can write a project that builds. A native DLL written in C or C++ only goes back to assembly or rough C pseudo-code with tools like Ghidra.",
      },
      {
        q: "Can I decompile a DLL in Visual Studio?",
        a: "For reading, yes: turn on Enable navigation to decompiled sources (Tools › Options › Text Editor › C# › Advanced) and press F12 on a type from the DLL. It uses ILSpy's engine. To get a whole project you can edit and build, save it from ILSpy or ilspycmd.",
      },
      {
        q: "Is there a way to decompile a DLL online?",
        a: "A few websites run a decompiler on an uploaded file and return single files. ILSpy is free, works offline and writes a whole project, so it's the shorter route.",
      },
      {
        q: "Will I get the original comments and variable names back?",
        a: "No. Comments and local variable names aren't stored in the compiled DLL. Class, method, property and field names are, unless the DLL was obfuscated.",
      },
      {
        q: "Does the same work for a C# EXE?",
        a: "Yes. A .NET Framework EXE opens directly in ILSpy. A .NET 5+ program usually keeps its code in a DLL next to the EXE, so decompile that one. A single-file app packs everything into one large EXE; ILSpy opens it and lists the DLLs bundled inside.",
      },
    ],
    related: ["reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/decompile-unity-game", "reverse-engineering/decompile-python-exe", "reverse-engineering/decompile-jar-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "ILSpy on GitHub", href: "https://github.com/icsharpcode/ILSpy" },
      { label: "ILSpy 11.2 release and downloads", href: "https://github.com/icsharpcode/ILSpy/releases/tag/v11.2" },
      { label: "ilspycmd command-line tool", href: "https://github.com/icsharpcode/ILSpy/blob/master/ICSharpCode.ILSpyCmd/README.md" },
      { label: "Visual Studio: view decompiled source definitions", href: "https://learn.microsoft.com/en-us/visualstudio/ide/go-to-and-peek-definition" },
      { label: "dotPeek: Export to Project", href: "https://www.jetbrains.com/help/decompiler/Exporting_Assembly_to_Project.html" },
      { label: "dnSpyEx releases", href: "https://github.com/dnSpyEx/dnSpy/releases" },
      { label: "Microsoft: single-file apps (inspecting with ILSpy)", href: "https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview" },
    ],
  },
  {
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
      "Get the .py files back out of a PyInstaller EXE with pyinstxtractor and a .pyc decompiler, or let Stella (stella.sh) rebuild the source and prove it matches.",
    h1: "Decompile a Python EXE back to .py source",
    short: "Decompile a Python EXE",
    lede: "A PyInstaller program's lost Python code back as .py files that run the same.",
    answer:
      "Most Python EXEs are PyInstaller bundles. Run pyinstxtractor on the EXE with the same Python version it was built with, and it unpacks the compiled .pyc files. Then decompile those: PyLingual (pylingual.io) or pycdc for recent Pythons, decompyle3 for 3.7–3.8. Function names, strings and logic come back; comments don't. Stella (stella.sh) extracts the files, rebuilds the source, checks it compiles to the same bytecode as the EXE and runs both side by side.",
    stellaSteps: [
      "Finds RentSplit.exe, fingerprints it and spots a PyInstaller bundle built with Python 3.12",
      "Downloads pyinstxtractor and unpacks the EXE with Python 3.12, bundled rules.json included",
      "Disassembles every module with Python's own dis and writes the five .py files back from it",
      "Compiles the new source with Python 3.12 and compares it with the original bytecode until every module is identical",
      "Runs the .py and the EXE side by side on 42 inputs, your own CSVs included, and saves the source next to the EXE",
    ],
    prompt:
      "I made a little program called RentSplit.exe a few years ago (it's in my Downloads folder) but I've lost the Python code. Get the .py source back so I can edit it, check it gives the same results as the exe, and tell me where you put it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 8½ minutes Stella unpacked RentSplit.exe with pyinstxtractor, wrote its five Python files back from the bytecode and saved them in Downloads\\RentSplit-source; it reported that they compile to code identical to what's inside the EXE. Checked afterwards by us: the recovered source, run with Python 3.12 on 12 test cases it had never seen (rounding modes, odd pennies, bad dates, missing data), printed exactly the same output, errors and exit codes as the EXE, and all 11 function and class names are back. The EXE and its CSV files were unchanged.",
      note: "RentSplit is a small Python 3.12 program written for this test, with invented housemates, built with PyInstaller 6.22; the test PC already had Python 3.12. The wait is sped up 60×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-python-exe/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-python-exe"),
        poster: `${PROOFS}/reverse-engineering/decompile-python-exe/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 34.1,
        realDuration: 514,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Downloads\\RentSplit holds RentSplit.exe and its CSV files, and no Python code." },
        { at: 5, text: "The prompt: get the .py source back, check it gives the same results as the EXE, say where it is." },
        { at: 11, text: "Stella starts a task to extract the code, compare it with the EXE and save it next to it." },
        { at: 15.5, text: "Unpacking with pyinstxtractor, rebuilding the source from the disassembly and comparing, sped up 60×." },
        { at: 23, text: "Done: the source is in Downloads\\RentSplit-source and compiles to the same code as the EXE." },
        { at: 28, text: "It ran both on 42 inputs and lists four bad inputs that crash the original too, ready to fix now." },
      ],
    },
    manualTitle: "Decompile it yourself",
    manualSteps: [
      {
        title: "Check how it was packed",
        body: "Search the EXE for text: `findstr /m PyInstaller RentSplit.exe` in a Command Prompt (or `strings` on Mac and Linux) finds a PyInstaller bundle, and a name like `python312.dll` inside it gives the Python version. py2exe and cx_Freeze bundles also hold .pyc files. A Nuitka EXE is compiled to C, so there's no Python bytecode to get back.",
      },
      {
        title: "Unpack it with pyinstxtractor",
        body: "Download `pyinstxtractor.py` from its GitHub page and run `python pyinstxtractor.py RentSplit.exe` with the same Python version the EXE was built with, or the inner PYZ archive won't unpack. It writes `RentSplit.exe_extracted`: the main script as a .pyc at the top, your own modules under `PYZ.pyz_extracted`, and data files such as JSON next to them.",
      },
      {
        title: "Decompile the .pyc files",
        body: "For Python 3.6 and later, PyLingual handles every released version: upload a .pyc at pylingual.io, or install it locally with `uv tool install`. pycdc (Decompyle++) is a fast command-line option: `pycdc file.pyc > file.py`. For 3.7–3.8 only, `pip install decompyle3`. Ignore the standard library and package files; you only need your own modules.",
      },
      {
        title: "Fill the gaps from the disassembly",
        body: "Recent Pythons change bytecode with every version, so a decompiler can stop on a function or write code that doesn't run. Python's own `dis` shows exactly what's there: with the same version, run `python -c \"import dis,marshal; dis.dis(marshal.loads(open('report.pyc','rb').read()[16:]))\"` and write that function by hand.",
      },
      {
        title: "Put the files back together",
        body: "Recreate the package folders as they were in `PYZ.pyz_extracted`, save the main script's source at the top, and copy the data files your code opens (the JSON, CSV or images from the extracted folder) to the same relative place, or the source will fail where the EXE didn't.",
      },
      {
        title: "Prove it matches",
        body: "Run the .py and the EXE on the same inputs and compare the output, including bad data. For a stricter test, compile your .py with the same Python (`python -m py_compile`) and compare its `dis` output with the original's: identical bytecode is the strongest proof. Rebuild the EXE with `pyinstaller --onefile` when you're done.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can you decompile a Python EXE?",
        a: "Yes, if it was built with PyInstaller, py2exe or cx_Freeze: they ship compiled Python bytecode, which keeps function names, strings and the program's logic. Unpack it, decompile the .pyc files, and you have readable source. Only comments and formatting are gone.",
      },
      {
        q: "How do I decompile a .pyc file?",
        a: "Use a decompiler that knows its Python version: PyLingual or pycdc for current versions, decompyle3 or uncompyle6 for older ones. The first bytes of a .pyc record the version; pyinstxtractor also prints it when it unpacks an EXE.",
      },
      {
        q: "Is there a way to decompile a .pyc online?",
        a: "pylingual.io decompiles uploaded .pyc files in the browser. It sends your code to their server; PyLingual, pycdc and pyinstxtractor also run offline on your own computer.",
      },
      {
        q: "Why does the decompiled code fail or look wrong for Python 3.11 and 3.12?",
        a: "Each Python version changes its bytecode, and older decompilers stop at 3.8 or 3.9. Use a current decompiler, then rewrite any function it couldn't handle from the `dis` disassembly, and test the result against the EXE.",
      },
      {
        q: "Does this work for a program made with Nuitka?",
        a: "Not this way. Nuitka turns Python into C and compiles that, so the EXE has no .pyc files. It's taken apart like any native program, with a disassembler such as Ghidra.",
      },
    ],
    related: ["reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/decompile-dotnet-dll-to-csharp", "reverse-engineering/decompile-jar-file", "reverse-engineering/extract-files-from-exe-installer"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "pyinstxtractor on GitHub", href: "https://github.com/extremecoders-re/pyinstxtractor" },
      { label: "PyLingual on GitHub", href: "https://github.com/syssec-utd/pylingual" },
      { label: "PyLingual web service", href: "https://pylingual.io" },
      { label: "Decompyle++ (pycdc) on GitHub", href: "https://github.com/zrax/pycdc" },
      { label: "decompyle3 on GitHub", href: "https://github.com/rocky/python-decompile3" },
      { label: "Python: dis, the bytecode disassembler", href: "https://docs.python.org/3/library/dis.html" },
      { label: "PyInstaller: what it bundles and how", href: "https://pyinstaller.org/en/stable/operating-mode.html" },
    ],
  },
  {
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
      "Fix a bug in a program with no source code by changing a few bytes of the EXE with Ghidra, x64dbg or a hex editor, or let Stella (stella.sh) find and patch it.",
    h1: "Patch an EXE file to fix a bug",
    short: "Patch an EXE file",
    lede: "An old program with no source fixed by changing the bytes of the EXE itself.",
    answer:
      "To patch an EXE you change a few bytes in the file itself. Find the instruction behind the bug in a disassembler such as Ghidra or x64dbg, then write the new bytes with the same tool or with a hex editor like HxD at that file offset. Keep a copy of the original, compare the two with `fc /b` (Windows) or `cmp -l` (Mac, Linux) to see exactly what changed, and test. Stella (stella.sh) finds the fault, patches it, keeps the original and tests the fixed program.",
    stellaSteps: [
      "Reads the README and the loan file, runs the program and sees 2026 loans read as 1926",
      "Saves the untouched program as LOANTRAK.ORIGINAL.EXE before changing anything",
      "Installs the Capstone disassembler in a scratch folder and disassembles the date code",
      "Finds the two-digit-year cutoff of 20 from the 1998 Y2K fix and changes that one byte to 95",
      "Compares the two files byte by byte and runs the report as of 1999, 2026 and 2030",
    ],
    prompt:
      "Our village library still runs an old program, LOANTRAK.EXE in Documents\\LoanTracker, and it now says every book is about 36,000 days overdue. There's no source code and the company is long gone. Fix the program itself so the dates come out right, and keep a copy of the original.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 2½ minutes Stella found the 1998 century window in LOANTRAK.EXE that read years from 20 to 99 as 19xx, changed one byte so 00–94 read as 2000s and 95–99 as 1990s, and kept the original as LOANTRAK.ORIGINAL.EXE. Checked afterwards by us: exactly 1 byte differs from the original, the loan file is untouched, and on 6 loan files it had never seen, as of dates from 1999 and New Year's Day 2000 to January 2027, the patched program printed exactly what a correctly fixed build prints.",
      note: "LOANTRAK.EXE is a small 32-bit program written in C for this test, with an invented library and borrowers. The wait is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/patch-exe-file/proof.mp4`,
        cuts: webCuts("reverse-engineering/patch-exe-file"),
        poster: `${PROOFS}/reverse-engineering/patch-exe-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 29.9,
        realDuration: 153,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Documents\\LoanTracker holds the 1998 LOANTRAK.EXE, its loan file and a README." },
        { at: 5, text: "The prompt: every book shows about 36,000 days overdue; fix the program itself and keep the original." },
        { at: 11, text: "Stella starts a task and guesses the cause: two-digit years, so 2026 is read as 1926." },
        { at: 15.5, text: "Backing up, disassembling the date code, patching one byte and testing, sped up 30×." },
        { at: 18.4, text: "Fixed: 9 books overdue by 6 to 24 days instead of 13 at 36,000, and the original kept beside it." },
        { at: 23, text: "One byte changed: years 00–94 now read as 2000s, so the 1998–99 records still read right." },
      ],
    },
    manualTitle: "Patch it yourself",
    manualSteps: [
      {
        title: "Keep the original and pin down the bug",
        body: "Copy the EXE to something like `LOANTRAK.ORIGINAL.EXE` first. Then find an input that shows the fault every time and the right answer for it: here a loan due 10/30/26 printed as due 10/30/1926, so the two-digit year is being read wrong.",
      },
      {
        title: "Open it in a disassembler",
        body: "Ghidra (free, from the NSA, needs Java 21) imports an EXE, analyses it and shows assembly beside decompiled C. Look for the constants the bug involves: Search › For Scalars finds `1900` (0x76C) and `2000` (0x7D0), and the date code sits next to them. In the decompiled view it reads like `if (yy < 20) year = yy + 2000; else year = yy + 1900;`.",
      },
      {
        title: "Work out the smallest change",
        body: "Change data, not logic, where you can. Here the cutoff 20 is the instruction `cmp eax, 0x14`, bytes `83 F8 14`, so only the last byte needs to change. Pick a value that keeps old records right: with loans back to 1998, any cutoff from 28 to 98 reads both 1998 and 2027 correctly. A new value must fit the same number of bytes.",
      },
      {
        title: "Write the new bytes",
        body: "In Ghidra, right-click the instruction, choose Patch Instruction, type `cmp eax, 0x5f`, then use File › Export Program with the Original File format to write a new EXE. In x64dbg, assemble the change, then File › Patch file to save it under a new name. Or open the EXE in HxD, use Search › Goto with the file offset, type the new byte and save.",
      },
      {
        title: "Compare the two files",
        body: "On Windows, `fc /b LOANTRAK.ORIGINAL.EXE LOANTRAK.EXE` lists every changed byte: here one line, `000003C1: 14 5F`. On Mac or Linux use `cmp -l`. HxD's Analysis › File-compare shows the same side by side. Anything you didn't mean to change shows up here.",
      },
      {
        title: "Test the edges",
        body: "Run the patched program on your real data and on dates around the change: before 2000, 1 January 2000, today and next year. Here `LOANTRAK /D:01-01-2000` prints the report as of that day.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I patch an EXE file?",
        a: "Find the instruction or value to change in a disassembler (Ghidra, x64dbg, IDA Free), then write the new bytes into a copy of the file, either from that tool or with a hex editor. Keep the change the same size so nothing else in the file moves.",
      },
      {
        q: "What's a good binary patch tool?",
        a: "Ghidra and x64dbg to find and patch code, HxD or ImHex to edit bytes directly, and radare2 (`r2 -w`) from the command line. To hand a patch to someone else, bsdiff or xdelta make a small patch file they apply to their own copy.",
      },
      {
        q: "How do I compare two binary files?",
        a: "`fc /b file1 file2` in a Windows Command Prompt, `cmp -l file1 file2` on Mac and Linux. Both list the offset and the old and new value of every byte that differs. VBinDiff and HxD show the differences side by side.",
      },
      {
        q: "Will a patched EXE still run?",
        a: "Yes, if the change keeps the same size and valid instructions. Windows doesn't check the checksum in an ordinary program's header. A digitally signed EXE shows as unsigned after any change.",
      },
      {
        q: "Does the same work for a 64-bit program?",
        a: "Yes. Ghidra, x64dbg and HxD all handle 64-bit EXEs; the instructions are longer, but finding the value, changing the bytes and comparing the files work the same way.",
      },
    ],
    related: ["reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/use-ai-with-ghidra", "reverse-engineering/edit-save-file", "reverse-engineering/decompile-dotnet-dll-to-csharp"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Ghidra on GitHub", href: "https://github.com/NationalSecurityAgency/ghidra" },
      { label: "Ghidra help: exporting a program (Original File)", href: "https://ghidradocs.com/12.0.1_PUBLIC/help/Base/help/topics/ExporterPlugin/exporter.htm" },
      { label: "x64dbg on GitHub", href: "https://github.com/x64dbg/x64dbg" },
      { label: "HxD hex editor", href: "https://mh-nexus.de/en/hxd/" },
      { label: "radare2 on GitHub", href: "https://github.com/radareorg/radare2" },
      { label: "Microsoft: fc command", href: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/fc" },
      { label: "Capstone disassembler", href: "https://www.capstone-engine.org/" },
    ],
  },
  {
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
      "Find out what a suspicious .exe would do without opening it: hashes, imports, hidden strings and the code itself, with free tools or Stella (stella.sh).",
    h1: "Is this EXE safe? Find out without running it",
    short: "Is this EXE safe?",
    lede: "A suspicious .exe taken apart without running it, and what it would really do.",
    answer:
      "Read the file instead of running it. Look its SHA-256 up on VirusTotal, then look inside with free tools: Detect It Easy shows the compiler and any packer, PEStudio lists the Windows functions it imports, FLOSS decodes hidden strings, and Ghidra shows what the code does step by step. Stella (stella.sh) does the same reading on your computer without ever opening the file, and answers verdict first: what it would do, every web address inside, and what to do next.",
    stellaSteps: [
      "Reads the file's headers: real file type, signature, the vendor it claims, and how it was built",
      "Lists the Windows functions it imports, which shows whether it can reach the network, the registry or other programs",
      "Disassembles the code, decodes the strings it hides, and follows what the program does with them",
      "Answers verdict first: what would happen if it were opened, any web addresses (made unclickable), and what to do with it",
    ],
    prompt:
      "I got Invoice_2291.pdf.exe in my Downloads from an email and haven't opened it. Is it safe? Take it apart without running it and tell me what it would do and any web addresses inside it. Keep it short, verdict first.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about a minute Stella took the file apart without running it and called it deceptive adware posing as a PDF. It decoded all three of its scrambled messages: the fake \"Converting Invoice_2291.pdf ... done.\" line, the readme_offer.txt advert it would put on the Desktop, and the one tracking link inside it, which no code in the file opens. Checked afterwards against the sample's source: every behaviour and the address match, and the file was never run.",
      note: "The test file is our own harmless program built to look like a disguised invoice, with scrambled text and a link under example.test, a name that never resolves. The wait is sped up 14×.",
      video: {
        src: `${PROOFS}/reverse-engineering/is-this-exe-safe/proof.mp4`,
        cuts: webCuts("reverse-engineering/is-this-exe-safe"),
        poster: `${PROOFS}/reverse-engineering/is-this-exe-safe/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 29.2,
        realDuration: 81,
        speed: 14,
      },
      moments: [
        { at: 0, text: "On the Mac: Invoice_2291.pdf.exe sits in Downloads, never opened." },
        { at: 4.03, text: "The prompt: is it safe? Take it apart without running it, and tell me what it would do and any web addresses." },
        { at: 10.03, text: "Stella spots the .pdf.exe disguise straight away and starts taking it apart without running it." },
        { at: 15.6, text: "Reading the headers and imports, decoding the hidden strings and reading the code, sped up 14×." },
        { at: 17.17, text: "Verdict first: deceptive adware. What it would do on Windows, the one tracking address (made unclickable), and what to do with the file." },
      ],
    },
    manualTitle: "Check it yourself",
    manualSteps: [
      {
        title: "Look up its hash",
        body: "Get the file's SHA-256: `certutil -hashfile file.exe SHA256` on Windows, `shasum -a 256 file.exe` on Mac, `sha256sum file.exe` on Linux. Search that hash on [VirusTotal](https://www.virustotal.com/) to see what dozens of antivirus engines already reported, without uploading anything; uploading the file itself shares it with security companies.",
      },
      {
        title: "Read the outside of the file",
        body: "Turn on file extensions in File Explorer (Windows 11: View > Show > File name extensions; Windows 10: the View tab, File name extensions): `Invoice.pdf.exe` is a program, not a PDF. Right-click > Properties > Digital Signatures shows whether it's signed and by whom; the Details tab shows the vendor it claims, which anyone can type in. An unsigned program with a document-style name is the first thing Stella flagged in the recorded run.",
      },
      {
        title: "Identify it and unpack it",
        body: "[Detect It Easy](https://github.com/horsicq/Detect-It-Easy) (free, for Windows, Mac and Linux) names the compiler, the file type and any packer. When it reports UPX, `upx -d file.exe -o unpacked.exe` with [UPX](https://github.com/upx/upx) gives you an unpacked copy for the other tools to read.",
      },
      {
        title: "List its imports and hidden strings",
        body: "[PEStudio](https://www.winitor.com/) (Windows) lists every imported function and flags the telling ones: networking (WinINet, WinHTTP), registry Run keys, starting other processes. Mandiant's [FLOSS](https://github.com/mandiant/flare-floss) goes past a plain `strings` dump and decodes scrambled strings, where web addresses and file paths often hide.",
      },
      {
        title: "Read the code, or run it in a throwaway machine",
        body: "Open it in [Ghidra](https://github.com/NationalSecurityAgency/ghidra/releases), start at the entry point and follow what `main` does with each decoded string: that turns guesses into facts. To watch it run, use a disposable virtual machine with networking off and no shared folders, take a snapshot first, and roll back or delete the machine afterwards.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I tell if an exe is safe without running it?",
        a: "Yes, for most files: its hash, signature, imports, hidden strings and code show what it can do before it ever runs, which is called static analysis. Running it in a disposable virtual machine is the second step, for code too tangled to read.",
      },
      {
        q: "Is VirusTotal enough?",
        a: "It's the right first check: when many engines flag the file, you have your answer. A clean result on a brand-new file tells you less, because few engines may have seen it yet, and that's when you look inside it yourself.",
      },
      {
        q: "What makes an exe look suspicious?",
        a: "A document-style name ending in .exe, no digital signature, vendor details that don't match the sender, a packer, scrambled strings, and imports for downloading files, editing Run keys or starting other programs. Together they tell you where to look in the code, and the code settles what it does.",
      },
      {
        q: "Is it safe to analyze malware on my own computer?",
        a: "Static analysis is: hashing a file, listing its imports, decoding its strings and decompiling it all read the file without running it. A Windows exe can't run on a Mac by itself either. Running a sample is the part that goes in a throwaway virtual machine.",
      },
      {
        q: "What did the file in the video turn out to be?",
        a: "A program posing as a PDF invoice. Opened on Windows, it prints a fake \"converting\" message and drops an advert with a tracking link on the Desktop, and its code has nothing to download, spread, steal or start with Windows. Stella decoded all of that without running it.",
      },
    ],
    related: ["reverse-engineering/use-ai-with-ghidra", "reverse-engineering/extract-files-from-exe-installer", "reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/inspect-app-traffic-with-mitmproxy"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "VirusTotal", href: "https://www.virustotal.com/" },
      { label: "certutil (Microsoft Learn)", href: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/certutil" },
      { label: "Detect It Easy", href: "https://github.com/horsicq/Detect-It-Easy" },
      { label: "PEStudio", href: "https://www.winitor.com/" },
      { label: "FLOSS (Mandiant)", href: "https://github.com/mandiant/flare-floss" },
      { label: "UPX", href: "https://github.com/upx/upx" },
      { label: "Ghidra releases (NSA)", href: "https://github.com/NationalSecurityAgency/ghidra/releases" },
    ],
  },
  {
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
      "Decompile an Android APK to readable Java with jadx, list its permissions and find every server it contacts, by hand or with Stella (stella.sh).",
    h1: "Decompile an APK to read its code",
    short: "Decompile an APK",
    lede: "An Android APK opened into readable code, its permissions and the servers it calls.",
    answer:
      "Open the .apk in jadx, the standard free decompiler: it turns the app's compiled Dalvik bytecode back into readable Java and shows the AndroidManifest with every permission. apktool unpacks the resources and smali. Searching the code and resources for addresses then shows which servers the app talks to. Stella (stella.sh) does this on your computer: it decompiles the APK with jadx, reads the manifest, and lists the permissions and every host the app connects to.",
    stellaSteps: [
      "Unpacks the APK and decompiles its bytecode back to readable Java with jadx",
      "Reads the AndroidManifest and lists every permission the app requests",
      "Searches the decompiled code and resources for the servers and API endpoints it contacts",
      "Gives you the source tree plus a plain summary: what it does, what it can reach, who it talks to",
    ],
    prompt:
      "I downloaded this currency app's APK, it's in my Downloads. Decompile it so I can read its code, and tell me what permissions it asks for and every server it connects to. Keep your reply short.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about two minutes Stella decompiled the APK to a folder of Java sources without installing or running it, listed its permissions (internet access, plus one internal permission the app defines for itself), and named the six exchange-rate servers it fetches from, separately from links that only open in a browser. Checked afterwards against the decoded manifest and the host strings compiled into the app: the permissions and all six servers match, and the APK is unchanged.",
      note: "The app is Currencies 1.23.0 by sal0max, the F-Droid build, GPL-3.0. The wait is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-apk/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-apk"),
        poster: `${PROOFS}/reverse-engineering/decompile-apk/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 28.3,
        realDuration: 128,
        speed: 30,
      },
      moments: [
        { at: 0, text: "On the Mac: Currencies-1.23.0.apk sits in Downloads." },
        { at: 4.03, text: "The prompt: decompile it, and tell me the permissions and every server it connects to." },
        { at: 9.03, text: "Stella says it's decompiling and will send the code folder, permissions and servers." },
        { at: 14.9, text: "Decompiling with jadx, reading the manifest and tracing the network code, sped up 30×." },
        { at: 16.6, text: "Done: the code folder, the permissions, the six rate servers, and the links that only open outside the app." },
      ],
    },
    manualTitle: "Do it yourself",
    manualSteps: [
      {
        title: "Get jadx and open the APK",
        body: "jadx is free. Download it from [its releases](https://github.com/skylot/jadx/releases) and unzip; it runs on 64-bit Java 11 or later. Run `jadx-gui your.apk` to browse the decompiled Java in a window, or `jadx -d out your.apk` to write the whole source tree to a folder. An APK is a zip, so this reads a copy and installs nothing.",
      },
      {
        title: "Read the app's own code",
        body: "In jadx-gui the left pane is the package tree. Open the app's own package (skip `androidx`, `kotlin` and other libraries) and read the Java. Use the search for a string like `http` to jump to URLs, or for a class name. jadx reconstructs method bodies well; an obfuscated app shows short names like `a.b.c`, with the logic all still there.",
      },
      {
        title: "List the permissions",
        body: "Open AndroidManifest.xml (under Resources in jadx). Each `<uses-permission>` line is a capability the app asks for: INTERNET, camera, location, contacts and so on. A permission named in an `android:permission` attribute guards a component instead of being requested. [apktool](https://github.com/iBotPeaches/Apktool) decodes the manifest too: `apktool d your.apk`. Android's [permissions list](https://developer.android.com/reference/android/Manifest.permission) says what each one grants.",
      },
      {
        title: "Find every server it talks to",
        body: "Search the decompiled sources and resources for `http` and `https`, and read the networking classes (OkHttp, Retrofit, HttpURLConnection) and `res/xml/network_security_config.xml`. Each distinct host is a server the app can reach. Check string resources and code that pieces URLs together as well as plain literals, since base URLs often live there.",
      },
      {
        title: "The one-command version",
        body: "To get it all quickly: `jadx -d out your.apk` for the Java, then `grep -rhoE 'https?://[^\"]+' out | sort -u` to pull out the hosts, and open `out/resources/AndroidManifest.xml` for the permissions. To also see servers chosen at runtime, record the app's live traffic with a proxy such as [mitmproxy](https://mitmproxy.org/).",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can you decompile any APK?",
        a: "Almost any APK decompiles to readable smali, and most to good Java with jadx. Obfuscated apps (short names, encrypted strings) take longer to read, with the logic all present. The app in the recorded run is open-source, so it comes out clean and easy to follow.",
      },
      {
        q: "Is jadx or apktool better?",
        a: "They do different jobs. jadx gives you readable Java for understanding an app. apktool gives you smali and decoded resources, which is what you edit to change an app and rebuild it. For reading an app, use jadx; for editing and repackaging it, apktool.",
      },
      {
        q: "How do I see what servers an app contacts?",
        a: "Decompile it, search for URLs, and read the networking code: that shows the hosts built into the app. For addresses the app builds or fetches at runtime, also record its live traffic through a proxy like mitmproxy. In the recorded run, all six exchange-rate hosts were found in the code.",
      },
      {
        q: "Does decompiling an app change it?",
        a: "The APK on disk stays exactly as it was: you read a copy, and nothing is installed on a device. Stella confirms the file's hash is unchanged after the job.",
      },
      {
        q: "What is an APK made of?",
        a: "It's a zip containing compiled code in one or more classes.dex files (Dalvik bytecode), the AndroidManifest, and resources such as images, layouts and strings. Decompilers turn the dex back into Java or smali and decode the binary manifest and resources into a readable form.",
      },
    ],
    related: ["reverse-engineering/edit-apk", "reverse-engineering/inspect-app-traffic-with-mitmproxy", "reverse-engineering/decompile-jar-file", "reverse-engineering/deobfuscate-javascript"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "jadx", href: "https://github.com/skylot/jadx" },
      { label: "Apktool", href: "https://github.com/iBotPeaches/Apktool" },
      { label: "Android permissions reference", href: "https://developer.android.com/reference/android/Manifest.permission" },
      { label: "mitmproxy", href: "https://mitmproxy.org/" },
    ],
  },
  {
    slug: "edit-apk",
    niche: "reverse-engineering",
    searchPhrases: [
      "edit apk",
      "apktool",
      "modify apk",
      "recompile apk",
      "edit apk package name",
    ],
    title: "Edit an APK: rename it, rebuild and sign it",
    description:
      "Unpack an APK with apktool, rename it or change its resources, rebuild and sign it so it installs, by hand or with Stella (stella.sh) doing the round trip.",
    h1: "Edit an APK and rebuild it into a signed app",
    short: "Edit and rebuild an APK",
    lede: "An app renamed and repackaged into a signed APK that installs on a phone.",
    answer:
      "Unpack the APK with apktool (`apktool d app.apk`), edit its resources or smali, and rebuild it with `apktool b`. Then sign the rebuilt APK with apksigner or uber-apk-signer, because Android only installs signed apps. Stella (stella.sh) does the whole round trip on your computer: it unpacks the APK, makes the change you asked for (here the app's name), rebuilds it, signs it, and checks the signature verifies, so you get an APK that installs.",
    stellaSteps: [
      "Unpacks the APK into editable resources and smali with apktool",
      "Makes the change you asked for, here the name shown under the icon",
      "Rebuilds the APK and signs it with a new key so a phone will accept it",
      "Verifies the signature and the package name, and hands you an installable APK plus the key for future updates",
    ],
    prompt:
      'Rename this app in my Downloads to "FX Watch" so that\'s the name shown under the icon, then rebuild it into a signed APK I can install on my phone. Keep your reply short.',
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        'In about two minutes Stella unpacked the APK, changed the name under the icon to "FX Watch", rebuilt it, signed it with a new key and saved FX-Watch-1.58.apk in Downloads, with the key and its password beside it for future updates. Checked afterwards: the APK decodes with apktool, its launcher label reads "FX Watch", the package name is unchanged, zip alignment and the v1, v2 and v3 signatures verify, and the original APK is untouched.',
      note: "The app is Currency 1.58 by Bill Farmer, the F-Droid build, GPL-3.0. The wait is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/edit-apk/proof.mp4`,
        cuts: webCuts("reverse-engineering/edit-apk"),
        poster: `${PROOFS}/reverse-engineering/edit-apk/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.4,
        realDuration: 127,
        speed: 30,
      },
      moments: [
        { at: 0, text: "On the Mac: Currency-1.58.apk sits in Downloads." },
        { at: 4.03, text: 'The prompt: rename it to "FX Watch" and rebuild a signed APK I can install.' },
        { at: 11.03, text: "Stella says it's making a signed APK named FX Watch and leaving the original untouched." },
        { at: 17.2, text: "Unpacking with apktool, changing the name, rebuilding and signing, sped up 30×." },
        { at: 18.77, text: 'Done: FX-Watch-1.58.apk, how to install it, what still says "Currency", and the signing key to keep.' },
      ],
    },
    manualTitle: "Do it yourself",
    manualSteps: [
      {
        title: "Unpack it with apktool",
        body: "apktool is free and runs on Java. Get it from [apktool.org](https://apktool.org/) or [GitHub](https://github.com/iBotPeaches/Apktool), then run `apktool d app.apk`. It writes a folder with the decoded AndroidManifest.xml, the resources, and the code as smali, working on a copy of the APK.",
      },
      {
        title: "Make your change",
        body: "To rename the app, edit `res/values/strings.xml` and change the `app_name` value (or whatever string `android:label` points to in the manifest). To swap the icon, replace the `ic_launcher` images in the `mipmap` and `drawable` folders. To change on-screen wording, edit the matching strings. Only changes to what the app does need edits in the smali.",
      },
      {
        title: "Rebuild the APK",
        body: "Run `apktool b yourfolder -o new.apk`; without `-o` it writes the APK into a `dist` folder inside yourfolder. apktool repackages the resources and smali into an APK, which comes out unsigned, so signing is the next step.",
      },
      {
        title: "Sign and align it",
        body: "Make a key once: `keytool -genkey -v -keystore my.keystore -alias k -keyalg RSA -validity 10000`. Then zipalign and sign with Android's `zipalign` and `apksigner` from the build-tools, or do both in one go with [uber-apk-signer](https://github.com/patrickfav/uber-apk-signer): `java -jar uber-apk-signer.jar -a new.apk` signs with its debug key. Confirm with `apksigner verify new.apk` (or `-y` on uber-apk-signer), which checks the signatures and alignment.",
      },
      {
        title: "Install it, keeping the original",
        body: "Copy the signed APK to your phone and open it (allow installs from this source), or run `adb install new.apk`. A build signed with your key installs as a fresh app: uninstall the store version first, and keep the original APK so going back is a reinstall.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why won't my rebuilt APK install?",
        a: "Signing is the usual cause. A freshly rebuilt APK is unsigned and Android rejects it, so sign and zipalign it with apksigner or uber-apk-signer. A signed build that still refuses is usually meeting an installed copy signed with a different key: uninstall that copy, then install your build.",
      },
      {
        q: "Do I have to re-sign every time I edit?",
        a: "Yes. Rebuilding replaces the original signature, so each new APK gets signed before it installs. A debug key works for your own phone; a proper release key matters when you share the app with other people.",
      },
      {
        q: "Is apktool b the same as recompiling the app?",
        a: "`apktool b` repackages the decoded resources and smali into an APK; it doesn't compile Java. A name, icon, text or resource change needs no code at all, and changing behaviour means editing the smali.",
      },
      {
        q: "Can I change the app's package name?",
        a: "Yes: rename the package in the manifest, update every reference to it across the smali and resources, then sign. Your build then installs alongside the original instead of replacing it. Changing the display label, as in the recorded run, is the quicker and more common edit.",
      },
      {
        q: "Will editing an APK wipe the app's data?",
        a: "Your re-signed build installs as a separate app, so an existing install keeps its data until you remove it. Uninstalling the original to make room does erase that app's settings, as Stella pointed out in the recorded run. Keep the original APK so going back is a reinstall.",
      },
    ],
    related: ["reverse-engineering/decompile-apk", "reverse-engineering/decompile-jar-file", "reverse-engineering/inspect-app-traffic-with-mitmproxy", "reverse-engineering/patch-exe-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Apktool", href: "https://apktool.org/" },
      { label: "Apktool (GitHub)", href: "https://github.com/iBotPeaches/Apktool" },
      { label: "uber-apk-signer", href: "https://github.com/patrickfav/uber-apk-signer" },
      { label: "apksigner (Android build-tools)", href: "https://developer.android.com/tools/apksigner" },
    ],
  },
  {
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
      "Turn a .jar back into Java source code you can edit and compile, with the free Vineflower or CFR decompilers, or let Stella (stella.sh) decompile, rebuild and test it.",
    h1: "Decompile a JAR file back to Java source code",
    short: "Decompile a JAR to Java",
    lede: "A program you only have as a .jar, back as Java source that compiles and runs the same.",
    answer:
      "A JAR is a zip of compiled Java classes, and a free decompiler such as Vineflower (`java -jar vineflower.jar app.jar src`) or CFR turns them back into readable .java files; IntelliJ IDEA shows the same code when you open a .class. Class, method and field names come back, comments don't, and newer Java features sometimes need a hand fix before the source compiles. Stella (stella.sh) downloads a JDK and the decompiler, fixes what won't compile, rebuilds the jar and checks it behaves exactly like the original.",
    stellaSteps: [
      "Fingerprints the original jar and runs it on your sample file, to have something to compare against",
      "Downloads a portable Java 21 JDK and the Vineflower decompiler into a scratch folder, nothing installed system-wide",
      "Decompiles every class, pulls out the built-in rates.properties and lays it all out as a normal src\\main\\java project",
      "Fixes by hand the parts the decompiler couldn't turn back into valid Java (a pattern-matching switch), keeping the logic the same",
      "Rebuilds the jar and runs old and new side by side until the output matches, then writes build.bat and a README",
    ],
    prompt:
      "I only have the jar file for our old RouteSheet program (it's in Documents\\RouteSheet). Get the Java source code back out of it so we can change it and compile it again, and tell me where you put it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 5 minutes Stella recovered 10 Java source files and the built-in price table into Documents\\RouteSheet\\source, with a build script and a rebuilt jar, on a PC with no Java installed. Checked afterwards by us: the source compiles with javac 21, and a jar built from it gave identical output, error messages and exit codes to the original on 8 test runs it had never seen. The original jar was unchanged.",
      note: "RouteSheet is a small Java 21 courier-pricing tool written for this test, with invented names; straight decompiler output from Vineflower and CFR doesn't compile for it. The wait is shown at up to 52×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-jar-file/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-jar-file"),
        poster: `${PROOFS}/reverse-engineering/decompile-jar-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.53,
        speed: 52,
        realDuration: 314,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Documents\\RouteSheet has routesheet.jar, a sample CSV and no source code." },
        { at: 4, text: "The prompt: get the Java source back out of the jar so it can be changed and compiled again." },
        { at: 10.7, text: "Stella starts a task to decompile the jar and prove the source rebuilds into the same program." },
        { at: 14.7, text: "Downloading a JDK and Vineflower, decompiling, fixing what won't compile and comparing runs, sped up 52×." },
        { at: 19.9, text: "Done: the source is in Documents\\RouteSheet\\source, and the rebuilt jar matched the original on 11 test runs." },
        { at: 26.7, text: "It says what can't come back (comments, local names) and lists three quirks it kept exactly as they were." },
      ],
    },
    manualTitle: "Decompile it yourself",
    manualSteps: [
      {
        title: "Get a JDK of the right version",
        body: "Compiling needs a JDK, not just Java. Find the version the jar targets: `javap -v -cp app.jar com.example.Main` shows `major version` (52 is Java 8, 61 is Java 17, 65 is Java 21). Get that version or newer from [Adoptium Temurin](https://adoptium.net/temurin/releases/); the zip builds need no install.",
      },
      {
        title: "Decompile with Vineflower",
        body: "Download the latest `vineflower-….jar` from its [GitHub releases](https://github.com/Vineflower/vineflower/releases) (it needs Java 17 or newer to run) and run `java -jar vineflower.jar app.jar src`. It writes one .java file per class into `src`, in package folders, and copies the jar's other files (`.properties`, images, `META-INF/MANIFEST.MF`). CFR is the other good free choice: `java -jar cfr-0.152.jar app.jar --outputdir src`, but it skips non-class files, so unzip those from the jar yourself.",
      },
      {
        title: "Or read it in IntelliJ IDEA",
        body: "To browse rather than rebuild, add the jar to a project as a library and open any class: the bundled Java Bytecode Decompiler plugin (Fernflower) shows the source, but doesn't write .java files.",
      },
      {
        title: "Compile it",
        body: "On Windows run `dir /s /b src\\*.java > sources.txt`, on Mac or Linux `find src -name \"*.java\" > sources.txt`, then `javac --release 21 -d classes @sources.txt` (use the release you found in the first step). Copy the resource files into `classes` at the same relative paths, then pack it: `jar --create --file rebuilt.jar --manifest src/META-INF/MANIFEST.MF -C classes .`",
      },
      {
        title: "Fix what doesn't compile",
        body: "Newer features such as `switch` with patterns can come out as `SwitchBootstraps.typeSwitch` or `CallSite` calls, which aren't valid Java. Rewrite those few spots as normal Java; a second decompiler's version of the same class often shows the intent. Missing imports and generic types are the other common fixes.",
      },
      {
        title: "Check it behaves the same",
        body: "Run the original and the rebuilt jar on the same inputs, error cases included, and compare the output with `fc out1.txt out2.txt` on Windows or `diff` on Mac and Linux. Once they match, change the source and rebuild.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can you decompile a JAR file to source code?",
        a: "Yes. Java bytecode keeps class, method and field names and the program's structure, so tools like Vineflower, CFR and IntelliJ's Fernflower get very close to the original. Comments and, in release builds, local variable names are gone, and an obfuscated jar has its names scrambled.",
      },
      {
        q: "How do I decompile a JAR file in IntelliJ?",
        a: "Add the jar to a project as a library, expand it in the Project view and open a class; IntelliJ decompiles it on the fly with its bundled Java Bytecode Decompiler plugin. To get .java files on disk, use Vineflower, which is built from the same Fernflower code, on the command line.",
      },
      {
        q: "Can I decompile a JAR online?",
        a: "Some websites run CFR or Fernflower on an uploaded jar, but your program goes to their server and you get files to read, not a checked project. Vineflower and CFR run offline anywhere Java does.",
      },
      {
        q: "Why doesn't the decompiled code compile?",
        a: "Some constructs from recent Java versions, especially pattern-matching switch, don't map back cleanly from bytecode. The errors point at a handful of lines: fix those by hand, compile for the Java release the jar targets, and compare the rebuilt jar with the original.",
      },
      {
        q: "Does this work for Minecraft mods?",
        a: "A mod jar decompiles the same way. To rebuild one, move the decompiled classes into the mod loader's development setup (Fabric Loom or NeoForge), because a mod compiles against Minecraft's own code.",
      },
    ],
    related: ["reverse-engineering/decompile-dotnet-dll-to-csharp", "reverse-engineering/decompile-apk", "reverse-engineering/deobfuscate-javascript", "reverse-engineering/decompile-exe-to-source-code"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Vineflower on GitHub (usage, Java requirement)", href: "https://github.com/Vineflower/vineflower" },
      { label: "Vineflower releases", href: "https://github.com/Vineflower/vineflower/releases" },
      { label: "CFR decompiler", href: "https://www.benf.org/other/cfr/" },
      { label: "IntelliJ IDEA: decompiler", href: "https://www.jetbrains.com/help/idea/decompiler.html" },
      { label: "Eclipse Temurin JDK downloads", href: "https://adoptium.net/temurin/releases/" },
      { label: "javac command reference (Java 21)", href: "https://docs.oracle.com/en/java/javase/21/docs/specs/man/javac.html" },
      { label: "jar command reference (Java 21)", href: "https://docs.oracle.com/en/java/javase/21/docs/specs/man/jar.html" },
    ],
  },
  {
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
      "Turn obfuscated JavaScript back into readable code with webcrack or synchrony, or let Stella (stella.sh) rewrite it and prove it behaves the same.",
    h1: "Deobfuscate JavaScript back to readable code",
    short: "Deobfuscate JavaScript",
    lede: "A scrambled script back as JavaScript you can read, doing exactly what it did before.",
    answer:
      "Run the file through webcrack (`npx webcrack billing.js > clean.js`) or synchrony: both undo obfuscator.io's encoded string array, flattened control flow and dead code, and the output runs the same. What they can't bring back is names: functions and variables stay as `_0x3f2a`-style hex, so you rename them by hand while reading the logic. Stella (stella.sh) does the whole job, from decoding to renaming and restructuring, then runs old and new side by side until every output matches.",
    stellaSteps: [
      "Keeps the original untouched and runs it on your data first, to have something to compare against",
      "Decodes the encrypted string table and unwinds the flattened control flow and fake branches",
      "Rewrites the logic as plain JavaScript with real names, prices as named values at the top, and comments on the rules",
      "Runs both scripts side by side on your file and on hundreds of made-up inputs, broken ones included, until every output, error message and exit code matches",
      "Tells you what the scrambling was hiding, here three promo codes, and flags oddities in your data",
    ],
    prompt:
      "The developer who wrote our billing script only ever gave us a scrambled version of it (Documents\\Brightwell Billing\\billing.js). Turn it into readable JavaScript that still works exactly the same, and tell me where you put it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 10 minutes Stella turned a 64 KB obfuscated script into an 8 KB, 229-line billing-readable.js next to the original, with 12 named functions and no hex names left, and decoded the three promo codes it hid. Checked afterwards by us: on 10 test runs it had never seen, including bad input, it printed exactly what the original printed, errors and exit codes included. The original was unchanged.",
      note: "Brightwell Billing is a small Node.js billing script written for this test, with invented members, scrambled with javascript-obfuscator 5.10 on its strongest settings (RC4 string array, control-flow flattening, dead code, self-defending). webcrack 2.16 on the same file gave working code with 72 hex names left. The wait is shown at up to 60×.",
      video: {
        src: `${PROOFS}/reverse-engineering/deobfuscate-javascript/proof.mp4`,
        cuts: webCuts("reverse-engineering/deobfuscate-javascript"),
        poster: `${PROOFS}/reverse-engineering/deobfuscate-javascript/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 36.13,
        speed: 60,
        realDuration: 618,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Documents\\Brightwell Billing holds the scrambled billing.js and November's member list." },
        { at: 4, text: "The prompt: turn the scrambled script into readable JavaScript that works exactly the same." },
        { at: 11.1, text: "Stella starts a task; the original stays as it is and the new copy gets checked against it." },
        { at: 15.3, text: "Decoding the strings, rewriting the logic and comparing both scripts on hundreds of inputs, sped up 60×." },
        { at: 24.5, text: "Done: billing-readable.js sits next to the original and matched it on 300 test member lists." },
        { at: 28, text: "It names the three hidden promo codes and lists problems in the member file worth checking." },
      ],
    },
    manualTitle: "Deobfuscate it yourself",
    manualSteps: [
      {
        title: "Keep the original and record what it does",
        body: "Work on a copy. Run the original on a few real inputs and some broken ones and save the output, for example `node billing.js members.json 2026-11 > before.txt 2>&1`. Obfuscated code often has a self-defending trap that hangs if the file is reformatted, so compare against the untouched file.",
      },
      {
        title: "Run webcrack",
        body: "With Node.js 22 or 24, `npx webcrack billing.js > clean.js` undoes obfuscator.io and javascript-obfuscator output: it decodes the string array, removes the self-defending and debug traps, unflattens control flow and drops dead code. `-o folder` also unpacks webpack and browserify bundles. No install needed for a quick look: paste the code into the [webcrack playground](https://webcrack.netlify.app/).",
      },
      {
        title: "Or try synchrony",
        body: "If webcrack leaves strings encoded, try synchrony: `npm install --global deobfuscator`, then `synchrony deobfuscate billing.js` writes `billing.cleaned.js`. Its web version is at [deobfuscate.relative.im](https://deobfuscate.relative.im/). It handles current javascript-obfuscator output; very old versions may not decode.",
      },
      {
        title: "Rename everything by hand",
        body: "Names are gone for good, so every function and variable is still `a0_0x3f2a` or similar. Open the file in VS Code and use Rename Symbol (F2), which renames each one everywhere it's used. Start with the values: once `a0_0x57877d` is clearly the price list, call it `PLANS`, and the functions that use it start to read themselves.",
      },
      {
        title: "Check it still behaves the same",
        body: "Run the cleaned file on the same inputs and compare: `fc before.txt after.txt` on Windows, `diff` on Mac and Linux. Compare exit codes and error messages too; scripts often depend on them.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can obfuscated JavaScript be fully deobfuscated?",
        a: "The behaviour, yes: everything the code does is still in the file, and tools like webcrack undo the common tricks automatically. The original names and comments are gone, so getting readable code back means renaming things by hand once you understand them.",
      },
      {
        q: "How do I deobfuscate code from obfuscator.io?",
        a: "Code with `_0x` names, a big array of encoded strings and a `while(true)` switch is from obfuscator.io or javascript-obfuscator. webcrack and synchrony are built for exactly that output; run either on the file, then rename the remaining hex names.",
      },
      {
        q: "Is unminifying the same as deobfuscating?",
        a: "No. Minified code only lost its whitespace and long names; Prettier or your browser's pretty-print fixes the layout. Obfuscated code is deliberately scrambled, and on this test file Prettier gave 938 `_0x` names and a script that hung on its self-defending check.",
      },
      {
        q: "Can I deobfuscate JavaScript online?",
        a: "Yes, the webcrack playground and deobfuscate.relative.im both run in the browser. The local command-line versions are better for anything private or large, and either way you still rename by hand.",
      },
    ],
    related: ["reverse-engineering/decompile-jar-file", "reverse-engineering/extract-electron-asar", "reverse-engineering/decompile-lua", "reverse-engineering/decompile-exe-to-source-code"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "webcrack on GitHub (features, CLI, Node versions)", href: "https://github.com/j4k0xb/webcrack" },
      { label: "webcrack playground", href: "https://webcrack.netlify.app/" },
      { label: "synchrony on GitHub", href: "https://github.com/relative/synchrony" },
      { label: "javascript-obfuscator options", href: "https://github.com/javascript-obfuscator/javascript-obfuscator" },
      { label: "VS Code: Rename Symbol", href: "https://code.visualstudio.com/docs/editing/refactoring#_rename-symbol" },
    ],
  },
  {
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
      "Unpack an Electron app's app.asar with the asar tool, change the app's code and pack it back so it still starts, or let Stella (stella.sh) do the whole edit.",
    h1: "Extract an Electron app's app.asar, edit it and repack it",
    short: "Extract and edit app.asar",
    lede: "Change how a desktop app built on Electron behaves by editing the code inside it.",
    answer:
      "An Electron app's code sits in `resources\\app.asar`, a simple archive. With Node.js installed, `npx @electron/asar extract app.asar app` unpacks it, you edit the JavaScript, and `npx @electron/asar pack app app.asar` packs it back; the app then runs your version. Shipped apps are usually minified, so you search for the values rather than read the code. Stella (stella.sh) finds where each setting really lives, makes the change, repacks the archive, keeps a backup and checks the app still starts.",
    stellaSteps: [
      "Copies app.asar to a scratch folder and unpacks it there, leaving the app untouched until the edit is ready",
      "Finds the built-in defaults in the minified main bundle, stored in seconds (1500 and 300), and the button label table in the renderer",
      "Changes focus to 3000 seconds, breaks to 600 and only the Start label to Go, leaving Start over and the other buttons alone",
      "Repacks the archive, swaps it in and keeps the original as app.asar.bak-25min for undo",
      "Starts Pomodoro Desk.exe the normal way to confirm it opens on 50:00 with a Go button, and shows you a screenshot",
    ],
    prompt:
      "My Pomodoro Desk app (in Documents\\Pomodoro Desk) always starts with a 25-minute focus timer and 5-minute breaks, and there's no setting for it. Change the app itself so it starts at 50 minutes with 10-minute breaks, and make the Start button say Go. It should still open like before.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In under 3 minutes Stella changed the app's built-in timer to 50 minutes with 10-minute breaks and the Start button to Go, by editing and repacking app.asar, with a backup of the original beside it. Checked afterwards by us on a fresh profile: the app opened on 50:00 with Go, Start over and Skip break, the long break and title were unchanged, the five files inside that didn't need changing were byte-identical and the Electron runtime was untouched.",
      note: "Pomodoro Desk is a small Electron 44 timer app written for this test and packaged the way shipped apps are, with minified bundles. Editing only index.html leaves the button saying Start, and a blanket Start-to-Go replace turns Start over into Go over. The wait is shown at up to 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/extract-electron-asar/proof.mp4`,
        cuts: webCuts("reverse-engineering/extract-electron-asar"),
        poster: `${PROOFS}/reverse-engineering/extract-electron-asar/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.63,
        speed: 30,
        realDuration: 169,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Pomodoro Desk is a packaged Electron app in Documents, with no setting for its timer." },
        { at: 4, text: "The prompt: make the app itself start at 50 minutes with 10-minute breaks, and rename Start to Go." },
        { at: 10.4, text: "Stella starts a task to change the app while keeping it opening the same way." },
        { at: 15.9, text: "Unpacking app.asar, editing the minified code, repacking and test-starting the app, sped up 30×." },
        { at: 19.6, text: "Done: the app opens at 50:00 with a Go button, with a screenshot of it running." },
        { at: 25.6, text: "It notes the 15-minute long break was left alone, where the backup is, and that an update will undo the change." },
      ],
    },
    manualTitle: "Edit it yourself",
    manualSteps: [
      {
        title: "Find the archive and back it up",
        body: "Right-click the app's shortcut, Open file location, and look in `resources` for `app.asar` (per-user installs live under `%LOCALAPPDATA%\\Programs`). Close the app and copy app.asar somewhere safe. If there's also an `app.asar.unpacked` folder, keep it next to the archive.",
      },
      {
        title: "Extract it",
        body: "Install [Node.js](https://nodejs.org/) (version 22.12 or newer), then in that folder run `npx @electron/asar extract app.asar app`. You get the app's package.json, HTML and JavaScript. `npx @electron/asar list app.asar` shows the contents without extracting.",
      },
      {
        title: "Find and change the code",
        body: "Shipped code is usually minified, so search the files for what you can see in the app (a label, a number) in VS Code. Remember units: a 25-minute timer may be `1500` seconds or `1500000` milliseconds. Labels set by JavaScript win over the HTML, so change them where the script sets them, and change only the exact string you mean.",
      },
      {
        title: "Pack it back",
        body: "Run `npx @electron/asar pack app app.asar` and put the new app.asar in place of the old one. If the original had an `app.asar.unpacked` folder, pass the same files with `--unpack-dir` so native modules stay outside the archive.",
      },
      {
        title: "Start it and test",
        body: "Open the app normally and check your change. If it closes straight away, the developer turned on ASAR integrity (Electron 30 and newer on Windows), which refuses a changed archive; restore your backup. Any app update will replace your edit.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I open an .asar file?",
        a: "It's an archive, not a program: `npx @electron/asar extract app.asar folder` with Node.js unpacks it on Windows, Mac or Linux. 7-Zip with the Asar7z plugin can also browse one.",
      },
      {
        q: "Where is app.asar on a Mac?",
        a: "Inside the app bundle: right-click the app, Show Package Contents, then Contents/Resources/app.asar. Editing it breaks the app's code signature, so macOS may refuse to open it until you re-sign it with `codesign --force --deep --sign - App.app`.",
      },
      {
        q: "Why does the app crash after I repack app.asar?",
        a: "Usually a syntax slip in the edited JavaScript, a missing `app.asar.unpacked` folder, or ASAR integrity checking, which closes the app when the archive's hash changes. Start it from a terminal to see the error.",
      },
      {
        q: "Can I extract an asar without Node.js?",
        a: "Yes, with 7-Zip and the Asar7z plugin or a standalone extractor, but to pack it back the official asar tool on Node.js is the reliable way.",
      },
    ],
    related: ["reverse-engineering/deobfuscate-javascript", "reverse-engineering/extract-files-from-exe-installer", "reverse-engineering/patch-exe-file", "reverse-engineering/extract-pak-files"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "@electron/asar on GitHub (CLI, Node version)", href: "https://github.com/electron/asar" },
      { label: "Electron: ASAR archives", href: "https://www.electronjs.org/docs/latest/tutorial/asar-archives" },
      { label: "Electron: ASAR integrity", href: "https://www.electronjs.org/docs/latest/tutorial/asar-integrity" },
      { label: "Node.js downloads", href: "https://nodejs.org/" },
    ],
  },
  {
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
      "Turn a compiled .luac file back into Lua source with unluac, then make it readable, or let Stella (stella.sh) decompile it and prove it runs the same.",
    h1: "Decompile Lua bytecode back to readable Lua source",
    short: "Decompile Lua bytecode",
    lede: "A script you only have as compiled .luac, back as Lua you can read and edit.",
    answer:
      "Standard Lua bytecode decompiles with unluac, a free Java tool: `java -jar unluac.jar loot.luac > loot.lua` gives Lua 5.0 to 5.4 source that runs. Most shipped scripts are compiled with debug info stripped, so every local comes out as `L0_1` or `A1_2`, and you rename them by hand while reading the logic, then test the result against the original with the same Lua version. Stella (stella.sh) rebuilds readable source with real names and proves it matches, call for call or byte for byte.",
    stellaSteps: [
      "Reads the header to see it's Lua 5.4 bytecode, and unpacks a Lua 5.4 package into a scratch folder without installing it",
      "Lists every instruction with `luac -l -l` and works out each function: the dice roller, rarity weights, chest size, prices and XP",
      "Writes the module back as normal Lua with descriptive names, table literals and comments",
      "Compiles its source with the same luac until the listing, and then the file itself, is identical to loot.luac",
      "Runs old and new side by side on over 82,000 calls, then explains the loot rules in plain words",
    ],
    prompt:
      "Our Ember Isle game server's loot rules only exist as compiled Lua (Documents\\Ember Isle Server\\scripts\\loot.luac); nobody has the source. Turn it back into readable Lua that works exactly the same, and tell me where you put it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 4 minutes Stella recovered loot.lua next to the compiled file, with real names and the item tables as plain tables, and its source compiles back to a loot.luac identical byte for byte. Checked afterwards by us: on 2,142 calls it had never seen, including a bad rarity and integer-versus-float results, it returned exactly what the bytecode returned, and the original was unchanged.",
      note: "Ember Isle is a made-up game server for this test; its loot module was compiled with luac 5.4.8 with debug info stripped, the way games usually ship scripts. Straight unluac output for it runs, but names every local L0_1 or A1_2. The wait is shown at up to 36×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-lua/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-lua"),
        poster: `${PROOFS}/reverse-engineering/decompile-lua/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 32.4,
        speed: 36,
        realDuration: 241,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. The Ember Isle server's loot rules exist only as compiled scripts\\loot.luac." },
        { at: 4, text: "The prompt: turn it back into readable Lua that works exactly the same." },
        { at: 10.7, text: "Stella starts a task; the original stays untouched and the new source goes next to it." },
        { at: 15.2, text: "Getting Lua 5.4, reading the bytecode and rebuilding the source until it compiles identically, sped up 36×." },
        { at: 20.1, text: "Done: loot.lua compiles to a file identical to loot.luac and matched it on over 82,000 test calls." },
        { at: 27, text: "It explains the loot odds and prices in plain words, and that server.lua still loads the compiled file." },
      ],
    },
    manualTitle: "Decompile it yourself",
    manualSteps: [
      {
        title: "Find out which Lua it is",
        body: "Open the file in a hex viewer. Standard Lua bytecode starts with `1B 4C 75 61` (`.Lua`) and the next byte is the version: `51` is Lua 5.1, `52` 5.2, `53` 5.3, `54` 5.4. A file starting with `1B 4C 4A` is LuaJIT, which needs a LuaJIT decompiler instead. Roblox's Luau is a different format again.",
      },
      {
        title: "Decompile with unluac",
        body: "Install Java (any recent [Temurin](https://adoptium.net/temurin/releases/) build), download `unluac.jar` from [its SourceForge page](https://sourceforge.net/projects/unluac/files/) and run `java -jar unluac.jar loot.luac > loot.lua`. It handles Lua 5.0 to 5.4. If the file kept its debug info you get the original local names; if it was stripped, locals come out as `L0_1`, `A1_2` and so on.",
      },
      {
        title: "Get the matching Lua to test with",
        body: "Download Lua for your version from [LuaBinaries](https://luabinaries.sourceforge.net/) (for 5.4 on Windows, `lua-5.4.8_Win64_bin.zip`, no install needed). Run the original and the decompiled file on the same inputs: `lua54 -e \"local m=dofile('loot.luac') print(m.price('rare',3,5))\"`, then the same with loot.lua.",
      },
      {
        title: "Rename and tidy by hand",
        body: "Read each function, work out what it does and rename its locals with your editor's rename feature. Turn chains of `L3_1[1] = L4_1` back into table literals. Lua 5.4 tells integers from floats, so keep `math.floor` and `//` exactly as the decompiler gave them: for a float `x`, `x // 1` stays a float while `math.floor(x)` returns an integer.",
      },
      {
        title: "Compare again",
        body: "After every round of renaming, rerun your comparison. Once it still matches on many inputs, including bad ones, the source is ready to edit.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can every .luac file be decompiled?",
        a: "Standard Lua 5.0 to 5.4 bytecode decompiles well with unluac. Games sometimes change the opcode order or encrypt their scripts; those need the game's own key or opcode map first (unluac accepts an `--opmap`).",
      },
      {
        q: "How do I decompile LuaJIT bytecode?",
        a: "LuaJIT uses its own format, starting with `1B 4C 4A`. Use a LuaJIT decompiler such as luajit-decompiler-v2 instead of unluac.",
      },
      {
        q: "Can I decompile Lua online?",
        a: "Some sites run unluac or luadec on an upload. You get the same output as running it yourself, still with placeholder names when debug info was stripped, and your script goes to their server.",
      },
      {
        q: "What about Roblox (Luau) scripts?",
        a: "Luau bytecode isn't standard Lua, so unluac can't read it. It needs Luau-specific tools.",
      },
    ],
    related: ["reverse-engineering/deobfuscate-javascript", "reverse-engineering/decompile-jar-file", "reverse-engineering/extract-pak-files", "reverse-engineering/decompile-python-exe"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "unluac on SourceForge", href: "https://sourceforge.net/projects/unluac/" },
      { label: "LuaBinaries", href: "https://luabinaries.sourceforge.net/" },
      { label: "Lua 5.4 reference manual (integers and floats)", href: "https://www.lua.org/manual/5.4/manual.html#3.4.1" },
      { label: "Eclipse Temurin JDK downloads", href: "https://adoptium.net/temurin/releases/" },
    ],
  },
  {
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
      "Change gold, items or stats in a game save: compare two saves, find the bytes, undo the scrambling and fix the checksum so the game still loads it.",
    h1: "How to edit a save file (and keep the game loading it)",
    short: "Edit a save file",
    lede: "Find the value in the save, change it, and fix the checks so the game accepts it.",
    answer:
      "Back up the save, make a second save where one value you know has changed, and compare the two in a hex editor such as ImHex to find where that value sits. Most games guard saves with a checksum (often CRC32) and sometimes scramble them, so after the edit you recompute the checksum with a short Python script, or the game calls the file corrupted. Stella (stella.sh) does it end to end on your computer: it reads the save and the game's own code, makes the edit, fixes the checks and loads the result in the game.",
    stellaSteps: [
      "Looks at every save in the game folder side by side and asks the game itself to print what each one holds",
      "Reads the game's own loader with `otool`, the Mac's disassembler, to learn how it scrambles and checks a save",
      "Finds the scrambling key, the CRC32 checksum and a hidden second copy of the gold the game uses to spot tampering",
      "Copies the original save next to it, then writes the new gold and potions with every check recomputed",
      "Loads the edited save in the game and confirms every other value, from level to playtime, reads exactly as before",
    ],
    prompt:
      "Can you edit my Lantern Hollow save so I have 50000 gold and 25 potions? The game is in Games/Lantern Hollow and slot 1 is my save. Just tell me when it's done.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Slot 1 went from 1,380 gold and 2 potions to 50,000 and 25, and the game's own loader read it without a corrupted or tampered warning, with name, level, HP, XP, region, pack and playtime unchanged; the original save was kept as `slot1.sav.before-gold-edit.bak`.",
      note: "The game is a small test game made for this guide, with a scrambled save, a CRC32 checksum and a tamper check. The quiet stretch is sped up 22×.",
      video: {
        src: `${PROOFS}/reverse-engineering/edit-save-file/proof.mp4`,
        cuts: webCuts("reverse-engineering/edit-save-file"),
        poster: `${PROOFS}/reverse-engineering/edit-save-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 29.8,
        speed: 22,
        realDuration: 102,
      },
      moments: [
        { at: 0, text: "Stella on a Mac, with the game folder and its three saves copied into the home folder." },
        { at: 4, text: "The request: 50,000 gold and 25 potions in slot 1 of Lantern Hollow." },
        { at: 11, text: "Stella confirms the job and starts on it." },
        { at: 15.4, text: "About 45 seconds of work, sped up 22×: comparing the saves, reading the game's loader, writing the edit." },
        { at: 17.4, text: "Done: 50,000 gold and 25 potions, the rest of the character unchanged, the tamper checks updated." },
        { at: 20, text: "The original save is kept beside it, with how to put it back." },
      ],
    },
    manualTitle: "Do it yourself (about an hour the first time)",
    manualSteps: [
      {
        title: "Find the save and copy it",
        body: "On Windows, look in `Documents\\My Games`, `%USERPROFILE%\\Saved Games`, `%APPDATA%` and `%LOCALAPPDATA%` under the game's or studio's name. On a Mac, try `~/Library/Application Support/<game>`; on Linux `~/.local/share/<game>` or `~/.config/<game>`, and for Steam games run through Proton, `steamapps/compatdata/<app id>/pfx/drive_c/users/steamuser/`. Copy the whole save folder somewhere safe before changing anything.",
      },
      {
        title: "Make two saves that differ by one value",
        body: "Note your gold, save, spend a known amount, save into another slot. Compare the two files byte by byte: `fc /b slot1.sav slot2.sav` in a Windows Command Prompt, `cmp -l slot1.sav slot2.sav` on Mac or Linux, or open both in [ImHex](https://imhex.werwolv.net/) (free on all three) and use View › Diffing. The offsets that changed are your candidates.",
      },
      {
        title: "Read the value at those offsets",
        body: "Click a changed offset in ImHex and read the Data Inspector: gold is usually a 32-bit little-endian integer, so 1380 shows as `64 05 00 00`. If your known number appears nowhere and the file looks like noise, it's compressed or scrambled. A file starting `1F 8B` is gzip and `78 9C` near the start is zlib; unpack it with Python's `gzip` or `zlib` module, edit, and pack it again. A repeating pattern where you'd expect zeros points to an XOR key.",
      },
      {
        title: "Find the checksum",
        body: "If the game rejects your edited file as corrupted, it checks a hash. Try Python's `zlib.crc32` over the file minus its last 4 bytes and compare it with those 4 bytes, read little-endian; also try the first 4 bytes and the data after the header. When nothing matches, open the game's executable in [Ghidra](https://ghidra-sre.org/), search for the error text (Search › For Strings), follow the reference to the check, and look for the constant `0xEDB88320`, which marks CRC32.",
      },
      {
        title: "Look for a second copy of the value",
        body: "Many games keep a guard copy of money or stats, often XORed with a fixed number. If more bytes changed between your two saves than the value explains, work out how they follow the value and update both.",
      },
      {
        title: "Write the edit with a script and test it",
        body: "Write the change in a few lines of Python: read the file, unscramble it, `struct.pack_into('<I', data, offset, 50000)`, write any guard copy, scramble again, recompute the checksum and save it under the original name. Load it in the game.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Is there a save game editor that works for every game?",
        a: "No single editor knows every format, but the method above works on any game: compare saves, find the bytes, fix the checksum. Popular games have their own editors, such as PKHeX for Pokémon, and some games save in plain text, like Stardew Valley, whose saves are XML files in `%appdata%\\StardewValley\\Saves`.",
      },
      {
        q: "Why does the game say my save is corrupted after I edited it?",
        a: "It stores a checksum of the save and the numbers no longer match. Recompute it after every edit (CRC32 is the most common), and update any second copy of the value the game keeps.",
      },
      {
        q: "How do I find which bytes hold my gold?",
        a: "Search the save for your exact gold amount as a 16-bit and 32-bit little-endian number. If that finds nothing, change the amount in the game, save again and compare the two files: the bytes that moved are the ones to look at.",
      },
      {
        q: "Can I edit a save file online?",
        a: "Websites exist for a few popular games. For anything else, ImHex and a short Python script on your own computer do the job.",
      },
    ],
    related: ["reverse-engineering/reverse-engineer-a-file-format", "game-mods/turn-on-cheats-in-minecraft-world", "game-mods/fix-corrupted-minecraft-world"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "ImHex hex editor", href: "https://imhex.werwolv.net/" },
      { label: "Ghidra", href: "https://ghidra-sre.org/" },
      { label: "Python zlib.crc32", href: "https://docs.python.org/3/library/zlib.html" },
      { label: "Python struct", href: "https://docs.python.org/3/library/struct.html" },
      { label: "fc (Windows)", href: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/fc" },
      { label: "cmp (Linux man page)", href: "https://man7.org/linux/man-pages/man1/cmp.1.html" },
    ],
  },
  {
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
      "Pull the textures, sprites, music and sound effects out of a Unity game's data folder as PNG and WAV files with AssetRipper, AssetStudio or UnityPy.",
    h1: "How to extract assets from a Unity game",
    short: "Extract Unity game assets",
    lede: "Every sprite and sound in a Unity game's data folder, as PNGs and playable audio.",
    answer:
      "A Unity game keeps its art and sound inside the `<Game>_Data` folder in `.assets`, `.resS` and `.resource` files. AssetRipper (Windows, Mac, Linux) or AssetStudio (Windows) opens that folder and exports textures and sprites as PNG and audio as WAV or OGG; UnityPy does the same from a Python script. Stella (stella.sh) does it end to end on your computer: it reads the game's files, exports every picture and sound, converts the audio to WAV and sorts the game's own art from the engine's stock images.",
    stellaSteps: [
      "Looks at the game folder and finds a Windows build, which a Mac can't run, so works from the data files alone",
      "Installs UnityPy in a private folder and lists every texture, sprite and audio clip in the game's data",
      "Exports 448 PNGs with transparency intact: whole textures, sprites cut out of sprite sheets, and engine stock images in a folder of their own",
      "Decodes the FMOD sound banks the game uses and saves all 12 music tracks and sound effects as WAV",
      "Puts everything in one folder on the Desktop, leaves the game's files unchanged and removes its working tools afterwards",
    ],
    prompt:
      "Can you get all the art and sounds out of the game Unguided in my Games folder? I'd like the pictures as PNGs and the music and sound effects as files I can play, in a folder on my Desktop.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "An “Unguided Assets” folder with 448 PNGs, covering all 380 of the game's textures at their exact sizes and colours, and all 12 audio clips as WAV files of the right length; the game's own files were byte-for-byte unchanged.",
      note: "The game is Unguided by the Unguided Team (Windows build, Unity 2022.3; code MIT, artwork CC BY 4.0). The quiet stretch is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/extract-unity-game-assets/proof.mp4`,
        cuts: webCuts("reverse-engineering/extract-unity-game-assets"),
        poster: `${PROOFS}/reverse-engineering/extract-unity-game-assets/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.2,
        speed: 30,
        realDuration: 168,
      },
      moments: [
        { at: 0, text: "Stella on a Mac, with the Windows build of Unguided in the Games folder." },
        { at: 4, text: "The request: all the art as PNGs and the music and sound effects as playable files." },
        { at: 11, text: "Stella starts a task for it and says the game files stay unchanged." },
        { at: 15.9, text: "About two minutes of work, sped up 30×: reading the data files, exporting images, decoding the sound banks." },
        { at: 19.5, text: "Done: 448 PNGs, sorted into the game's own art, cut-out sprites and engine stock images." },
        { at: 24, text: "12 WAV files: four music tracks, including Satie's Gymnopédie No. 1, and eight sound effects." },
      ],
    },
    manualTitle: "Do it yourself (about 20 minutes)",
    manualSteps: [
      {
        title: "Find the data folder",
        body: "Next to the game's `.exe` on Windows there's a `<Game>_Data` folder; on a Mac it's inside the app at `Contents/Resources/Data` (right-click the app, Show Package Contents); on Linux it sits beside the executable. For a Steam game, right-click it in your library and choose Manage › Browse local files. Copy the folder if you want to work on it elsewhere.",
      },
      {
        title: "Open it in AssetRipper",
        body: "Download [AssetRipper](https://github.com/AssetRipper/AssetRipper/releases) for your system and run it; its window opens in your web browser. Choose File › Open Folder and pick the `_Data` folder. Once it has loaded, open the Export menu and export the primary content to get plain PNGs and audio rather than a whole Unity project.",
      },
      {
        title: "Or use AssetStudio on Windows",
        body: "[AssetStudioMod](https://github.com/aelurum/AssetStudio) loads the folder with File › Load folder and exports from the Export menu. Its command-line version also runs on Mac and Linux with the .NET runtime: `AssetStudioModCLI \"Game_Data\" -t tex2d,sprite,audio -g type -o out`.",
      },
      {
        title: "Or script it with UnityPy",
        body: "`pip install UnityPy`, then load the folder with `UnityPy.load(\"Game_Data\")`, loop over `env.objects`, and save each Texture2D or Sprite with `obj.read().image.save(name + \".png\")`. For AudioClip objects, `clip.samples` gives the decoded sounds as WAV bytes.",
      },
      {
        title: "Convert the audio if it won't play",
        body: "Many games store sound in FMOD's FSB5 format inside a `.resource` file. Tools that decode it write WAV or OGG; if you're left with `.fsb` files, [vgmstream](https://vgmstream.org/) or the `python-fsb5` package converts them. Check a few files play all the way through.",
      },
      {
        title: "Sort the output",
        body: "Expect duplicates and engine images (UI masks, default particles, font atlases) mixed in with the game's art. Sprites in a sheet come out as both the full sheet and the cut pieces, so keep whichever you need.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the best Unity asset extractor?",
        a: "AssetRipper for most people: it's free, runs on Windows, Mac and Linux and can also rebuild a Unity project. AssetStudio's maintained fork is quick for browsing on Windows. UnityPy suits batch jobs and scripts.",
      },
      {
        q: "Can I extract assets from a Unity WebGL game?",
        a: "Yes. Save the `.data` (or `.data.unityweb`/`.data.br`) file the page loads from your browser's developer tools, decompress it if it ends in `.br` or `.gz`, and open it in AssetRipper or UnityPy like any other data file.",
      },
      {
        q: "Why are some exported images blank or tiny?",
        a: "Unity ships placeholder textures (1×1 white pixels, masks) and font atlases that look empty in an image viewer. Your game's real art is usually the larger files named after characters, tiles and effects.",
      },
      {
        q: "Does this work on IL2CPP games?",
        a: "For art and sound, yes: IL2CPP only changes how the code is stored, and the assets sit in the same data files either way.",
      },
    ],
    related: ["reverse-engineering/edit-save-file", "reverse-engineering/reverse-engineer-a-file-format", "game-mods/install-minecraft-resource-pack"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "AssetRipper", href: "https://github.com/AssetRipper/AssetRipper" },
      { label: "AssetStudioMod", href: "https://github.com/aelurum/AssetStudio" },
      { label: "UnityPy", href: "https://github.com/K0lb3/UnityPy" },
      { label: "python-fsb5", href: "https://github.com/HearthSim/python-fsb5" },
      { label: "vgmstream", href: "https://vgmstream.org/" },
      { label: "Unguided (test game)", href: "https://github.com/Unguided-Team/unguided-game" },
    ],
  },
  {
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
      "Turn a Unity game's Assembly-CSharp.dll back into readable C# with ILSpy, find the method you want and patch it, with the IL2CPP route covered too.",
    h1: "How to decompile a Unity game (and change how it plays)",
    short: "Decompile a Unity game",
    lede: "Read a Unity game's C# code, then change one thing about how it plays.",
    answer:
      "If the game's `_Data/Managed` folder holds `Assembly-CSharp.dll`, it's a Mono build and ILSpy (or dnSpyEx on Windows) turns that file back into readable C#; edit a method and save the DLL to change the game. If you see `GameAssembly.dll` and `il2cpp_data` instead, Il2CppDumper recovers class and method names but not the code. Stella (stella.sh) does a Mono game end to end on your computer: it decompiles the code into a folder, finds the right method, patches the DLL, backs up the original and checks the result.",
    stellaSteps: [
      "Checks the game is a Mono build with its own code in `Assembly-CSharp.dll`, and that it has no multiplayer or anti-cheat code",
      "Installs ILSpy's command-line tool in a private folder and decompiles the game into 35 C# files plus a project file on the Desktop",
      "Traces every source of damage to one method, `PlayerController.TakeDamage`, and reads its IL instructions",
      "Copies the original DLL to a backup folder with restore steps, then changes one instruction so a hit no longer subtracts health",
      "Decompiles the patched DLL again to confirm it loads cleanly and differs from the original by exactly one byte",
    ],
    prompt:
      "Can you get the C# code out of the game Unguided in my Games folder so I can read it, and change it so my character never loses health when hit? Put the code in a folder on my Desktop.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "An “Unguided Source” folder with the C# for all 34 of the game's classes, and a patched `Assembly-CSharp.dll` in which `TakeDamage` keeps health unchanged, every other method byte-identical and the original backed up; the patch was checked by reading the DLL's code back.",
      note: "The game is Unguided by the Unguided Team (Windows build, Unity 2022.3, Mono; code MIT, artwork CC BY 4.0). The quiet stretch is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-unity-game/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-unity-game"),
        poster: `${PROOFS}/reverse-engineering/decompile-unity-game/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 29.6,
        speed: 30,
        realDuration: 143,
      },
      moments: [
        { at: 0, text: "Stella on a Mac, with the Windows build of Unguided in the Games folder." },
        { at: 4, text: "The request: the game's C# code in a Desktop folder, and no more health lost when hit." },
        { at: 11, text: "Stella starts: decompile first, back up the original, then patch." },
        { at: 15.7, text: "About 80 seconds of work, sped up 30×: ILSpy, finding TakeDamage, a one-instruction patch, a re-check." },
        { at: 18.2, text: "Done: 35 C# files on the Desktop, and hits now leave health where it was." },
        { at: 22, text: "The original DLL is in a backup folder with restore steps." },
      ],
    },
    manualTitle: "Do it yourself (about 30 minutes)",
    manualSteps: [
      {
        title: "Check which kind of build it is",
        body: "Open `<Game>_Data/Managed` (on a Mac, inside the app under `Contents/Resources/Data/Managed`). If `Assembly-CSharp.dll` is there, it's Mono and fully decompilable. If instead there's `GameAssembly.dll` beside the game and `<Game>_Data/il2cpp_data/Metadata/global-metadata.dat`, it's IL2CPP: skip to the last step.",
      },
      {
        title: "Back up the DLL",
        body: "Copy `Assembly-CSharp.dll` somewhere outside the game folder before changing anything. Steam's Verify integrity of game files also puts the original back.",
      },
      {
        title: "Decompile it to C#",
        body: "On Windows, open the DLL in [ILSpy](https://github.com/icsharpcode/ILSpy) or [dnSpyEx](https://github.com/dnSpyEx/dnSpy) and browse the classes. On any system with the [.NET SDK](https://dotnet.microsoft.com/en-us/download), install the command-line version with `dotnet tool install -g ilspycmd`, then run `ilspycmd -p -o GameSource Assembly-CSharp.dll` to get a folder of .cs files and a project file.",
      },
      {
        title: "Find the code that does what you want",
        body: "Search the source for the obvious words (`health`, `damage`, `gold`, `speed`). Most numbers you'd tune, such as speed and max health, are set in the Unity editor and saved with the scene, so changing their default in C# does nothing; change the method that uses them instead.",
      },
      {
        title: "Patch the method",
        body: "In dnSpyEx, right-click the method, choose Edit Method (C#), make the change, Compile, then File › Save Module. Without dnSpyEx, view the method's IL with `ilspycmd -il -t PlayerController Assembly-CSharp.dll` and change the instruction with a hex editor or a small [Mono.Cecil](https://github.com/jbevain/cecil) script; swapping a `sub` for a `pop` keeps the value unchanged.",
      },
      {
        title: "For IL2CPP games, dump the names",
        body: "Run [Il2CppDumper](https://github.com/Perfare/Il2CppDumper) on `GameAssembly.dll` and `global-metadata.dat`. It writes dummy DLLs with every class, field and method name plus their addresses, but no method bodies. Load those in ILSpy to read the structure, then mod at runtime with [BepInEx](https://github.com/BepInEx/BepInEx) and Harmony patches.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can every Unity game be decompiled?",
        a: "Mono builds come back as near-original C#, minus comments. IL2CPP builds compile the code to native machine code, so you get names and structure from Il2CppDumper and the logic only as assembly in Ghidra or IDA.",
      },
      {
        q: "Can I rebuild the whole Unity project from a game?",
        a: "AssetRipper exports a Unity project with scenes, assets and decompiled scripts that opens in the editor, though it usually needs fixes before it builds. For changing gameplay, patching the one DLL is far quicker.",
      },
      {
        q: "Is dnSpy still maintained?",
        a: "The original dnSpy was archived in 2020. dnSpyEx is the maintained fork and handles current Unity Mono DLLs; ILSpy is the main alternative and has a Mac and Linux command-line tool.",
      },
      {
        q: "Will my patched DLL survive a game update?",
        a: "No, an update replaces `Assembly-CSharp.dll`. Keep your patch as a script (or as a BepInEx plugin) so you can apply it again.",
      },
    ],
    related: ["reverse-engineering/extract-unity-game-assets", "reverse-engineering/edit-save-file", "reverse-engineering/decompile-godot-game"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "ILSpy", href: "https://github.com/icsharpcode/ILSpy" },
      { label: "ilspycmd on NuGet", href: "https://www.nuget.org/packages/ilspycmd" },
      { label: "dnSpyEx", href: "https://github.com/dnSpyEx/dnSpy" },
      { label: "Il2CppDumper", href: "https://github.com/Perfare/Il2CppDumper" },
      { label: "BepInEx", href: "https://github.com/BepInEx/BepInEx" },
      { label: "Mono.Cecil", href: "https://github.com/jbevain/cecil" },
    ],
  },
  {
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
      "Recover an editable Godot project from an exported game's .pck or .exe with GDRE Tools: scripts, scenes, textures and sounds, opened in the matching editor.",
    h1: "Godot decompiler: recover a project from an exported game",
    short: "Decompile a Godot game",
    lede: "From an exported .pck or .exe back to a project the Godot editor opens.",
    answer:
      "GDRE Tools (gdsdecomp) is the Godot decompiler: point its Recover project command at the game's `.pck` or `.exe` and it unpacks the files, decompiles GDScript, turns binary scenes back into `.tscn` and imported textures back into images, and writes a `project.godot`. Open the result in the Godot version the game was built with. Stella (stella.sh) does it end to end on your computer: it finds the engine version, runs the recovery, opens the project in the matching editor to check it imports, and tells you what came back.",
    stellaSteps: [
      "Reads the game's `.pck` header and executable to learn it was built with Godot 4.2.1",
      "Downloads GDRE Tools into a private folder and runs a full project recovery from the command line into a Desktop folder",
      "Checks what came back: all 37 scripts as written, every scene and model, and which textures were rebuilt from compressed copies",
      "Downloads Godot 4.2.1, imports a copy of the project headless and switches off one web-only add-on the game didn't ship, until it imports with no errors",
      "Leaves the original game unchanged and says which editor version to open it with and what the first-run messages mean",
    ],
    prompt:
      "I'd like to see how the game Marble in my Games folder was made. Can you turn it back into a Godot project I can open in the Godot editor? Put it in a folder on my Desktop.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A “Marble (Godot project)” folder with a text `project.godot` and the main scene set, all 33 of the developer's scripts matching the original source, all 31 scenes back as `.tscn`, all 26 images at their original sizes and all 9 sounds; it imported in Godot 4.2.1 with no errors, and the game files were unchanged.",
      note: "The game is Marble 1.6.1 by Mechanical Flower (Windows export, Godot 4.2.1; code MIT, assets MIT, CC0, CC BY 3.0, and icons by Icons8, icons8.com). The quiet stretch is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decompile-godot-game/proof.mp4`,
        cuts: webCuts("reverse-engineering/decompile-godot-game"),
        poster: `${PROOFS}/reverse-engineering/decompile-godot-game/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.3,
        speed: 30,
        realDuration: 184,
      },
      moments: [
        { at: 0, text: "Stella on a Mac, with Marble's Windows export (Marble.exe and Marble.pck) in the Games folder." },
        { at: 4, text: "The request: turn the game back into a Godot project in a Desktop folder." },
        { at: 10.7, text: "Stella starts a task for it, leaving the original game alone." },
        { at: 15.5, text: "About two minutes of work, sped up 30×: GDRE Tools recovery, then a test import in Godot 4.2.1." },
        { at: 19.7, text: "Done: an editable project that imports with no errors, plus the editor version to use." },
        { at: 24, text: "What to expect: four textures rebuilt from compressed copies, and one first-run message explained." },
      ],
    },
    manualTitle: "Do it yourself (about 15 minutes)",
    manualSteps: [
      {
        title: "Find the game's data",
        body: "A Godot export is an executable plus a `.pck` file with the same name, or a single executable with the pack embedded. On a Mac the pack is inside the app at `Contents/Resources/<name>.pck`; for Android it's inside the APK. Copy it somewhere to work on.",
      },
      {
        title: "Get GDRE Tools",
        body: "Download the build for your system from the [gdsdecomp releases](https://github.com/GDRETools/gdsdecomp/releases) (Windows, Mac and Linux; on Windows also `scoop install gdsdecomp`). On a Mac, if the app won't open after downloading, right-click it and choose Open once.",
      },
      {
        title: "Recover the project",
        body: "In the app, choose RE Tools › Recover project… and pick the `.pck` or `.exe`, or drag it onto the window. From a terminal: `gdre_tools --headless --recover=Game.pck --output=GameProject`. The log at the end lists the engine version and any files it couldn't convert back exactly.",
      },
      {
        title: "Open it in the matching editor",
        body: "Download the same Godot version from the [Godot archive](https://godotengine.org/download/archive/) (4.2.1 for this game), then choose Import in the Project Manager and pick the recovered `project.godot`. A newer 4.x editor usually works but offers to convert the project, so make a copy first.",
      },
      {
        title: "Fix what's left",
        body: "Look at the Output panel after the first import. Add-ons that only ran in the editor or for one platform may be missing; turn them off under Project › Project Settings › Plugins. Textures that shipped compressed come back as close copies rather than the original files.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can every Godot game be decompiled?",
        a: "Most can. Scripts exported as text come back exactly, comments included; scripts exported as bytecode or binary tokens come back as working code without comments. C# (.NET) Godot games keep their code in a separate DLL, which you open with ILSpy instead.",
      },
      {
        q: "What if the .pck is encrypted?",
        a: "Godot encrypts packs with a 256-bit key built into the executable. Once you have that key as 64 hex characters, pass it with `--key=` on the command line or enter it in the app before recovery.",
      },
      {
        q: "How do I just extract files from a .pck without a full recovery?",
        a: "Use `gdre_tools --headless --extract=Game.pck --output=out`, or list the contents first with `--list-files=Game.pck`. You get the raw exported files: binary `.scn` scenes and `.ctex` textures that need converting before the editor uses them.",
      },
      {
        q: "Which Godot version made the game?",
        a: "GDRE Tools prints it during recovery. You can also run `strings` on the executable and look for a version like `4.2.1.stable`.",
      },
    ],
    related: ["reverse-engineering/decompile-unity-game", "reverse-engineering/extract-unity-game-assets", "reverse-engineering/extract-renpy-rpa"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "GDRE Tools (gdsdecomp)", href: "https://github.com/GDRETools/gdsdecomp" },
      { label: "GDRE Tools releases", href: "https://github.com/GDRETools/gdsdecomp/releases" },
      { label: "Godot download archive", href: "https://godotengine.org/download/archive/" },
      { label: "Godot docs: exporting packs", href: "https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html" },
      { label: "Marble (test game)", href: "https://github.com/MechanicalFlower/Marble" },
    ],
  },
  {
    slug: "extract-renpy-rpa",
    niche: "reverse-engineering",
    searchPhrases: [
      "rpa extractor",
      "renpy decompiler",
      "extract rpa files",
      "rpyc to rpy",
      "unrpa",
      "how to open rpa files",
    ],
    title: "RPA extractor: unpack a Ren'Py game and decompile .rpyc",
    description:
      "Unpack a Ren'Py game's archive.rpa with unrpa and turn the compiled .rpyc scripts back into readable .rpy files with unrpyc, on Windows, Mac or Linux.",
    h1: "RPA extractor and Ren'Py decompiler: get a game's files and script back",
    short: "Extract a Ren'Py .rpa",
    lede: "A Ren'Py game's images, music and readable script, out of archive.rpa.",
    answer:
      "Ren'Py games pack their images, sound and compiled scripts into `.rpa` archives inside the `game` folder. unrpa extracts them (`unrpa -mp out archive.rpa`), and unrpyc turns the compiled `.rpyc` scripts back into readable `.rpy` files with the dialogue, labels and menus. Both are free Python tools. Stella (stella.sh) does it end to end on your computer: it installs the tools in a private folder, unpacks the archive with its folder layout, decompiles every script and leaves the game folder untouched.",
    stellaSteps: [
      "Finds `archive.rpa` in the game folder and reads its header to confirm the archive format (RPA-3.0)",
      "Installs unrpa in a private Python environment and downloads the current unrpyc, made for Ren'Py 8",
      "Extracts all 65 files into a Desktop folder, keeping the `images` and `gui` folders as the game had them",
      "Decompiles the four compiled scripts into `.rpy` files next to them, with no errors",
      "Leaves the original game folder unchanged and says where the result is",
    ],
    prompt:
      "I have the Ren'Py game The Question in Games/The Question. Can you unpack its archive.rpa and turn the compiled scripts back into readable .rpy files? Put everything in a folder on my Desktop and just tell me where it is.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A “The Question - unpacked” folder with all 65 archived files byte-for-byte identical to the originals, and `script.rpy`, `screens.rpy`, `gui.rpy` and `options.rpy` decompiled with every string and all six story labels of the original source; the archive was unchanged.",
      note: "The game is The Question, the demo that ships with Ren'Py 8.3.7 (MIT, artwork included), packed into archive.rpa the way Ren'Py's own build tool does. The quiet stretch is sped up 21×.",
      video: {
        src: `${PROOFS}/reverse-engineering/extract-renpy-rpa/proof.mp4`,
        cuts: webCuts("reverse-engineering/extract-renpy-rpa"),
        poster: `${PROOFS}/reverse-engineering/extract-renpy-rpa/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.2,
        speed: 21,
        realDuration: 102,
      },
      moments: [
        { at: 0, text: "Stella on a Mac, with The Question's game folder holding only archive.rpa." },
        { at: 4, text: "The request: unpack the archive and turn the scripts back into readable .rpy files." },
        { at: 10.8, text: "Stella starts a task for it." },
        { at: 15.6, text: "About 45 seconds of work, sped up 21×: installing unrpa and unrpyc, extracting, decompiling." },
        { at: 17.5, text: "Done: all 65 files out with their folders, and all four scripts readable again." },
      ],
    },
    manualTitle: "Do it yourself (about 10 minutes)",
    manualSteps: [
      {
        title: "Find the archives",
        body: "Open the game's folder and then `game`. On a Mac, right-click the app, choose Show Package Contents and go to `Contents/Resources/autorun/game`. Look for `.rpa` files (often `archive.rpa`, sometimes `images.rpa` and `scripts.rpa`) and any loose `.rpyc` files.",
      },
      {
        title: "Install unrpa",
        body: "With Python 3 installed, run `python3 -m pip install unrpa` (on Windows: `py -3 -m pip install unrpa`). Using a virtual environment keeps it separate from the rest of your system: `python3 -m venv rpa && rpa/bin/pip install unrpa`.",
      },
      {
        title: "Extract the archive",
        body: "Run `unrpa -mp \"out\" \"game/archive.rpa\"`: `-m` keeps the folder structure and `-p` sets the output folder. Add `-l` first to list the contents without extracting. You get the images, audio, fonts and `.rpyc` scripts exactly as packed.",
      },
      {
        title: "Decompile the scripts",
        body: "Download [unrpyc](https://github.com/CensoredUsername/unrpyc) (the `master` branch or a v2 release for Ren'Py 8 games, the `legacy` branch for games made before Ren'Py 6.18) and run `python3 unrpyc.py out/` to turn every `.rpyc` into an `.rpy` beside it. Add `-t french` to write a translated version if the game has a `tl/french` folder.",
      },
      {
        title: "Read or change the script",
        body: "Open `script.rpy` in any text editor: labels, dialogue, menus and jumps are all there. To play a changed version, copy everything you extracted, with your edited `.rpy` files, into the game's `game` folder and move the `.rpa` out of it; Ren'Py compiles the scripts on the next launch.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the best RPA extractor?",
        a: "unrpa is the standard one: free, scriptable, on Windows, Mac and Linux, and it handles RPA-2.0 and RPA-3.0. rpatool does the same and can also build archives. Both need Python 3.",
      },
      {
        q: "unrpyc says the file is from an unsupported version. What now?",
        a: "Check which Ren'Py made the game (the `renpy` folder's version or the log). Ren'Py 8 games need unrpyc v2 from the master branch, Ren'Py 7 and older need the legacy branch. Very new releases sometimes need the latest dev branch.",
      },
      {
        q: "Can I unpack an RPA without installing Python?",
        a: "unrpyc releases include `un.rpyc`, a file you drop into the game's `game` folder: the next time the game starts, it decompiles the scripts itself. For the archive itself you still need an extractor such as unrpa.",
      },
      {
        q: "Why do some .rpa files fail to open?",
        a: "Some developers change the header or the key to block extractors. unrpa reports the header it found; the game's own loader code in the `renpy` folder or a custom `.rpy` shows how that variant is read.",
      },
    ],
    related: ["reverse-engineering/decompile-godot-game", "reverse-engineering/extract-unity-game-assets", "reverse-engineering/edit-save-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "unrpa", href: "https://github.com/Lattyware/unrpa" },
      { label: "unrpa on PyPI", href: "https://pypi.org/project/unrpa/" },
      { label: "unrpyc", href: "https://github.com/CensoredUsername/unrpyc" },
      { label: "rpatool", href: "https://github.com/Shizmob/rpatool" },
      { label: "Ren'Py: building distributions", href: "https://www.renpy.org/doc/html/build.html" },
    ],
  },
  {
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
      "Unpack an Unreal Engine game's .pak with repak, change a setting and pack it as a small _P mod that loads over the game, or let Stella (stella.sh) do it.",
    h1: "Extract Unreal Engine .pak files and pack a mod",
    short: "Extract .pak files and mod",
    lede: "Get the files out of an Unreal game's pak, change them and load them back as a mod.",
    answer:
      "Unreal Engine games keep their content in .pak archives under `Content\\Paks`. The free repak tool lists and unpacks them (`repak unpack Game-Windows.pak`), and packs a folder back into a pak. To change a game without touching its files, pack only the edited files, at the same paths, into a new pak whose name ends in `_P` and drop it in `Paks\\~mods`; the game loads it last and its files win. Stella (stella.sh) finds the right files, works out the change and builds the mod pak for you.",
    stellaSteps: [
      "Downloads the standalone repak and reads the game pak's version, mount point and file list, without changing the pak",
      "Finds where burn time comes from: BaseBurnSeconds in DefaultGame.ini, multiplied by each lantern's factor in Lanterns.json",
      "Doubles only the base value, 180 to 360 seconds, so every lantern lasts exactly twice as long instead of four times",
      "Packs that one file at its original path into LongerLanterns_P.pak in Paks\\~mods, in the same pak format as the game's (version 11, Zlib)",
      "Opens the mod with repak and with its own pak reader to confirm it reads cleanly, then lists the before and after times",
    ],
    prompt:
      "Lanternfall's lanterns run out way too fast. I copied the game's files to Documents\\Lanternfall. Make a small mod pak that makes every lantern burn twice as long, without touching the game's own pak, so I can delete the mod to undo it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 3 minutes Stella made LongerLanterns_P.pak, a 794-byte mod holding one edited config file, in Content\\Paks\\~mods. Checked afterwards by us with repak: the game's pak was unchanged, the mod uses the game's pak version and paths, and laid over the game's pak it makes all four lanterns burn exactly twice as long (tin 3 to 6 minutes, miner's 6 to 12) with every other setting unchanged.",
      note: "Lanternfall is a made-up Unreal Engine 5 game for this test; its 12-file pak was built with repak like a shipping pak (version 11, Zlib, mount point ../../../). Burn time is a base value in DefaultGame.ini times a per-lantern multiplier in a data table, so doubling both would make lanterns last 4×. The wait is shown at up to 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/extract-pak-files/proof.mp4`,
        cuts: webCuts("reverse-engineering/extract-pak-files"),
        poster: `${PROOFS}/reverse-engineering/extract-pak-files/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.5,
        speed: 30,
        realDuration: 179,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Documents\\Lanternfall holds the game's Content\\Paks folder with its one .pak." },
        { at: 4, text: "The prompt: a small mod pak that makes every lantern burn twice as long, without touching the game's pak." },
        { at: 11, text: "Stella starts a task to find where burn times are set and pack the change as a separate mod." },
        { at: 16.1, text: "Reading the pak, tracing the burn time and building the mod pak, sped up 30×." },
        { at: 19.7, text: "Done: LongerLanterns_P.pak changes one setting, and a table shows each lantern's time doubling." },
        { at: 24.9, text: "It says where to copy the mod in the real install, how to undo it, and what could stop it working." },
      ],
    },
    manualTitle: "Make the mod yourself",
    manualSteps: [
      {
        title: "Get repak and look inside",
        body: "Download repak from its [GitHub releases](https://github.com/trumank/repak/releases); it's one exe, nothing to install. In the game's `Content\\Paks` folder run `repak info Game-Windows.pak` for the pak version and mount point, and `repak list Game-Windows.pak` for the file list. If it says the index is encrypted, you need the game's AES key: `repak --aes-key 0x… unpack`.",
      },
      {
        title: "Unpack it",
        body: "`repak unpack Game-Windows.pak -o C:\\pakout` extracts everything. Configs (`.ini`) and JSON data are plain text; `.uasset`, `.uexp` and `.umap` are cooked binary assets, which you browse and export with [FModel](https://fmodel.app/) rather than edit by hand.",
      },
      {
        title: "Make the change",
        body: "Copy only the files you'll edit into a new folder, keeping the exact path inside the pak, for example `mod\\Lanternfall\\Config\\DefaultGame.ini`. Edit them, and check whether a value is combined with another one elsewhere before you change it.",
      },
      {
        title: "Pack the mod",
        body: "Run `repak pack --version V11 mod LongerLanterns_P.pak`, using the version `repak info` showed for the game's pak; the mount point defaults to `../../../`, which matches most games. The `_P` at the end of the name is what makes Unreal load it over the game's own pak.",
      },
      {
        title: "Install and test",
        body: "Create `Content\\Paks\\~mods` and put the mod pak there. Start the game and check the change; to undo, delete the pak. Games on Unreal Engine 5 that ship `.utoc` and `.ucas` files next to the pak (IoStore) need their assets modded with IoStore tools instead; config and loose-file mods still work as plain paks in many of them.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I open a .pak file?",
        a: "For Unreal Engine games use repak (command line) or FModel (a viewer that browses and exports assets, including UE5 IoStore). Other engines use .pak too, with different formats: Baldur's Gate 3 paks open with its own modding tools, and Quake-style paks with a general archive tool.",
      },
      {
        q: "Why doesn't my mod pak do anything?",
        a: "Usually the name doesn't end in `_P`, the file paths inside don't match the game's (check the mount point and folder names with `repak list` on both), or the pak version differs from the game's.",
      },
      {
        q: "Can I use UnrealPak instead of repak?",
        a: "Yes. UnrealPak.exe comes with the Unreal Engine from the Epic Games Launcher, in `Engine\\Binaries\\Win64`. repak does the same jobs without installing the engine.",
      },
      {
        q: "Is it safe to edit the game's own pak?",
        a: "It works, but a game update or file verification replaces it and you lose your change. A separate `_P` mod pak survives updates and is removed by deleting one file.",
      },
    ],
    related: ["reverse-engineering/extract-electron-asar", "reverse-engineering/decompile-lua", "reverse-engineering/edit-save-file", "reverse-engineering/decompile-unity-game"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "repak on GitHub (commands, versions)", href: "https://github.com/trumank/repak" },
      { label: "FModel", href: "https://github.com/4sval/FModel" },
      { label: "Pak patching and the _P suffix (UE modding guide)", href: "https://buckminsterfullerene02.github.io/dev-guide/Basis/PakPatching.html" },
    ],
  },
  {
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
      "Work out an unknown binary file from a program that's gone: find the header, records, dates and text encoding, then write a converter to CSV.",
    h1: "How to reverse engineer a file format (and get your data out)",
    short: "Reverse engineer a file format",
    lede: "Work out the layout of an old binary file and turn it into a spreadsheet.",
    answer:
      "Open the file in a hex editor such as ImHex, find the header (a signature, a record count, offsets), then line up one record against something you know, like a printout or a value you remember, to learn how dates, amounts and text are stored. Old programs often keep dates as days since 1899-12-30, money in pennies and text in Windows-1252. Write the layout down as a short Python script and it becomes your converter. Stella (stella.sh) does this end to end on your computer: it decodes the file, writes the CSV and leaves the converter beside it.",
    stellaSteps: [
      "Finds the file, which was a folder deeper than the request said, and reads it in hex next to the old printed register",
      "Works out the header, the category table and the record layout: dates as days since 1899-12-30, amounts in pennies, Windows-1252 text",
      "Checks the decoded March 2004 entries against the printout, reconciled marks included, to the penny",
      "Writes `household.csv` and a converter script beside the original and leaves the `.dat` file untouched",
      "Points out the four entries marked “duplicate” that carry an extra flag, so you can look at them before totalling",
    ],
    prompt:
      "I have a household.dat file from TallyHome, an old money program that doesn't exist anymore. It's in Documents/Old Finances. Can you turn it into a CSV spreadsheet and leave me a script that converts these files? Just the result, please.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "`household.csv` with all 223 transactions: the 219 live ones matched the answer key on date, payee, category and amount, accents included, and the four deleted ones were set apart by their flag; `tallyhome_to_csv.py` converted a second TallyHome file it had never seen just as accurately.",
      note: "TallyHome and its file are made up for this guide, with a printed register for one month. The quiet stretch is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/reverse-engineer-a-file-format/proof.mp4`,
        cuts: webCuts("reverse-engineering/reverse-engineer-a-file-format"),
        poster: `${PROOFS}/reverse-engineering/reverse-engineer-a-file-format/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.9,
        speed: 30,
        realDuration: 148,
      },
      moments: [
        { at: 0, text: "Stella on a Mac. The old file and a printed register from the program are in Documents/Old Finances." },
        { at: 4, text: "The request: turn household.dat into a CSV and leave a converter script." },
        { at: 11, text: "Stella confirms and starts." },
        { at: 15.5, text: "About 90 seconds of work, sped up 30×: reading the bytes, matching them to the printout, writing the converter." },
        { at: 18.5, text: "Done: 223 transactions from September 2003 to April 2005, March 2004 matching the printout to the penny." },
        { at: 23, text: "Four entries marked “duplicate” carry an extra flag; Stella lists them so they can be checked before totalling." },
      ],
    },
    manualTitle: "Do it yourself (an afternoon)",
    manualSteps: [
      {
        title: "Copy the file and gather clues",
        body: "Work on a copy. Collect anything that shows the same data in readable form: a printout, an old export, a screenshot, a total you remember. One known record is enough to anchor everything else. Running `file household.dat` on Mac or Linux sometimes names the format outright, and a search for the program name plus \"file format\" may turn up notes others have written.",
      },
      {
        title: "Read the header in a hex editor",
        body: "Open the file in [ImHex](https://imhex.werwolv.net/) (Windows, Mac, Linux). The first bytes are usually a signature (`THDB` here), then a version and small numbers. Check each 32-bit little-endian number against the file: one is often the record count and others point to where tables start.",
      },
      {
        title: "Line up one record with what you know",
        body: "Find a payee or name you recognise as text, then look at the bytes just before it. Amounts are usually whole pennies as a signed 32-bit integer (−520.00 is `E0 34 FF FF`). Dates are often a day count: 38048 days after 1899-12-30 is 2 March 2004, the same scheme as Excel and Delphi. A byte before each string usually gives its length.",
      },
      {
        title: "Describe the layout as a pattern",
        body: "Write the structure in ImHex's pattern language or as a [Kaitai Struct](https://kaitai.io/) file and watch it colour the whole file. Gaps between records that don't decode point to padding (records here are padded to 4 bytes) or a field you haven't named yet, such as a flags byte for cleared and deleted entries.",
      },
      {
        title: "Decode text in the right encoding",
        body: "Programs from the Windows 95–XP era wrote Windows-1252, not UTF-8: `é` is the single byte `E9`. In Python, use `bytes.decode('cp1252')`. If names come out with `Ã©` or a replacement character, the encoding is wrong.",
      },
      {
        title: "Write the converter and test it",
        body: "Turn the layout into a Python script with `struct.unpack_from` and the `csv` module, writing UTF-8 so Excel and Numbers open it cleanly. Compare its output with your printout, row by row and with the totals, then run it on any other files from the same program.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I open a .dat file?",
        a: "`.dat` only means data, so it depends on the program that wrote it. Try a text editor first; if you see readable text, it may already be CSV or XML. If it's mostly unreadable, open it in a hex editor and look for a readable signature in the first bytes, then search for it online.",
      },
      {
        q: "Can a .dat file be opened in Excel?",
        a: "Only if it's text inside. A binary .dat file needs converting first. Once you know the layout, a short script writes a CSV that Excel opens.",
      },
      {
        q: "What tools do people use to reverse engineer file formats?",
        a: "A hex editor with a pattern language (ImHex, or 010 Editor with its templates), Kaitai Struct for writing the format down, and Python's `struct` module for the converter. Comparing two versions of a file before and after one change is the fastest way to find a field.",
      },
      {
        q: "How do I know which bytes are dates?",
        a: "Look for 4-byte numbers that rise slowly from record to record. Values around 36,000–46,000 are days since 1899-12-30 (the years 1998–2025); values between 1 and 1.8 billion are seconds since 1 January 1970 (the years 2001–2027).",
      },
    ],
    related: ["reverse-engineering/edit-save-file", "pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/fix-dates-in-excel"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "ImHex hex editor", href: "https://imhex.werwolv.net/" },
      { label: "ImHex pattern language", href: "https://docs.werwolv.net/pattern-language" },
      { label: "Kaitai Struct", href: "https://kaitai.io/" },
      { label: "OLE Automation dates (DateTime.FromOADate)", href: "https://learn.microsoft.com/en-us/dotnet/api/system.datetime.fromoadate" },
      { label: "Python codecs (cp1252)", href: "https://docs.python.org/3/library/codecs.html" },
      { label: "Python struct", href: "https://docs.python.org/3/library/struct.html" },
    ],
  },
  {
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
      "Find the hidden JSON API a web page loads its data from, copy its tokens and signatures into a short script, and download everything to CSV.",
    h1: "How to reverse engineer a website API (and download the data)",
    short: "Reverse engineer a website API",
    lede: "Find the requests behind a page and turn them into a script that saves everything.",
    answer:
      "Open the browser's developer tools, go to the Network tab and filter to Fetch/XHR: the requests that appear as the page loads its data are the hidden API. Copy one as cURL to see its headers, read the site's JavaScript for how any token or signature is made, then write a short Python script that repeats the calls through every page and saves a CSV. Stella (stella.sh) does it end to end on your computer: it finds the API, reproduces its sign-in and signing, writes the script, runs it and checks the count against the page.",
    stellaSteps: [
      "Loads the page and its minified script and finds the four calls behind it: a session, categories, a paged catalogue and stock levels",
      "Works out that every request is signed with a SHA-256 of the token, path and time plus a key in the page's code, and reproduces it",
      "Writes `export_products.py`, plain Python with nothing to install, that follows the cursor through every page and joins in categories and stock",
      "Runs it once into a dated CSV, then opens the page and clicks Load more until the end to confirm the same 137 products",
      "Says where the script and CSV are and what to do if the site changes its signing key",
    ],
    prompt:
      "A supplier's price list runs at http://localhost:47213 on my computer, but it has no export button. Can you find the API the page gets its data from and write me a small script that downloads every product to a CSV? Run it once too.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "`products-2026-11-23.csv` with all 137 products right (name, category, price and stock), and `export_products.py`, which, when the shop was switched to a different catalogue afterwards, downloaded all 83 new products correctly.",
      note: "The shop is a small local test site made for this guide, with a signed, paged private API. The quiet stretch is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/reverse-engineer-website-api/proof.mp4`,
        cuts: webCuts("reverse-engineering/reverse-engineer-website-api"),
        poster: `${PROOFS}/reverse-engineering/reverse-engineer-website-api/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 29.7,
        speed: 30,
        realDuration: 133,
      },
      moments: [
        { at: 0, text: "Stella on a Mac, with the supplier's price list page running locally." },
        { at: 4, text: "The request: find the API behind the page, write an export script and run it." },
        { at: 10.8, text: "Stella starts a task for it." },
        { at: 15.5, text: "About 80 seconds of work, sped up 30×: reading the page's code, reproducing the signed requests, writing and running the script." },
        { at: 17.9, text: "Done: 137 products in a CSV, matching what the page shows after clicking Load more to the end." },
        { at: 22, text: "Where the script is, how to run it again, and what to do if the site changes its key." },
      ],
    },
    manualTitle: "Do it yourself (30 minutes to an hour)",
    manualSteps: [
      {
        title: "Watch the page load its data",
        body: "Open the page, press F12 (Cmd+Option+I on a Mac) and go to the Network tab. Filter to Fetch/XHR and reload. In Safari, first turn on Settings › Advanced › Show features for web developers. The JSON responses that hold the data you see on screen are the API; click Load more or the next page and watch which request repeats.",
      },
      {
        title: "Copy a request and replay it",
        body: "Right-click the request and choose Copy › Copy as cURL (in Firefox, Copy Value › Copy as cURL), paste it into a terminal and run it. If it works, [curlconverter](https://curlconverter.com/) turns it into Python. If it fails once a few minutes have passed, something in it expires: a token, a timestamp or a signature.",
      },
      {
        title: "Find where tokens and signatures come from",
        body: "Look for an earlier request that returns the token (often a session or login call), then open the site's JavaScript in the Sources tab, press the `{}` button to pretty-print it and search for the header name, such as `X-Sig`. The code that builds it is usually a few lines: a hash of the token, the path, the time and a fixed key.",
      },
      {
        title: "Follow the pagination",
        body: "Check how the next page is asked for: a `page` number, an `offset`, or a cursor value returned with each page. Raise the page size if the API accepts it, and loop until the response says there's nothing more.",
      },
      {
        title: "Write the script and check the totals",
        body: "Put it together in Python with `urllib` or [Requests](https://requests.readthedocs.io/): get the token, sign each call, walk every page, join in lookups such as category names, and write the rows with the `csv` module. Compare the row count with what the site shows.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I find the hidden API of a website?",
        a: "In the browser's developer tools, open Network, filter to Fetch/XHR and use the page. Any request whose response is the data you see, usually JSON, is the API. Search the response for a product name or price you can see on screen to find the right one quickly.",
      },
      {
        q: "The API works in the browser but returns 401 or 403 from my script. Why?",
        a: "The browser is sending something your script isn't: a cookie, a bearer token, a signature header or a Referer. Copy the request as cURL, remove headers one at a time until it breaks, and you'll know which one matters.",
      },
      {
        q: "Is it better to use the API than scrape the HTML?",
        a: "Usually, yes. The API gives clean JSON, survives redesigns and is often all there is: on pages built with JavaScript, the HTML holds an empty table until the API fills it.",
      },
      {
        q: "Can Claude reverse engineer an API?",
        a: "Yes, when it can see the traffic and the site's code. Through Stella it runs on your computer, opens the page, reads the JavaScript, makes the calls itself and tests the script it writes.",
      },
    ],
    related: ["reverse-engineering/reverse-engineer-a-file-format", "reverse-engineering/edit-save-file", "pdf-excel/bank-statement-pdf-to-excel"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Chrome DevTools: Network panel", href: "https://developer.chrome.com/docs/devtools/network" },
      { label: "Firefox Network Monitor", href: "https://firefox-source-docs.mozilla.org/devtools-user/network_monitor/" },
      { label: "curlconverter", href: "https://curlconverter.com/" },
      { label: "Requests", href: "https://requests.readthedocs.io/en/latest/" },
    ],
  },
  {
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
      "Set up mitmproxy, route one program through it with its certificate, record every HTTPS request and read what it sends: your data, IDs and trackers.",
    h1: "mitmproxy: intercept an app's HTTPS traffic and read every request",
    short: "See what an app sends with mitmproxy",
    lede: "Record one program's HTTPS requests and read what each one sends.",
    answer:
      "mitmproxy is a free proxy that decrypts HTTPS: install it, start `mitmdump -w capture.flows`, then run the program with `HTTPS_PROXY=http://127.0.0.1:8080` and mitmproxy's certificate (`~/.mitmproxy/mitmproxy-ca-cert.pem`) as its trusted CA, and every request lands in the capture with headers and bodies. Pointing only that program at the proxy leaves the rest of the computer alone. Stella (stella.sh) does it end to end on your computer: it installs mitmproxy, captures the app, and explains each request and what of yours it carries.",
    stellaSteps: [
      "Finds the `pocketnote` command, reads how it connects and confirms it follows the standard proxy and certificate settings",
      "Installs mitmproxy with uv into a temporary folder, without touching Homebrew, the system proxy or the keychain",
      "Runs `mitmdump` on a spare port, trusts Pocketnote's own server certificate upstream, and runs one `pocketnote sync` through it with mitmproxy's CA",
      "Saves the full flow file and a readable dump, then describes all six requests in plain words: settings, login, note upload, usage tracking, ad attribution, update check",
      "Points out what stands out: full note text uploaded, hashtags read for tracking, the same IDs tying usage and ad data together",
    ],
    prompt:
      "I want to see exactly what the Pocketnote command-line app on my computer sends over the internet when it syncs. Can you set up mitmproxy, capture it running `pocketnote sync`, and tell me every request in plain words?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A mitmproxy flow file and a readable dump holding all six requests of one sync, including the session ID that only ever existed on the wire, and a plain-words list naming each request and what it sends: the full note text, the refresh token, an advertising ID and usage data.",
      note: "Pocketnote and its four HTTPS servers are a test app made for this guide, running on the same Mac. The quiet stretch is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/inspect-app-traffic-with-mitmproxy/proof.mp4`,
        cuts: webCuts("reverse-engineering/inspect-app-traffic-with-mitmproxy"),
        poster: `${PROOFS}/reverse-engineering/inspect-app-traffic-with-mitmproxy/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 29.7,
        speed: 30,
        realDuration: 143,
      },
      moments: [
        { at: 0, text: "Stella on a Mac with Pocketnote, a command-line notes app, installed." },
        { at: 4, text: "The request: set up mitmproxy, capture one `pocketnote sync` and explain every request." },
        { at: 9.9, text: "Stella explains the plan: the proxy and certificate apply to that one run, not the whole Mac." },
        { at: 12.4, text: "About 80 seconds of work, sped up 30×: installing mitmproxy, capturing the sync, reading the flows." },
        { at: 18.3, text: "The six requests in plain words, from settings and login to note upload, tracking and the update check." },
        { at: 22, text: "What stands out, and where the saved capture is." },
      ],
    },
    manualTitle: "Do it yourself (about 20 minutes)",
    manualSteps: [
      {
        title: "Install mitmproxy",
        body: "On a Mac, `brew install --cask mitmproxy`; on Windows, the installer from [mitmproxy.org](https://mitmproxy.org/downloads/); on Linux, the standalone binaries from the same page. On any system with uv, `uv tool install mitmproxy` works too. You get three tools: `mitmproxy` (terminal), `mitmweb` (browser view) and `mitmdump` (recording).",
      },
      {
        title: "Start it once to create its certificate",
        body: "Run `mitmdump` and stop it with Ctrl+C. It creates `~/.mitmproxy/` (on Windows `%USERPROFILE%\\.mitmproxy`) with `mitmproxy-ca-cert.pem`, the certificate authority it signs every site's certificate with.",
      },
      {
        title: "Record while the program runs through it",
        body: "Start `mitmdump -w capture.flows` (or `mitmweb` to watch in the browser at http://127.0.0.1:8081). In a second terminal, run the program with `HTTPS_PROXY=http://127.0.0.1:8080 HTTP_PROXY=http://127.0.0.1:8080` and its certificate setting pointed at the CA: `SSL_CERT_FILE` for Python and many CLIs, `REQUESTS_CA_BUNDLE` for Python requests, `NODE_EXTRA_CA_CERTS` for Node, `--cacert` for curl. On Windows, `set HTTPS_PROXY=…` first.",
      },
      {
        title: "Catch programs that ignore proxy settings",
        body: "Use local capture mode, `mitmproxy --mode local:appname`, which redirects one process's traffic without any proxy setting; on a Mac it asks you to allow its network extension the first time. For a browser or app that has to trust the certificate system-wide, open http://mitm.it while proxied and follow the steps for your system.",
      },
      {
        title: "Read the capture",
        body: "Open it with `mitmproxy -r capture.flows`, or print everything with `mitmdump -nr capture.flows --flow-detail 4 > readable.txt`. Go request by request: the host, the path, and every ID, token and piece of your data in the query and body. If the server uses its own certificate authority, add `--set ssl_insecure=true` so mitmproxy accepts it upstream.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I install the mitmproxy certificate?",
        a: "For one program, pass `~/.mitmproxy/mitmproxy-ca-cert.pem` through its CA setting (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` and so on). For a browser or the whole system, browse to http://mitm.it with the proxy on and follow the instructions for your system. Remove it from your trusted certificates when you're done.",
      },
      {
        q: "Why do I get certificate errors or no traffic at all?",
        a: "Either the program doesn't trust mitmproxy's CA yet, or it pins its own certificate. Pass the CA as above; for pinning, you need to patch the app or use a Frida-based unpinning script on mobile.",
      },
      {
        q: "mitmproxy or Wireshark?",
        a: "mitmproxy decrypts HTTPS and shows full requests and responses. Wireshark sees every packet on the network but shows HTTPS as encrypted unless you give it the session keys. To see what an app sends to its servers, mitmproxy is the quicker route.",
      },
      {
        q: "Can I use mitmproxy with Python?",
        a: "Yes: addons are Python scripts loaded with `mitmdump -s addon.py`, with functions such as `request(flow)` and `response(flow)` to log, change or block traffic as it passes.",
      },
    ],
    related: ["reverse-engineering/reverse-engineer-website-api", "reverse-engineering/reverse-engineer-a-file-format", "reverse-engineering/edit-save-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "mitmproxy installation", href: "https://docs.mitmproxy.org/stable/overview/installation/" },
      { label: "mitmproxy certificates", href: "https://docs.mitmproxy.org/stable/concepts/certificates/" },
      { label: "mitmproxy modes (local capture)", href: "https://docs.mitmproxy.org/stable/concepts/modes/" },
      { label: "mitmproxy options", href: "https://docs.mitmproxy.org/stable/concepts/options/" },
      { label: "mitmproxy downloads", href: "https://mitmproxy.org/downloads/" },
    ],
  },
  {
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
      "Decode a smart device's network protocol from a Wireshark capture: framing, checksum, session key and commands, then write a Python controller that drives it.",
    h1: "How to reverse engineer a device's protocol from a capture",
    short: "Decode a protocol from a pcap",
    lede: "From a capture of the app and the device to a script that controls it.",
    answer:
      "Open the capture in Wireshark, use Follow › TCP Stream on the device's connection and line up each message with what the app did at that moment: the bytes that change with the brightness or colour you set are the command, the fixed bytes at the start are the framing, and the last byte is often a checksum. If messages differ between sessions for the same setting, they're scrambled with a per-session key. Write it down as a small Python socket script. Stella (stella.sh) does it end to end on your computer: it decodes the capture, writes the controller and uses it on the device.",
    stellaSteps: [
      "Reads the capture with a small parser of its own and pulls out both app sessions with the lamp on port 5577",
      "Works out the frame layout (start bytes, sequence, command, length, payload) and the 8-bit sum at the end",
      "Notices the two sessions send the same settings as different bytes, and finds the key the lamp hands out on each connection",
      "Writes `lumio.py`, plain Python with switches for on, off, colour, white temperature and brightness, and a status read-out",
      "Sets the test lamp to 40% orange with it, reads the state back to confirm, and lists what the capture couldn't prove",
    ],
    prompt:
      "I have a capture of the Lumio phone app talking to my smart lamp in Documents/lumio-capture.pcap. Can you work out how it talks to the lamp, write me a small Python controller, and use it to set the lamp to 40% brightness in orange (#FF8C00)? A test lamp is listening on 127.0.0.1 port 5577.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The test lamp ended on, at 40% brightness and colour FF8C00, set through valid sessions with no checksum or key errors, and `lumio.py`, run again later on its own, opened a fresh session and read the lamp's state correctly.",
      note: "Lumio, its capture and the lamp simulator are made up for this guide. The quiet stretch is sped up 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/decode-network-protocol-from-pcap/proof.mp4`,
        cuts: webCuts("reverse-engineering/decode-network-protocol-from-pcap"),
        poster: `${PROOFS}/reverse-engineering/decode-network-protocol-from-pcap/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.8,
        speed: 30,
        realDuration: 153,
      },
      moments: [
        { at: 0, text: "Stella on a Mac, with a capture of the Lumio app in Documents and a test lamp listening on port 5577." },
        { at: 4, text: "The request: work out the protocol, write a Python controller, set the lamp to 40% orange." },
        { at: 10.9, text: "Stella starts a task for it and says it will check the lamp's reply." },
        { at: 15.6, text: "About 80 seconds of work, sped up 30×: parsing the capture, decoding the frames and the session key, writing and testing the controller." },
        { at: 19.2, text: "Done: the lamp is on at 40% in orange, and its state read back confirms it." },
        { at: 23, text: "How the protocol works in plain words, the controller's commands, and what the capture didn't settle." },
      ],
    },
    manualTitle: "Do it yourself (an hour or two)",
    manualSteps: [
      {
        title: "Capture the app with notes",
        body: "Record while you use the app, one action at a time, and write down the time of each: on, off, brightness 80, red. Capture on the computer the app runs on with [Wireshark](https://www.wireshark.org/download.html) (Windows, Mac, Linux), or capture a phone's traffic from your router or a hotspot on the computer.",
      },
      {
        title: "Isolate the conversation",
        body: "Filter to the device, for example `ip.addr == 192.168.1.50`, find its port, then right-click a packet and choose Follow › TCP Stream (or UDP Stream). Switch the view to Hex Dump or Raw to see the bytes each side sent. From the command line, `tshark -r capture.pcap -Y \"tcp.port==5577 && tcp.len>0\" -T fields -e ip.src -e tcp.payload` prints every payload as hex.",
      },
      {
        title: "Find the framing and the checksum",
        body: "Bytes that are the same at the start of every message are a header (here `AA 55`). Look for a byte that counts up (a sequence number), one that differs by action (the command), and a two-byte number equal to the rest of the message's length. For the last byte, try the sum of all earlier bytes modulo 256, then XOR of all bytes, then CRC-8.",
      },
      {
        title: "Match commands to your notes",
        body: "Line up each message with the action you wrote down. Brightness 80 should show up as `50` hex somewhere; a colour as three bytes such as `FF 00 00`. If the same action sends different bytes in two sessions, look at the first exchange after connecting: a value the device sends there is usually a key that later payloads are XORed with.",
      },
      {
        title: "Write the controller and test it",
        body: "In Python, open a socket with `socket.create_connection((host, port))`, repeat the opening exchange, then build each frame with the header, sequence, command, length, payload and checksum. Send a status request first and check the reply decodes to what the device shows, then send real commands.",
      },
      {
        title: "Optional: teach Wireshark the protocol",
        body: "A short [Lua dissector](https://www.wireshark.org/docs/wsdg_html_chunked/wsluarm.html) in your Wireshark plugins folder labels every field by name in future captures, which makes the remaining unknown bytes stand out.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I decode a TCP payload in Wireshark?",
        a: "Use Follow › TCP Stream to see one conversation's bytes in order. If Wireshark guessed the wrong protocol for a port, right-click a packet, choose Decode As… and pick the right one, or none to see raw data.",
      },
      {
        q: "Can I see what my phone app sends to a smart device?",
        a: "Yes. Share the computer's Wi-Fi as a hotspot and capture on that interface, or capture on a router that supports it. Local traffic between app and device is often unencrypted, as with this lamp; cloud traffic is usually TLS and needs mitmproxy instead.",
      },
      {
        q: "What if the traffic is encrypted?",
        a: "If it's TLS to a cloud server, use mitmproxy with its certificate trusted on the phone. If it's a custom scheme like this one, look for the key exchange at the start of each connection, or for the key in the app's code.",
      },
      {
        q: "How do I read a pcap file in Python?",
        a: "[Scapy](https://scapy.readthedocs.io/en/latest/) reads it with `rdpcap(\"capture.pcap\")`; check `pkt.haslayer(TCP)` and read `bytes(pkt[TCP].payload)`. For a quick look, tshark's `-T fields -e tcp.payload` output is easy to parse too.",
      },
    ],
    related: ["reverse-engineering/inspect-app-traffic-with-mitmproxy", "reverse-engineering/reverse-engineer-website-api", "reverse-engineering/reverse-engineer-a-file-format"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Wireshark: Follow Stream", href: "https://www.wireshark.org/docs/wsug_html_chunked/ChAdvFollowStreamSection.html" },
      { label: "tshark manual", href: "https://www.wireshark.org/docs/man-pages/tshark.html" },
      { label: "Wireshark Lua API", href: "https://www.wireshark.org/docs/wsdg_html_chunked/wsluarm.html" },
      { label: "Scapy", href: "https://scapy.readthedocs.io/en/latest/" },
      { label: "Python socket", href: "https://docs.python.org/3/library/socket.html" },
    ],
  },
  {
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
      "Unpack a router firmware image's filesystem with binwalk or 7-Zip and read its versions, services and accounts, or let Stella (stella.sh) unpack it and write the report.",
    h1: "Extract router firmware and see what's inside",
    short: "Extract router firmware",
    lede: "The files inside a firmware .bin, unpacked, with a plain report of what it runs.",
    answer:
      "Router firmware is usually a vendor header, a compressed Linux kernel and a squashfs filesystem in one .bin. `binwalk -e firmware.bin` (on Linux, WSL or Docker) finds and unpacks each part, and on Windows 7-Zip often opens the squashfs directly. Then the answers are plain files: `etc/openwrt_release` for the version, `etc/rc.d` for boot services, `etc/shadow` for passwords. Stella (stella.sh) unpacks the image without running anything from it and writes the report, with the file each fact came from.",
    stellaSteps: [
      "Checks the download against the checksum OpenWrt publishes for this image, and leaves the original untouched",
      "Splits the image into its TP-Link header, the kernel and the squashfs filesystem, and unpacks it with its own small squashfs reader, recording every link",
      "Reads the versions from the release file, the kernel, the BusyBox binary and the package database",
      "Goes through boot services, scheduled jobs, accounts, password fields, SSH and firewall settings, looking for anything unusual",
      "Writes firmware-report.html next to the unpacked files and points out the one thing to act on: root has no password until you set one",
    ],
    prompt:
      "I downloaded OpenWrt for my TP-Link router (it's in Downloads) but I want to see what's inside before I flash it. Unpack its files into a folder in Downloads and put a short report there: what it runs and which versions (OpenWrt, Linux kernel, BusyBox, SSH server, web interface), what starts at boot, which user accounts exist and whether root has a password, and how SSH is set up.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 5 minutes Stella unpacked the 8 MB image into a folder in Downloads and wrote firmware-report.html: OpenWrt 25.12.6 on Linux 6.12.112, BusyBox 1.37.0, Dropbear 2025.89, LuCI on uhttpd, 24 boot services, 9 accounts with only root able to log in, and SSH on port 22 with password login for root. Checked afterwards by us: all 868 files of the filesystem were byte-identical to a reference unpack, every fact in the report was right, and the download was unchanged.",
      note: "The firmware is the unmodified OpenWrt 25.12.6 factory image for the TP-Link Archer C6 v3 from downloads.openwrt.org (open source, GPL-2.0): a TP-Link header, a compressed Linux kernel and a squashfs root filesystem. The wait is shown at up to 49×.",
      video: {
        src: `${PROOFS}/reverse-engineering/extract-firmware/proof.mp4`,
        cuts: webCuts("reverse-engineering/extract-firmware"),
        poster: `${PROOFS}/reverse-engineering/extract-firmware/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.2,
        speed: 49,
        realDuration: 309,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Downloads holds the OpenWrt 25.12.6 factory image for a TP-Link Archer C6 v3." },
        { at: 4, text: "The prompt: unpack the firmware into a folder and report versions, boot services, accounts and SSH setup." },
        { at: 10.7, text: "Stella starts a task that only reads the firmware and never runs anything from it." },
        { at: 15.1, text: "Splitting the image, unpacking the filesystem and reading its settings, sped up 49×." },
        { at: 20, text: "Done: the image is the official build, with versions, boot services, accounts and SSH summed up." },
        { at: 26.5, text: "It flags the one thing to act on, root's empty password, and links the full report." },
      ],
    },
    manualTitle: "Unpack it yourself",
    manualSteps: [
      {
        title: "See what's in the image",
        body: "Most router firmware is a vendor header, a compressed Linux kernel and a squashfs filesystem, one after the other. [binwalk](https://github.com/ReFirmLabs/binwalk) lists them with their offsets: `binwalk firmware.bin`. On Windows, run it in WSL (Ubuntu) or with Docker, the way its README describes.",
      },
      {
        title: "Extract the filesystem",
        body: "`binwalk -e firmware.bin` carves each part out into an `extractions` folder and unpacks the squashfs into a normal directory tree; add `-M` to unpack nested archives too. On plain Windows, [7-Zip](https://www.7-zip.org/) often opens the image directly and shows the squashfs files: extract with `7z x -snl firmware.bin -orootfs`. Symbolic links may come out as empty files on Windows.",
      },
      {
        title: "Read the versions",
        body: "For OpenWrt, `etc/openwrt_release` names the release; `lib/modules/` has one folder named after the kernel version; the package database (`lib/apk/db/installed` on 25.x, `usr/lib/opkg/status` before) lists every package with its version, including busybox, dropbear and uhttpd. On other firmware, search binaries for version strings: `strings bin/busybox | findstr BusyBox`.",
      },
      {
        title: "Services and accounts",
        body: "Boot services are the `S..` entries in `etc/rc.d` (or scripts in `etc/init.d`). Accounts are in `etc/passwd`; in `etc/shadow`, an empty second field means no password, `*` or `x` means login is locked. Settings such as SSH ports and password logins live in `etc/config/` on OpenWrt.",
      },
      {
        title: "Write it down",
        body: "Note each finding with the file it came from, so you can check it again after the next firmware update.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Does binwalk work on Windows?",
        a: "Not natively for extraction. Use WSL or the Docker image, or open the image in 7-Zip, which reads squashfs and many other firmware parts directly.",
      },
      {
        q: "Can I extract firmware that is encrypted?",
        a: "Not directly. If binwalk shows almost no known signatures and an entropy graph (`binwalk -E`) stays high across the whole file, the image is encrypted or compressed in a custom way, and you need the key, usually from an older unencrypted firmware or from the device itself.",
      },
      {
        q: "How do I get firmware off the device itself?",
        a: "Most vendors publish firmware for download, which is the easy route. Reading it from the device needs either a root shell (`cat /dev/mtdX`) or reading the flash chip with a programmer.",
      },
      {
        q: "Can I change the firmware and flash it back?",
        a: "You can repack a squashfs with `mksquashfs`, but the vendor header usually carries checksums and sizes that must match. For OpenWrt, building a custom image with its Image Builder is the reliable way.",
      },
    ],
    related: ["reverse-engineering/extract-files-from-exe-installer", "reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/patch-exe-file", "reverse-engineering/extract-pak-files"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "binwalk on GitHub", href: "https://github.com/ReFirmLabs/binwalk" },
      { label: "OpenWrt 25.12.6 images for ramips/mt7621", href: "https://downloads.openwrt.org/releases/25.12.6/targets/ramips/mt7621/" },
      { label: "7-Zip", href: "https://www.7-zip.org/" },
    ],
  },
  {
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
      "Get the program files out of a setup.exe or .msi without installing anything, with 7-Zip, innounp and msiexec, or let Stella (stella.sh) do all of it.",
    h1: "Extract files from an EXE or MSI installer without installing",
    short: "Extract files from an installer",
    lede: "The program inside a setup file, unpacked into a folder, with nothing installed.",
    answer:
      "First find out what built the installer, because each kind needs its own tool: 7-Zip opens NSIS installers like Notepad++'s directly, innounp unpacks Inno Setup ones (`innounp -x -dKeePass setup.exe`), and `msiexec /a setup.msi /qb TARGETDIR=C:\\Out` pulls the files out of an MSI without installing it. Stella (stella.sh) works out which kind each installer is, fetches standalone copies of the right tools into a scratch folder, and puts each program in its own folder.",
    stellaSteps: [
      "Fingerprints the three installers so it can prove afterwards they weren't changed",
      "Works out what built each one: Inno Setup for KeePass, NSIS for Notepad++, Windows Installer for PuTTY",
      "Downloads standalone 7-Zip and innoextract into a temporary folder; when innoextract can't read the new KeePass installer, it switches to innounp 2",
      "Unpacks PuTTY's MSI with an administrative extract, which copies the files out without registering anything",
      "Puts each program in its own folder in Downloads, checks the programs are signed by their publishers and confirms nothing got installed",
    ],
    prompt:
      "I downloaded the installers for KeePass, Notepad++ and PuTTY into my Downloads folder. Get the program files out of all three without installing anything, each program in its own folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 3 minutes Stella unpacked KeePass 2.62, Notepad++ 8.9.9.1 and PuTTY 0.85 into three folders in Downloads, from three different installer formats. Checked afterwards by us: 19 key program files were byte-identical to a reference unpack, the extracted plink.exe ran and reported version 0.85, no uninstall entry or installed program appeared, and the installers were unchanged.",
      note: "The three installers are the real, unmodified downloads from the KeePass, Notepad++ and PuTTY sites, all open source. innoextract 1.9, the usual Inno Setup tool, stops with an error on KeePass 2.62 because it only supports Inno Setup up to 6.0.5. The wait is shown at up to 30×.",
      video: {
        src: `${PROOFS}/reverse-engineering/extract-files-from-exe-installer/proof.mp4`,
        cuts: webCuts("reverse-engineering/extract-files-from-exe-installer"),
        poster: `${PROOFS}/reverse-engineering/extract-files-from-exe-installer/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.63,
        speed: 30,
        realDuration: 175,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Downloads holds the KeePass, Notepad++ and PuTTY installers." },
        { at: 4, text: "The prompt: get the program files out of all three without installing anything, each in its own folder." },
        { at: 10.9, text: "Stella starts a task; the installers won't be run and stay where they are." },
        { at: 15.7, text: "Identifying three installer formats and fetching standalone unpackers, sped up 30×." },
        { at: 19.2, text: "Done: KeePass 2.62, Notepad++ 8.9.9.1 and PuTTY 0.85 each have their own folder, and nothing was installed." },
        { at: 24, text: "It notes the files are signed by their publishers and what's missing without a real install, like the right-click menu." },
      ],
    },
    manualTitle: "Extract them yourself",
    manualSteps: [
      {
        title: "Find out what built the installer",
        body: "Open the setup file in [7-Zip](https://www.7-zip.org/) (right-click, 7-Zip, Open archive). If you see the program's files, or folders like `$PLUGINSDIR` and `$INSTDIR`, it's NSIS and you can extract it right there. If you only see `.rsrc` and other PE sections, check the file's Properties, Details tab: \"Inno Setup\" in the description means Inno. A `.msi` is Windows Installer.",
      },
      {
        title: "Inno Setup: innounp",
        body: "Get innounp from its maintainer's [InnoUnpacker page](https://github.com/jrathlev/InnoUnpacker-Windows-GUI); the 2.71 command-line version reads Inno Setup up to 7.1.1. Run `innounp -x -dKeePass KeePass-2.62-Setup.exe`. The program files land in `KeePass\\{app}`, which stands for the install folder. [innoextract](https://constexpr.org/innoextract/) works too, also on Mac and Linux, but version 1.9 stops at Inno Setup 6.0.5.",
      },
      {
        title: "MSI: an administrative extract",
        body: "In a Command Prompt, `msiexec /a putty-64bit-0.85-installer.msi /qb TARGETDIR=C:\\Users\\you\\Downloads\\PuTTY` copies the files out in their folder layout and registers nothing. The standalone [lessmsi](https://github.com/activescott/lessmsi) does the same with `lessmsi x setup.msi out\\`. 7-Zip also opens MSIs, but shows a cab and internal file names instead of the folder layout.",
      },
      {
        title: "Installers inside installers",
        body: "Some setup.exe files just wrap an MSI or another setup. If the first extract gives you one big .msi, .cab or .exe, run the matching step on that.",
      },
      {
        title: "Check it runs",
        body: "Start the program from its new folder. Most run fine; things that need a real install, such as Explorer right-click menus, file associations and services, won't be there.",
      },
    ],
    platforms: ["windows"],
    faq: [
      {
        q: "How do I extract files from an EXE without installing it?",
        a: "Open it in 7-Zip first. NSIS installers and self-extracting archives open directly; Inno Setup ones need innounp or innoextract; an installer that wraps an MSI gives you the MSI, which `msiexec /a` or lessmsi unpacks.",
      },
      {
        q: "Is extracting an installer the same as a portable version?",
        a: "Usually close. The files are the same ones the installer would copy, so most programs run from the folder. Settings may still be written to your user profile, and anything the installer would register, like context-menu entries or services, is missing.",
      },
      {
        q: "Why does innoextract say the version is not supported?",
        a: "innoextract 1.9 knows Inno Setup versions up to 6.0.5, and most current installers are newer. Use innounp 2, which supports up to 7.1.1.",
      },
      {
        q: "Can I extract an MSI on Mac or Linux?",
        a: "Yes: msitools (`msiextract setup.msi`) or 7-Zip's `7z x` give you the files, though 7-Zip uses the MSI's internal file names.",
      },
    ],
    related: ["reverse-engineering/extract-electron-asar", "reverse-engineering/decompile-exe-to-source-code", "reverse-engineering/decompile-python-exe", "reverse-engineering/decompile-dotnet-dll-to-csharp"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "innounp (InnoUnpacker) by J. Rathlev", href: "https://github.com/jrathlev/InnoUnpacker-Windows-GUI" },
      { label: "innoextract", href: "https://constexpr.org/innoextract/" },
      { label: "msiexec command-line options (Microsoft)", href: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec" },
      { label: "lessmsi", href: "https://github.com/activescott/lessmsi" },
      { label: "7-Zip", href: "https://www.7-zip.org/" },
    ],
  },
];
