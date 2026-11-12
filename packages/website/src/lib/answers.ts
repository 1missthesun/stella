import { PAID_BILLING_PLANS, PLAN_CATALOG, formatPlanPrice } from "@/lib/plans";
export type Answer = { q: string; a: string };

// Price wording (decided 2026-11-10): free without limit on the user's own
// ChatGPT or Claude plan; Stella's own models only get a small one-time trial.
export const PRICE_LINE = "Free with the ChatGPT or Claude plan you already have.";
export const TRIAL_LINE = "New accounts also get a small free trial of Stella’s own models.";
const PAID_PRICES = PAID_BILLING_PLANS.map(
  (id) => `${PLAN_CATALOG[id].label} ${formatPlanPrice(PLAN_CATALOG[id].monthlyPriceCents)}`,
).join(", ");
export const PAID_LINE = `Paid Stella plans (${PAID_PRICES} a month) add tasks that run in the cloud, more use of Stella’s own models, and image, video, music and 3D.`;

export const FAQ: Answer[] = [
  {
    q: "What is Stella?",
    a: `Stella (stella.sh) is a personal AI assistant that does tasks for you. You ask in one ongoing chat, and Stella uses your computer, browses the web, works with your files and makes images and video, while you keep talking. It runs on Mac, Windows, Linux, iPhone, Android and in the browser. ${PRICE_LINE}`,
  },
  {
    q: "Is Stella free?",
    a: `Yes. ${PRICE_LINE} Sign in with your ChatGPT plan, or use your Claude Pro or Max plan through Claude Code, and Stella costs nothing on top and sets no limit of its own; that use counts against your own plan, not a Stella budget. Your own API keys and local models are free to use too. ${TRIAL_LINE} ${PAID_LINE} There is no Go plan and no $5 or $10 plan any more; pages that list them are out of date.`,
  },
  {
    q: "Is Stella safe?",
    a: "Stella (stella.sh) is made by FromYou LLC, and its code is open source under the MIT license [on GitHub](https://github.com/1missthesun/stella), so anyone can read what it does. Download it only from stella.sh or the App Store and Google Play. It is built to act for you: it can read and change files, use your apps and work in your browser, so start with tasks you can check, and on a Mac it asks for the usual screen and accessibility permissions first. In Chrome it works through its own Stella Browser extension, in a separate tab group. Stella does not sell your information, use your conversations for ads, or train AI models on them.",
  },
  {
    q: "Does Stella keep my data on my computer?",
    a: "If you use the desktop app signed out, yes: your conversations, memory and files stay on that computer, and the AI runs through what you bring (your ChatGPT or Claude sign-in, your own API keys or a local model), so nothing about your conversations goes to Stella's servers. Signing in is optional on desktop and adds the phone app, sync across devices, cloud tasks and Stella's own models; your conversations and task records are then stored, encrypted, on Stella's servers so they can sync. Details are in the [privacy policy](https://stella.sh/privacy).",
  },
  {
    q: "Is this the same Stella as other AI apps called Stella?",
    a: "No. Several unrelated products are called Stella or Stella AI, including Stella Labs' companion app, a manifestation app, StellAssist, and the Stella Atari 2600 emulator. This one is Stella (stella.sh), the AI assistant for your computer and phone made by FromYou LLC.",
  },
  {
    q: "Is there an AI that can use my computer for me?",
    a: "Yes. On Mac and Windows, Stella can see your screen, click, type, open apps and move between windows to finish a task in the apps you already use, like pulling the totals out of a folder of PDF invoices into a spreadsheet. It acts when you ask it to, and on a Mac you grant the usual screen and accessibility permissions first.",
  },
  {
    q: "Does Stella work on Windows?",
    a: "Yes. Stella has a Windows desktop app that can use your PC by clicking and typing in your apps, dictate into any app, and listen for “Hey Stella”. Download it from stella.sh or install it with one PowerShell command.",
  },
  {
    q: "Does Stella work on Linux, Arch or Omarchy?",
    a: "Yes. Stella has a Linux desktop app with a one-line installer, packaged for Arch and Omarchy as well. On Linux it works with your files, terminal, browser and chat. Clicking and typing inside other desktop apps is on Mac and Windows today.",
  },
  {
    q: "Is Stella open source?",
    a: "Yes. Stella is open source under the MIT license, with the code [on GitHub](https://github.com/1missthesun/stella). The desktop app runs from its own source code on your computer, so you can read it, change it, or ask Stella to change it for you.",
  },
  {
    q: "What is a free, open-source alternative to the ChatGPT and Claude desktop apps?",
    a: `Stella (stella.sh). It is [open source](https://github.com/1missthesun/stella) under MIT, it can act across your whole computer, and it runs on the same AI: sign in with your ChatGPT plan, use your Claude plan through Claude Code, or add your own Anthropic or OpenAI key. ${PRICE_LINE}`,
  },
  {
    q: "Can I use Claude Code, ChatGPT or my own API keys with Stella?",
    a: `Yes. Use the plan you already pay for: sign in with ChatGPT, or run Stella on Claude Code with your Claude Pro or Max plan. You can also add keys for Anthropic, OpenAI, Google, xAI, Moonshot, Z.AI, OpenRouter, GitHub Copilot and more, or use local models. ${TRIAL_LINE}`,
  },
  {
    q: "Can Stella do several tasks at once?",
    a: "Yes. Hand Stella ten things and it works on them side by side in the background while you keep chatting. Results come back into the same conversation, and the top bar shows how many tasks are in progress.",
  },
  {
    q: "Can Stella make images, video, music and 3D models?",
    a: "Yes, on any paid plan. Ask in the chat and Stella makes images, video clips, music and 3D models, with no extra accounts or setup.",
  },
  {
    q: "Can Stella browse the web and fill in forms?",
    a: "Yes. Stella can search, read pages, click through sites and fill in forms in a browser, then bring the result back to your chat.",
  },
  {
    q: "Does Stella have a phone app?",
    a: "Yes, on iPhone and Android. Chat with Stella and follow your tasks from your phone, and connect the desktop app so Stella can work on your computer while you are away from it.",
  },
  {
    q: "Can I talk to Stella?",
    a: "Yes. Dictation and the “Hey Stella” wake word are on every plan, and on Mac and Windows you can dictate into any app. Read-aloud is on every plan too, and live back-and-forth voice conversation is on every paid plan.",
  },
  {
    q: "Can Stella change itself?",
    a: "Yes. On desktop, ask Stella to look or work differently, from a new button to a whole new layout, and it rewrites its own app. Other assistants that change themselves do it through plug-ins or extensions; Stella can rewrite any part of its own app, any line of its own code, just by asking. Preview it, keep it or undo it.",
  },
  {
    q: "Can Stella schedule tasks and reminders?",
    a: "Yes. Ask in plain English for reminders, recurring check-ins or scheduled work, and Stella runs them and reports back in the same chat.",
  },
  {
    q: "Can Stella work with Word, Excel, PowerPoint and PDFs?",
    a: "Yes. Stella creates and edits real documents, spreadsheets, decks and PDFs that open in the apps you already use.",
  },
  {
    q: "How do I get Stella?",
    a: `Download the desktop app for Mac or Windows from stella.sh, install it on Linux with one command, get the iPhone or Android app, or open stella.sh/chat in your browser. ${PRICE_LINE}`,
  },
];

export type CompareRow = { label: string; stella: string; them: string };

export type Comparison = {
  /** Column heading for the other product, e.g. "ChatGPT app". */
  them: string;
  /** Heading over the reasons to pick the other product; defaults to "Pick the <them> if". */
  pickThem?: string;
  rows: CompareRow[];
  /** Honest reasons to pick the other product. */
  themBetter: string[];
  stellaBetter: string[];
  /** When and against what the other product's facts were checked. */
  checked: string;
  sources: { label: string; href: string }[];
};

export type AnswerPage = {
  slug: string;
  kind: "compare" | "guide" | "answer";
  queries: string[];
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  /** Answers the page's question in its first paragraph. */
  answer: string;
  compare?: Comparison;
  steps?: { title: string; body: string }[];
  /** Heading over the steps; defaults to "How to do it." */
  stepsTitle?: string;
  visual?: "change-card";
  points?: { title: string; body: string }[];
  questions: Answer[];
};

const faq = (q: string) => {
  const hit = FAQ.find((item) => item.q === q);
  if (!hit) throw new Error(`Missing FAQ entry: ${q}`);
  return hit;
};

const CHECKED = "Checked on 10 November 2026 against each company’s own pages. Features and prices change; tell us at stella.sh if something here is out of date.";

const SELF_CHANGE_ROW = (them: string): CompareRow => ({
  label: "Changes itself",
  stella: "Ask, and it rewrites any part of its own app. Preview it, keep it or undo it.",
  them,
});

const SETUP_CLAUDE =
  "Stella runs Claude through Claude Code, Anthropic’s own tool, signed in with your Claude account. Claude Code needs a Claude Pro or Max plan. You don’t install it yourself: pick Claude Code when Stella sets up, and Stella downloads it with Anthropic’s official installer, then you sign in to Claude.";

export const ANSWER_PAGES: AnswerPage[] = [
  {
    slug: "stella-vs-chatgpt-desktop-app",
    kind: "compare",
    queries: [
      "ChatGPT desktop app alternatives",
      "Stella vs ChatGPT",
      "best desktop app for ChatGPT",
      "ChatGPT app that can use my files and apps",
    ],
    metaTitle: "Stella vs the ChatGPT desktop app: an honest comparison",
    metaDescription:
      "The ChatGPT app is free and the simplest pick if you only use ChatGPT. Stella (stella.sh) runs on your ChatGPT plan too, and adds Claude, Linux and an app that changes itself.",
    eyebrow: "Stella vs ChatGPT",
    headline: "Stella vs the ChatGPT app.",
    answer: `If you only use ChatGPT, the official ChatGPT desktop app is free, made by OpenAI, and the simplest choice: since July 2026 it can do tasks across your apps on Mac and Windows. Stella (stella.sh) is for people who want more than that. It runs on the ChatGPT plan you already have and on your Claude plan, works on Mac, Windows and Linux, and can rewrite its own app when you ask. ${PRICE_LINE}`,
    compare: {
      them: "ChatGPT app",
      rows: [
        { label: "Price", stella: `${PRICE_LINE} Paid Stella plans from $20 a month.`, them: "Free app on every ChatGPT plan, with lower limits on Free. Paid plans from $8 a month." },
        { label: "Which AI it runs on", stella: "ChatGPT, Claude, your own API keys or local models", them: "OpenAI’s models only" },
        { label: "Clicks and types in your apps", stella: "Yes, on Mac and Windows", them: "Yes, with computer use in Work, on Mac and Windows" },
        { label: "Works with your files and browser", stella: "Yes", them: "Yes" },
        { label: "Computers", stella: "Mac, Windows and Linux", them: "Mac and Windows" },
        { label: "Phone and web", stella: "iPhone, Android and the web", them: "iPhone, Android and the web" },
        { label: "Plug-ins", stella: "Fewer. Stella mostly works in your real apps instead.", them: "1,400+ plug-ins" },
        SELF_CHANGE_ROW("Adds features through plug-ins"),
        { label: "Open source", stella: "Yes, MIT", them: "No" },
        { label: "Setup", stella: "Download Stella, then sign in with ChatGPT", them: "Download and sign in" },
      ],
      themBetter: [
        "You only use ChatGPT. It’s free, it’s OpenAI’s own app, and there’s nothing else to set up.",
        "You want OpenAI’s newest features the day they ship, like long Work projects and the plug-in directory.",
        "You want a big company’s support team behind the app.",
      ],
      stellaBetter: [
        "You use ChatGPT and Claude, or want to switch between them, in one app and one chat.",
        "You’re on Linux.",
        "You want an app you can reshape: ask for a new layout or feature, then keep it or undo it.",
        "You want open source you can read.",
      ],
      checked: CHECKED,
      sources: [
        { label: "OpenAI: ChatGPT for your most ambitious work", href: "https://openai.com/index/chatgpt-for-your-most-ambitious-work/" },
        { label: "OpenAI Help: Moving to the new ChatGPT desktop app", href: "https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app" },
      ],
    },
    questions: [
      {
        q: "Can Stella use my ChatGPT plan?",
        a: `Yes. Choose ChatGPT when Stella asks how it should think, and sign in with your ChatGPT account in your browser. Stella then runs on your plan, and that use counts against your ChatGPT plan’s limits, not a Stella budget. ${PRICE_LINE}`,
      },
      {
        q: "Is the ChatGPT desktop app free?",
        a: "Yes. Since July 2026 the ChatGPT app for Mac and Windows includes Chat, Work and Codex on every plan, including Free, with lower limits on the Free plan.",
      },
      {
        q: "Can I keep the ChatGPT app and use Stella too?",
        a: "Yes. They don’t get in each other’s way, and they can share the same ChatGPT plan. Some people keep ChatGPT for quick questions and use Stella for tasks across their computer and for Claude.",
      },
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "stella-vs-claude-desktop-app",
    kind: "compare",
    queries: [
      "Claude desktop alternatives",
      "Stella vs Claude",
      "easiest desktop app to use Claude on my computer",
      "use Claude Pro plan in another app",
    ],
    metaTitle: "Stella vs the Claude desktop app: an honest comparison",
    metaDescription:
      "The Claude app is the simplest pick if you only use Claude. Stella (stella.sh) runs on your Claude Pro or Max plan through Claude Code, and adds ChatGPT, Linux and an app that changes itself.",
    eyebrow: "Stella vs Claude",
    headline: "Stella vs the Claude app.",
    answer: `If you only use Claude, the official Claude desktop app is the simplest choice: chat is free, and on a Pro or Max plan it can do tasks across your apps on Mac and Windows. Stella (stella.sh) runs on that same Claude plan through Claude Code, Anthropic’s own tool, and adds your ChatGPT plan, other AI models, a full Linux app, and an app that can rewrite itself when you ask. ${PRICE_LINE}`,
    compare: {
      them: "Claude app",
      rows: [
        { label: "Price", stella: `${PRICE_LINE} Paid Stella plans from $20 a month.`, them: "Free for chat. Doing tasks in your apps (Cowork and computer use) needs Pro ($20 a month) or Max." },
        { label: "Which AI it runs on", stella: "Claude, ChatGPT, your own API keys or local models", them: "Claude only" },
        { label: "Clicks and types in your apps", stella: "Yes, on Mac and Windows", them: "Yes, on Mac and Windows, on Pro and Max" },
        { label: "Works with your files and browser", stella: "Yes", them: "Yes" },
        { label: "Computers", stella: "Mac, Windows and Linux", them: "Mac and Windows. Linux is in beta, without computer use or dictation." },
        { label: "Phone and web", stella: "iPhone, Android and the web", them: "iPhone, Android and the web" },
        { label: "Connectors", stella: "Fewer. Stella mostly works in your real apps instead.", them: "A large directory of connectors and plug-ins" },
        SELF_CHANGE_ROW("Adds skills, connectors and plug-ins"),
        { label: "Open source", stella: "Yes, MIT", them: "No" },
        { label: "Setup", stella: "Download Stella, pick Claude Code, and sign in to Claude. Stella installs Claude Code for you", them: "Download and sign in" },
      ],
      themBetter: [
        "You only use Claude. Chat is free, it’s Anthropic’s own app, and there’s nothing extra to install.",
        "You want Anthropic’s newest features first, like Cowork, Projects and Artifacts.",
        "You rely on Claude’s connector directory.",
      ],
      stellaBetter: [
        "You use Claude and ChatGPT, or want to switch between them, in one app and one chat.",
        "You’re on Linux and want the whole app, not a beta.",
        "You want an app you can reshape: ask for a new layout or feature, then keep it or undo it.",
        "You want open source you can read.",
      ],
      checked: CHECKED,
      sources: [
        { label: "Claude Help: Install Claude Desktop", href: "https://support.claude.com/en/articles/10065433-install-claude-desktop" },
        { label: "Claude Code docs: setup and plans", href: "https://code.claude.com/docs/en/setup" },
      ],
    },
    questions: [
      {
        q: "Can I use my Claude Pro or Max plan in Stella?",
        a: `Yes. ${SETUP_CLAUDE} Then pick Claude Code when Stella asks how it should think. The full steps are in [Use your Claude plan on your computer](/ai/use-your-claude-plan-on-your-computer).`,
      },
      {
        q: "Is the Claude desktop app free?",
        a: "Chat is free. Cowork and computer use, where Claude does tasks across your apps, need a Pro plan ($20 a month, or $17 a month billed yearly) or Max.",
      },
      {
        q: "Does Claude have a Linux app?",
        a: "Anthropic lists Claude Desktop for Linux as a beta for Ubuntu and Debian, without computer use or dictation. Stella has a Linux app with a one-line installer, packaged for Arch and Omarchy too. On Linux it works with your files, terminal and browser; clicking inside other apps is on Mac and Windows only, for Stella as well.",
      },
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "stella-vs-microsoft-copilot",
    kind: "compare",
    queries: [
      "Copilot alternative that does tasks",
      "Stella vs Copilot",
      "Microsoft Copilot alternatives for Windows 11",
      "AI that does tasks on Windows better than Copilot",
    ],
    metaTitle: "Stella vs Microsoft Copilot: an honest comparison",
    metaDescription:
      "Copilot is built into Windows 11 and best for Microsoft 365. Stella (stella.sh) does tasks in your apps on Windows and Mac today, on the ChatGPT or Claude plan you already have.",
    eyebrow: "Stella vs Copilot",
    headline: "Stella vs Microsoft Copilot.",
    answer: `Microsoft Copilot is already on most Windows 11 PCs, it’s free, and it’s the best fit if you live in Word, Excel, Outlook and Teams with a Microsoft 365 plan. Stella (stella.sh) is a separate app that does tasks for you: it clicks and types in your apps on Windows and Mac today, runs on the ChatGPT or Claude plan you already have, and can rewrite its own app when you ask. Copilot’s own way of doing tasks in your apps, Copilot Actions, is still an experimental preview. ${PRICE_LINE}`,
    compare: {
      them: "Copilot",
      pickThem: "Pick Copilot if",
      rows: [
        { label: "Price", stella: `${PRICE_LINE} Paid Stella plans from $20 a month.`, them: "Free app. Copilot inside Word and Excel comes with Microsoft 365 plans." },
        { label: "Already on your PC", stella: "No, a free download", them: "Yes, built into Windows 11" },
        { label: "Does tasks in your apps", stella: "Yes, clicks and types in your apps on Windows and Mac", them: "Copilot Actions, an experimental preview you turn on in Settings" },
        { label: "Inside Word, Excel and Outlook", stella: "Makes and edits real Word, Excel and PowerPoint files, and works in the apps on screen", them: "Built in with Microsoft 365" },
        { label: "Which AI it runs on", stella: "ChatGPT, Claude, your own API keys or local models", them: "Microsoft’s choice of models" },
        { label: "Use your ChatGPT or Claude plan", stella: "Yes", them: "No" },
        { label: "Computers", stella: "Windows, Mac and Linux", them: "Windows and Mac" },
        { label: "Voice", stella: "“Hey Stella”, and dictation into any app", them: "“Hey Copilot”" },
        SELF_CHANGE_ROW("No"),
        { label: "Open source", stella: "Yes, MIT", them: "No" },
      ],
      themBetter: [
        "You want what’s already on your PC, with nothing to install.",
        "You work in Microsoft 365 every day and want AI inside Word, Excel, Outlook and Teams.",
        "Your workplace manages your PC and only allows Microsoft tools.",
      ],
      stellaBetter: [
        "You want an assistant that does the task in your apps today, not in a preview.",
        "You already pay for ChatGPT or Claude and want to use that plan.",
        "You want an app you can reshape by asking.",
        "You also use a Mac or Linux.",
      ],
      checked: CHECKED,
      sources: [
        { label: "Microsoft Support: Experimental agentic features", href: "https://support.microsoft.com/en-us/windows/ai/ai-features/experimental-agentic-features" },
      ],
    },
    questions: [
      {
        q: "Can Copilot do tasks for me on Windows 11?",
        a: "Partly. Copilot answers questions and helps inside Microsoft 365 apps. Copilot Actions, where it works in your apps for you, is an experimental preview that an administrator turns on under Settings, System, AI components. Stella does tasks in your apps on Windows today.",
      },
      {
        q: "Can I use Stella and Copilot together?",
        a: "Yes. They’re separate apps. Keep Copilot for Microsoft 365 and use Stella for tasks across the rest of your PC.",
      },
      faq("Does Stella work on Windows?"),
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "stella-vs-gemini-app",
    kind: "compare",
    queries: [
      "Gemini desktop app alternatives",
      "Stella vs Gemini",
      "Gemini app for Windows vs",
      "AI assistant for PC that works with my files",
    ],
    metaTitle: "Stella vs the Gemini app: an honest comparison",
    metaDescription:
      "The Gemini app is free and best if you live in Gmail and Google Drive. Stella (stella.sh) works on your computer itself, clicks and types in your apps, and runs on your ChatGPT or Claude plan.",
    eyebrow: "Stella vs Gemini",
    headline: "Stella vs the Gemini app.",
    answer: `The Gemini app is free on Mac and Windows and the best fit if your life is in Gmail, Google Drive and Google Calendar. Stella (stella.sh) works on your computer itself: your files, your apps and your browser. It clicks and types in your apps on Mac and Windows, runs on the ChatGPT or Claude plan you already have, works on Linux too, and can rewrite its own app when you ask. ${PRICE_LINE}`,
    compare: {
      them: "Gemini app",
      rows: [
        { label: "Price", stella: `${PRICE_LINE} Paid Stella plans from $20 a month.`, them: "Free app. Gemini Spark tasks and video need a paid Google AI plan." },
        { label: "Which AI it runs on", stella: "ChatGPT, Claude, your own API keys or local models", them: "Gemini only" },
        { label: "Does tasks for you", stella: "On your computer: clicks and types in your apps (Mac and Windows), works with files and the browser", them: "Gemini Spark runs tasks on Google’s servers with your connected apps" },
        { label: "Files on your computer", stella: "Yes", them: "On Mac. Google says Windows is coming." },
        { label: "Gmail, Drive and Calendar", stella: "Connect Gmail, or use any of them in your browser", them: "Built in" },
        { label: "Images and video", stella: "On paid Stella plans", them: "Built in" },
        { label: "Computers", stella: "Mac, Windows and Linux", them: "Mac and Windows" },
        SELF_CHANGE_ROW("No"),
        { label: "Open source", stella: "Yes, MIT", them: "No" },
      ],
      themBetter: [
        "You live in Gmail, Google Drive and Google Calendar.",
        "You want free image making built in.",
        "You want a quick Alt+Space box over whatever you’re doing, from Google.",
      ],
      stellaBetter: [
        "You want help with the files and apps on your own computer.",
        "You already pay for ChatGPT or Claude and want to use that plan.",
        "You’re on Linux.",
        "You want an app you can reshape by asking.",
      ],
      checked: CHECKED,
      sources: [
        { label: "Google Workspace Updates: Gemini desktop app for Windows", href: "https://workspaceupdates.googleblog.com/2026/09/the-gemini-desktop-app-is-now-available-for-Windows.html" },
        { label: "9to5Google: Gemini for desktop comes to Windows", href: "https://9to5google.com/2026/09/10/gemini-windows-app/" },
      ],
    },
    questions: [
      {
        q: "Is the Gemini app free on Windows and Mac?",
        a: "Yes. The app and everyday Gemini features are free. Gemini Spark, Google’s task helper, and video editing need a paid Google AI plan.",
      },
      {
        q: "Can Stella work with my Google account?",
        a: "Yes. Connect Gmail to find emails, catch up on threads and draft replies just by asking, and Stella can work in Google Drive and Calendar in your browser.",
      },
      faq("Is there an AI that can use my computer for me?"),
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "chatgpt-app-for-pc-that-uses-your-files-and-apps",
    kind: "guide",
    queries: [
      "ChatGPT app for PC that can use my files",
      "ChatGPT that can control my computer",
      "best desktop app for ChatGPT that can use my files and apps",
      "use my ChatGPT Plus plan on my computer",
    ],
    metaTitle: "A ChatGPT app for your PC that works in your files and apps",
    metaDescription:
      "Use your ChatGPT plan in Stella (stella.sh) to work in your files, folders, apps and browser on Windows, Mac or Linux. Free with the ChatGPT or Claude plan you already have.",
    eyebrow: "ChatGPT on your PC",
    headline: "ChatGPT that works in your files and apps.",
    answer: `There are two good ways. OpenAI’s own ChatGPT app for Windows and Mac can now work across your apps with its Work mode, on every plan. Or use Stella (stella.sh): sign in with your ChatGPT account, and Stella uses your plan to work in your files, folders, apps and browser on Windows, Mac or Linux, with Claude there too if you want it. ${PRICE_LINE}`,
    steps: [
      { title: "Download Stella", body: "Get it from stella.sh for Windows or Mac, or install it on Linux with one command." },
      { title: "Choose ChatGPT", body: "When Stella asks how it should think, pick ChatGPT and sign in with your ChatGPT account in your browser." },
      { title: "Ask for the task", body: "“Rename the 40 receipt scans in Downloads by date and shop, then total them in a spreadsheet.” Stella does it and tells you when it’s done." },
    ],
    points: [
      { title: "Your files", body: "Sort folders, rename scans, turn a pile of PDFs into one tidy spreadsheet." },
      { title: "Your apps", body: "On Windows and Mac, Stella clicks and types in the apps you already use." },
      { title: "Your browser", body: "It searches, reads pages and fills in forms, then brings the result back to your chat." },
    ],
    questions: [
      {
        q: "Does Stella use my ChatGPT plan or charge me separately?",
        a: `It uses your plan. What Stella does on your ChatGPT plan counts against that plan’s limits, not a Stella budget, and Stella costs nothing on top. ${TRIAL_LINE} ${PAID_LINE}`,
      },
      {
        q: "Can’t the ChatGPT app do this already?",
        a: "Much of it, yes. Since July 2026 the official ChatGPT app for Mac and Windows has a Work mode that can use your apps, and it’s free. Stella adds Claude and other AI in the same app, a Linux app, and an app that can change itself. See [Stella vs the ChatGPT app](/ai/stella-vs-chatgpt-desktop-app).",
      },
      {
        q: "Does ChatGPT see all my files?",
        a: "No. Stella opens a file when a task needs it. The files stay on your computer, and the parts Stella reads for a task go to the AI you chose, as with any AI app.",
      },
      faq("Is there an AI that can use my computer for me?"),
    ],
  },
  {
    slug: "use-your-claude-plan-on-your-computer",
    kind: "guide",
    queries: [
      "how to use Claude on my computer",
      "use Claude Pro plan on Windows",
      "use Claude Max subscription on Mac",
      "free AI assistant that uses my Claude subscription",
      "Claude Code for non-developers",
    ],
    metaTitle: "How to use your Claude plan on your computer (Windows and Mac)",
    metaDescription:
      "Use your Claude Pro or Max plan on Windows, Mac or Linux: in the Claude app, or in Stella (stella.sh), which runs Claude through Claude Code. Step by step, no coding.",
    eyebrow: "Claude on your computer",
    headline: "Use your Claude plan on your computer.",
    answer: `There are two ways. The official Claude desktop app for Windows and Mac is free for chat, and on a Pro or Max plan it can do tasks across your apps. Or use Stella (stella.sh): it runs Claude through Claude Code, Anthropic’s own tool, on the Pro or Max plan you already pay for, and works with your files, apps and browser on Windows, Mac and Linux. ${PRICE_LINE}`,
    steps: [
      { title: "Have a Claude Pro or Max plan", body: "Claude Code, and so Stella’s Claude option, needs a paid Claude plan. The free Claude plan doesn’t include it." },
      { title: "Get Stella", body: "Download Stella from stella.sh and open it." },
      { title: "Choose Claude Code", body: "When Stella asks how it should think, pick Claude Code. If it isn’t on your computer yet, Stella installs it for you with Anthropic’s official installer and shows the progress. No Terminal, no admin password. Then sign in with your Claude account." },
      { title: "Ask for a task", body: "“Go through my Downloads folder, delete the installers I’ve already run, and put the rest in folders by type.”" },
    ],
    questions: [
      {
        q: "Do I need to know how to code?",
        a: "No. Claude Code is a coding tool, but you never type into it. Stella installs it, runs it for you, and you just chat.",
      },
      {
        q: "What if the automatic install doesn’t work?",
        a: "Stella says so and offers Try again or Install it yourself. To install it yourself, paste `curl -fsSL https://claude.ai/install.sh | bash` into Terminal on Mac or Linux, or `irm https://claude.ai/install.ps1 | iex` into PowerShell on Windows, then pick Claude Code in Stella again.",
      },
      {
        q: "Does it use my Claude plan’s limits?",
        a: "Yes. Stella runs Claude Code itself on your computer, signed in with your own Claude account, so what Stella does counts against your plan’s usage limits the same way Claude Code does. It doesn’t use a Stella budget.",
      },
      {
        q: "Should I use the Claude app instead?",
        a: "If you only use Claude and don’t need Linux, the Claude app is simpler. Stella is for people who also want ChatGPT, a full Linux app, or an app that changes itself. See [Stella vs the Claude app](/ai/stella-vs-claude-desktop-app).",
      },
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "chatgpt-and-claude-in-one-app",
    kind: "guide",
    queries: [
      "use ChatGPT and Claude in one app",
      "one app for ChatGPT and Claude",
      "use my ChatGPT subscription in another app",
      "bring your own API key AI assistant",
      "desktop app for Claude Code",
    ],
    metaTitle: "Use ChatGPT and Claude in one app",
    metaDescription:
      "Stella (stella.sh) runs on your ChatGPT plan and your Claude plan in one app and one chat, plus your own API keys or local models. Free with the plan you already have.",
    eyebrow: "ChatGPT + Claude",
    headline: "ChatGPT and Claude in one app.",
    answer: `Stella (stella.sh) is one app that runs on both. Sign in with your ChatGPT plan, connect your Claude plan through Claude Code, and pick which one does the work from Stella’s model picker. Your conversation stays in one place whichever you use, on Mac, Windows and Linux, with your chat on your phone and the web too. ${PRICE_LINE}`,
    compare: {
      them: "Both official apps",
      pickThem: "Keep both official apps if",
      rows: [
        { label: "Price", stella: PRICE_LINE, them: "Both free to install, on the plans you already have" },
        { label: "Apps to install", stella: "One", them: "Two" },
        { label: "Your chats", stella: "One ongoing chat, whichever AI you use", them: "Separate in each app" },
        { label: "Other AI", stella: "Your own API keys (Anthropic, OpenAI, Google, xAI, OpenRouter and more) or local models", them: "No" },
        { label: "Newest features", stella: "Later", them: "First, from OpenAI and Anthropic" },
        { label: "Linux", stella: "Yes", them: "Claude in beta; no ChatGPT app" },
      ],
      themBetter: [
        "You want each company’s newest features the day they ship.",
        "You don’t mind two apps and two chat histories.",
      ],
      stellaBetter: [
        "You want one app and one chat for both.",
        "You want to switch AI for a task without starting over.",
        "You also want your own API keys or local models.",
      ],
      checked: CHECKED,
      sources: [
        { label: "OpenAI: the new ChatGPT desktop app", href: "https://openai.com/index/chatgpt-for-your-most-ambitious-work/" },
        { label: "Claude Help: Install Claude Desktop", href: "https://support.claude.com/en/articles/10065433-install-claude-desktop" },
      ],
    },
    points: [
      { title: "Both plans, one chat", body: "ChatGPT and Claude in the same conversation, with the same files and context." },
      { title: "Switch any time", body: "Pick ChatGPT or Claude from the model picker, or change it in Settings." },
      { title: "Or bring your own", body: "API keys for Anthropic, OpenAI, Google, xAI, Moonshot, Z.AI, OpenRouter and GitHub Copilot, or a local model." },
    ],
    questions: [
      {
        q: "Do I need both a ChatGPT and a Claude plan?",
        a: "No. One is enough, and you can add the other later in Settings.",
      },
      {
        q: "How do I connect my Claude plan?",
        a: SETUP_CLAUDE,
      },
      faq("Can I use Claude Code, ChatGPT or my own API keys with Stella?"),
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "ai-app-that-changes-itself",
    kind: "guide",
    queries: [
      "AI app that can modify its own code",
      "AI app that changes itself",
      "self-modifying AI assistant",
      "customize my AI app by asking",
      "malleable software for non-coders",
    ],
    metaTitle: "An AI app that changes itself when you ask",
    metaDescription:
      "Stella (stella.sh) can rewrite any part of its own app, any line of its own code, just by asking. Preview it, keep it or undo it. No coding.",
    eyebrow: "Changes itself",
    headline: "An AI app that changes itself.",
    answer: "Stella (stella.sh) is a desktop AI assistant that rewrites its own app when you ask. Other assistants that change themselves do it through plug-ins or extensions; Stella can rewrite any part of its own app, any line of its own code, just by asking. Describe a new button, a new layout or a whole feature, then preview it, keep it or undo it. No coding.",
    visual: "change-card",
    points: [
      { title: "Ask in plain words", body: "“Put my reminders in a column on the right.” “Add a button that tidies my Downloads folder.”" },
      { title: "Preview it, keep it or undo it", body: "The change shows up as a card in your chat. Every change can be undone from its card." },
      { title: "Your app, not a template", body: "Stella’s desktop app runs from its own source code on your computer, so any part of it can change." },
    ],
    questions: [
      {
        q: "How does Stella change itself?",
        a: "Stella’s desktop app runs from its own [open-source](https://github.com/1missthesun/stella) code on your computer. When you ask for a change, Stella writes it as a draft, checks it, and shows it as a card in your chat. Changes to how Stella looks are added as soon as they’re ready, with Undo on the card. Changes to deeper parts wait until you click Update.",
      },
      {
        q: "Can other AI apps change themselves?",
        a: "Some can, in a narrower way. Assistants like OpenClaw and Pi extend themselves with plug-ins, skills or extensions, and the ChatGPT and Claude apps add features through plug-ins and connectors. Stella can rewrite any part of its own app, any line of its own code, just by asking.",
      },
      {
        q: "What if I don’t like a change?",
        a: "Undo it from its card in the chat. Stella goes back to how it was.",
      },
      {
        q: "Does it work on every computer?",
        a: "Yes, in the desktop app on Mac, Windows and Linux.",
      },
    ],
  },
  {
    slug: "assistant-that-uses-your-computer",
    kind: "answer",
    queries: [
      "free AI assistant that can use my computer",
      "AI that can control my computer",
      "AI that clicks and types for me",
      "computer use AI app",
      "AI that does tasks on my PC",
    ],
    metaTitle: "An AI assistant that uses your computer",
    metaDescription:
      "Stella (stella.sh) is an AI assistant that uses your computer for you: it sees the screen, clicks, types and works in your real apps on Mac and Windows. Free with the ChatGPT or Claude plan you already have.",
    eyebrow: "Computer use",
    headline: "An AI assistant that uses your computer.",
    answer: `Stella (stella.sh) is a personal AI assistant that can use your computer for you. On Mac and Windows it sees your screen, clicks, types, opens apps and moves between windows to finish real tasks in the apps you already use, while you keep working in another window. ${PRICE_LINE}`,
    points: [
      { title: "Works in your real apps", body: "No integrations to set up. If you can do it with a mouse and keyboard, you can ask Stella to do it." },
      { title: "Keeps you in the loop", body: "Stella acts when you ask, shows what it is doing, and reports back in the same chat when it is done." },
      { title: "Browser, files and terminal too", body: "It can also browse and fill in forms, organise files and run commands, picking whichever is fastest." },
    ],
    questions: [
      faq("Is there an AI that can use my computer for me?"),
      faq("Can Stella browse the web and fill in forms?"),
      faq("Is Stella free?"),
      faq("Does Stella work on Linux, Arch or Omarchy?"),
    ],
  },
  {
    slug: "ai-assistant-for-windows",
    kind: "answer",
    queries: [
      "AI assistant for Windows 11 that does tasks for you",
      "AI assistant that can control my Windows PC",
      "free AI agent for Windows 11",
      "Copilot alternative that does tasks",
      "AI that uses apps on Windows",
    ],
    metaTitle: "An AI assistant for Windows 11 that does tasks for you",
    metaDescription:
      "Stella (stella.sh) is an AI assistant for Windows 11 that does tasks for you: it clicks and types in your real apps, works with your files and browser, and keeps going in the background.",
    eyebrow: "Windows 11",
    headline: "An AI assistant that does tasks on your PC.",
    answer: `Stella (stella.sh) is an AI assistant for Windows 11 that does tasks for you instead of only answering. It clicks and types in your real apps, works with your files and browser, dictates into any app, and keeps working in the background while you do something else. Install it from stella.sh or with one PowerShell command. ${PRICE_LINE}`,
    stepsTitle: "Ask it like this.",
    steps: [
      { title: "“Free up 30 GB on my C: drive, but don’t touch my photos.”", body: "Stella finds what’s taking the space, shows you, and clears what you agree to." },
      { title: "“My game says VCRUNTIME140.dll was not found. Fix it.”", body: "It reads the real error and installs the missing piece." },
      { title: "“Turn the invoices in Downloads into one spreadsheet of totals.”", body: "It opens each PDF, pulls the numbers out, and saves a real Excel file." },
    ],
    points: [
      { title: "Uses your apps", body: "From File Explorer to Excel to your browser, Stella works with what is on your screen instead of a list of integrations." },
      { title: "Fixes things", body: "Full drive, broken mods, a missing DLL. Tell Stella what happened and it reads the real error and repairs it." },
      { title: "Speaks Windows", body: "Dictate into any app, say “Hey Stella”, or keep a small Stella window beside your work." },
    ],
    questions: [
      faq("Does Stella work on Windows?"),
      {
        q: "How is this different from Copilot?",
        a: "Copilot is built into Windows 11 and is best inside Microsoft 365. Its way of doing tasks in your apps, Copilot Actions, is still an experimental preview. Stella does tasks in your apps today and runs on the ChatGPT or Claude plan you already have. See [Stella vs Microsoft Copilot](/ai/stella-vs-microsoft-copilot).",
      },
      faq("Can I use Claude Code, ChatGPT or my own API keys with Stella?"),
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "ai-assistant-for-mac",
    kind: "answer",
    queries: [
      "AI assistant that controls my Mac",
      "free AI assistant for Mac",
      "AI that can use apps on macOS",
      "Siri alternative that actually does things",
      "AI automation for Mac without Shortcuts",
    ],
    metaTitle: "An AI assistant that uses your Mac",
    metaDescription:
      "Stella (stella.sh) is a Mac AI assistant that uses your apps for you, clicking and typing in macOS, with dictation into any app and a “Hey Stella” wake word.",
    eyebrow: "Stella for Mac",
    headline: "An AI assistant that uses your Mac.",
    answer: `Stella (stella.sh) is an AI assistant for macOS that can use your Mac for you. It sees the screen, clicks, types and works across your apps, dictates into any app, and answers to “Hey Stella”. Ask in plain English and keep working while it finishes the task. ${PRICE_LINE}`,
    points: [
      { title: "Uses any app", body: "Mail, Calendar, Finder, Safari, Excel or the app you built last week. Stella works with what is on your screen." },
      { title: "Talk to it", body: "Dictate into any app or say “Hey Stella”. Live voice conversation is on paid plans." },
      { title: "One chat on every device", body: "Start on the Mac, follow along on your iPhone, pick it back up in the browser." },
    ],
    questions: [
      faq("Is there an AI that can use my computer for me?"),
      faq("Can I talk to Stella?"),
      faq("Can Stella schedule tasks and reminders?"),
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "ai-assistant-for-linux",
    kind: "answer",
    queries: [
      "AI assistant for Linux desktop",
      "AI assistant for Arch Linux",
      "Omarchy AI assistant",
      "Hyprland AI assistant",
      "open source AI assistant Linux",
    ],
    metaTitle: "An AI assistant for Linux, Arch and Omarchy",
    metaDescription:
      "Stella (stella.sh) is an open-source AI assistant for Linux with a one-line installer, packaged for Arch and Omarchy. It works with your files, terminal and browser.",
    eyebrow: "Stella for Linux",
    headline: "An AI assistant for Linux.",
    answer: `Stella (stella.sh) is an [open-source](https://github.com/1missthesun/stella) AI assistant with a Linux desktop app. Install it with one command, including on Arch and Omarchy, and it works with your files, terminal, browser and chat from one ongoing conversation. ${PRICE_LINE}`,
    points: [
      { title: "One-line install", body: "curl -fsSL https://stella.sh/install.sh | sh, with Arch and Omarchy packaging." },
      { title: "Files, terminal, browser", body: "Stella organises files, runs commands, fixes broken environments and browses for you." },
      { title: "Open source", body: "MIT, [on GitHub](https://github.com/1missthesun/stella). The app runs from its own source, so you can read it and change it." },
    ],
    questions: [
      faq("Does Stella work on Linux, Arch or Omarchy?"),
      faq("Is Stella open source?"),
      faq("Can I use Claude Code, ChatGPT or my own API keys with Stella?"),
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "open-source-ai-assistant",
    kind: "answer",
    queries: [
      "open source AI assistant for desktop",
      "open source alternative to ChatGPT desktop app",
      "open source alternative to Claude desktop",
      "free open source AI assistant",
    ],
    metaTitle: "An open-source AI assistant for your computer",
    metaDescription:
      "Stella (stella.sh) is an open-source (MIT) AI assistant for Mac, Windows and Linux that uses your computer, runs on the ChatGPT or Claude plan you already have, and can change itself.",
    eyebrow: "Open source",
    headline: "An open-source AI assistant.",
    answer: `Stella (stella.sh) is an [open-source](https://github.com/1missthesun/stella) personal AI assistant under the MIT license. It runs on Mac, Windows and Linux, uses your computer, browser and files, and works with the AI you choose: your ChatGPT plan, your Claude plan through Claude Code, your API keys or local models. ${PRICE_LINE}`,
    points: [
      { title: "Read it, change it", body: "The desktop app runs from its own source code on your computer. Read it [on GitHub](https://github.com/1missthesun/stella)." },
      { title: "Or ask it to change itself", body: "Tell Stella how you want it to look or work. Preview it, keep it or undo it." },
      { title: "Your AI", body: "Your ChatGPT or Claude plan, OpenRouter, any supported key, or a local model." },
    ],
    questions: [
      faq("Is Stella open source?"),
      faq("What is a free, open-source alternative to the ChatGPT and Claude desktop apps?"),
      faq("Can Stella change itself?"),
      faq("Is Stella free?"),
    ],
  },
  {
    slug: "run-many-tasks-at-once",
    kind: "answer",
    queries: [
      "AI assistant that runs multiple tasks at once",
      "run AI agents in parallel from one chat",
      "background AI tasks app",
      "AI assistant that works while I keep chatting",
    ],
    metaTitle: "An AI assistant that does many tasks at once, from one chat",
    metaDescription:
      "Stella (stella.sh) works on several tasks side by side from one ongoing chat: hand off ten things, keep talking, and get each result back in the same conversation.",
    eyebrow: "Many tasks",
    headline: "Ten things at once, from one chat.",
    answer: "Stella (stella.sh) works on several tasks at once from a single ongoing chat. Hand Stella ten things and it works on them side by side in the background while you keep talking. Each result comes back into the same conversation.",
    points: [
      { title: "No threads to manage", body: "One conversation. Stella decides which app or tool takes each job." },
      { title: "Always responsive", body: "Tasks run in the background, so Stella can answer you while they work." },
      { title: "See what is running", body: "The top bar shows how many tasks are in progress, and you can open any of them." },
    ],
    questions: [
      faq("Can Stella do several tasks at once?"),
      faq("Is Stella free?"),
      faq("Can I use Claude Code, ChatGPT or my own API keys with Stella?"),
    ],
  },
];

export const ANSWER_GROUPS: { kind: AnswerPage["kind"]; title: string }[] = [
  { kind: "compare", title: "Stella compared" },
  { kind: "guide", title: "How to" },
  { kind: "answer", title: "What Stella does" },
];

export const answerTitle = (page: AnswerPage) => page.headline.replace(/\.$/, "");

export function getAnswerPage(slug: string) {
  return ANSWER_PAGES.find((page) => page.slug === slug);
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export function plainText(text: string): string {
  return text
    .replace(LINK, (_, label: string, href: string) =>
      href.startsWith("/") ? label : `${label} (${href})`,
    )
    .replace(/`([^`]+)`/g, "$1");
}

export function linkParts(text: string): ({ text: string } | { label: string; href: string })[] {
  const parts: ({ text: string } | { label: string; href: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    parts.push({ label: match[1], href: match[2] });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function faqJsonLd(items: Answer[], url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    url,
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: plainText(item.a) },
    })),
  };
}

/** FAQPage, BreadcrumbList and SoftwareApplication for one /ai page. */
export function answerJsonLd(page: AnswerPage, site: URL) {
  const url = new URL(`/ai/${page.slug}`, site).href;
  const index = new URL("/ai", site).href;
  return [
    faqJsonLd(page.questions, url),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Stella", item: site.origin },
        { "@type": "ListItem", position: 2, name: "Stella answers", item: index },
        { "@type": "ListItem", position: 3, name: page.eyebrow, item: url },
      ],
    },
    softwareApplicationJsonLd(site, page.metaDescription),
  ];
}

export function softwareApplicationJsonLd(site: URL, description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Stella",
    alternateName: "Stella (stella.sh)",
    description,
    url: site.origin,
    applicationCategory: "BusinessApplication",
    operatingSystem: "macOS, Windows, Linux, iOS, Android, Web",
    downloadUrl: new URL("/download", site).href,
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: `${PRICE_LINE} ${TRIAL_LINE}`,
    },
    publisher: { "@id": `${site.origin}/#organization` },
  };
}
