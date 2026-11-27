import { MEDIA_MODELS } from "@stella/contracts/media-models";
import { BUDGET_COVERS, INCLUDED_IN_EVERY_PLAN, PAID_BILLING_PLANS, PLAN_CATALOG, PLAN_ORDER, planPriceLabel } from "@/lib/plans";
import { getSiteUrl } from "@/lib/site-url";

export type ProductDoc = {
  slug: string;
  title: string;
  covers: string;
  body: () => string;
};

const abs = (path: string): string => new URL(path, getSiteUrl()).href;

const docUrl = (slug: string): string => abs(`/docs/${slug}.md`);

const gb = (bytes: number): string =>
  bytes >= 1024 ** 3 ? `${Math.round(bytes / 1024 ** 3)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

const paidPlanList = (): string =>
  PAID_BILLING_PLANS.map((id) => `${PLAN_CATALOG[id].label} ${planPriceLabel(id)}`).join(", ");

const planNames = (): string => {
  const labels = PLAN_ORDER.map((id) => PLAN_CATALOG[id].label);
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
};

const driveSizes = (): string =>
  PLAN_ORDER.map((id) => `${PLAN_CATALOG[id].label} ${gb(PLAN_CATALOG[id].limits.driveBytes)}`).join(", ");

const MODELS = (): string => `Stella is the app; the thinking comes from a model you choose. Any one of these is enough, and they mix freely.

## Use an AI plan you already pay for
Stella adds no charge and no limit of its own on these; use counts against that plan. Sign in under Settings › Claude and ChatGPT.
- **ChatGPT** (Plus, Pro and other ChatGPT plans): Sign in with ChatGPT, then turn on "Enable ChatGPT plan use" for the account. Works on your computers and in the cloud.
- **Claude** (Pro or Max): through Claude Code, Anthropic's own tool. Stella installs it in one click if it's missing, keeps it updated and repairs a broken install. Sign in on each computer or in the cloud; connect several Claude accounts and choose which one each computer uses.
- **Gemini** (Google AI Pro or Ultra): Sign in with Google in the same tab. Gemini runs on the computer you signed in on and shows in the model picker on that computer and on your phone.

When a plan hits its own usage limit, a card in the chat shows what paused, with a Resume button.

## Stella's own models
With a Stella account, Stella's hosted models work with nothing to set up. New accounts get a small free trial; paid plans (${paidPlanList()}) include a monthly usage budget for them. See ${docUrl("plans-privacy-and-self-hosting")}.

## Your own API keys
Add a key from the model picker: Anthropic, OpenAI, Google, xAI, OpenRouter, Vercel AI Gateway, Cerebras, Hugging Face, Kimi (Moonshot), MiniMax, Z.AI, OpenCode, and GitHub Copilot by sign-in. A key added while signed in is saved to your Stella account, so it also works on your phone and in the cloud; signed out, it stays on that computer. Stella never bills use on your own key. New models from your providers appear in the picker as soon as they are released, and any unlisted model id can be typed in.

## Local models
Any OpenAI-compatible local server, such as Ollama or LM Studio: enter the server address and model name in the model picker.

## Choosing a model
- The model picker (Models in the top bar, or in the composer) sets the model and reasoning effort for a chat. Each chat remembers its choice, and the picker shows only models the place the chat runs can use.
- Type @ in the composer to send a message to another engine for that turn, for example to try Gemini when another model declines.
- Tell Stella which model to use for which kind of work ("use Claude for coding, ChatGPT for browsing") and she keeps it as a standing rule; the tasks she starts follow it.
- Realtime voice (Stella voices, OpenAI or Grok), read-aloud (Speechify or OpenAI) and image generation each have their own provider, set in the model picker's Voice and Image tabs.
`;

const MEMORY_AND_TASKS = (): string => `## One ongoing conversation
Stella is built around one conversation that keeps going: ask, follow up, come back tomorrow, and the context is still there. Results, reminders and scheduled work land in the same chat. A fresh chat is one click away when you want it; past chats stay in History.

## Background tasks
- Stella talks with you while the work runs in the background. Ask for several things at once and they run side by side as tasks; a task can start its own helpers. Each result comes back into the chat.
- Send a message while Stella is working and she switches to it. A quiet Stop appears next to the working indicator if a reply runs long.
- Tasks show their state: working, Waiting (with a clock), Paused, or flagged as possibly stuck. Stopping a task stops every helper under it.
- When a task has a question, Stella answers it herself when she can and asks you only what she can't settle. Question cards can be answered from any device, including the phone.
- Tasks pause when you quit and continue by themselves when Stella starts again; work cut off by an update, restart or crash picks up where it left off.
- When a conversation or task gets long, Stella writes herself notes (your instructions in your own words, what's done, what's next) and carries on.

## Memory
- Stella remembers across conversations in plain files under ~/.stella/memories: a main memory, standing rules, and notes for each area of your life or work. Signed in, memory syncs across your devices.
- Tell Stella a rule once ("always use metric", "never email my boss without asking") and every task follows it.
- Ask her in plain words to remember, forget or correct something. Settings › Privacy › Memory turns memory off without deleting it.
- Stella can search and re-read the whole conversation history, including parts already summarized, so "what did we decide about the trip?" works weeks later.

## How Stella reaches you
- The bell in the top bar keeps your notifications, read or not (the last 200). The app icon shows an unread badge, and a soft sound plays when Stella messages you.
- Settings › General › When Stella needs you sets how hard she tries when she needs an answer: chat only, desktop notification, sound and phone push, or a push that pierces focus mode. Add quiet hours and a limit on asks per hour.
`;

const DEVICES_AND_CLOUD = (): string => `## Where Stella runs
- **Mac** (one app for Apple silicon and Intel), **Windows**, and **Linux** (x64 and arm64, including Arch and Omarchy): ${abs("/download")}. Or install from a terminal: \`curl -fsSL ${abs("/install.sh")} | sh\` on Mac or Linux, \`irm ${abs("/install.ps1")} | iex\` in PowerShell on Windows.
- **iPhone and iPad** (App Store) and **Android** (Google Play).
- **Web**: ${abs("/chat")}, nothing to install.
- The desktop app works without an account. The phone, the web, sync and the cloud need a Stella account (Google or an email link; passkeys on the web).
- The app is available in 28 languages.

## Your phone and your computers
- Sign in with the same account and everything follows you: the conversation, Email, Files, Schedule, Apps and task activity. A phone can also connect to a computer by scanning a QR code.
- From the phone or the web, Stella can run work on any of your computers that is on. Each computer asks once whether your other devices may start tasks on it (Settings › Privacy › Work from your other devices).
- If the computer a chat runs on is asleep or offline, another of your computers that is on picks the chat up; the cloud steps in only when none can.
- Settings › General › Keep computer awake stops the computer sleeping while Stella is open.

## The cloud
- On paid plans, tasks can run in Stella's cloud, each in its own computer with a browser, so they keep going when your computers are off. Scheduled work and apps run there too.
- Choose where a chat runs from the top bar, or just say it: "do this on my work laptop", "run this in the cloud". A running task can move itself to another computer or the cloud and keep its history.
- ChatGPT, Claude Code, your API keys and Stella's models all work in the cloud.

## Stella Drive and files
- Stella Drive is your file space in Stella's cloud: ${driveSizes()}. Files Stella makes in the cloud land there, and Drive links open on every device with previews for images, audio, video, PDFs and web pages.
- Files on a computer stay on it unless shared. A link to one opens from that computer on your other devices while it is on.
- Attach files of any size to a message, from any device.

## What syncs
Signed in: conversations (Settings › Privacy › Save chat history in the cloud; off keeps chats on that computer), memory, settings, saved logins (end-to-end encrypted, see ${docUrl("connectors-and-logins")}), custom skills, and Claude Code sessions.
`;

const BROWSER_AND_COMPUTER = (): string => `## In your own browser: Stella for Chrome
- The Stella for Chrome extension (Chrome, Arc, Brave and Edge) lets Stella work in your browser, signed in as you, in a tab group of her own so your tabs stay yours.
- Tabs Stella opened for a task close a few minutes after it ends and come back if it resumes; tabs you took over stay open.
- Settings › General › Stella for Chrome chooses which browser Stella uses when several have the extension.

## Stella's browser
- The desktop app has a built-in browser that opens as a tab in the top bar. Sign in to a site there once and Stella stays signed in, for you and for her tasks.
- Files Stella downloads there are ready for her tasks to use.

## The cloud browser
- Tasks in the cloud have a browser of their own. When a site needs you to sign in or enter a code, a card opens the live page for you to finish it; Stella can't see what you type, then picks up where she left off.
- Settings › Privacy › Browser sign-ins lists the sites Stella is signed in to and signs out of all of them.

## How Stella browses
Stella waits for pages to settle, types and clicks at a natural pace, and keeps passwords out of what her tasks read. For a site you use again and again (checking orders, tracking prices or statuses), Stella can learn the private API behind it, so repeat checks are fast and reliable.

## Computer use
- **macOS**: Stella sees the screen, clicks and types in your apps. Setup asks for the Screen Recording and Accessibility permissions. Settings › Privacy › Locked computer use keeps tasks running after the Mac locks.
- **Windows**: Stella works in the background, without taking over your mouse and keyboard, unless you ask her to take over.
- **Linux**: Stella uses apps on Hyprland desktops such as Omarchy, in the background.
- Everywhere, Stella also works through the terminal, files and the apps' own command-line tools when that is faster.

To show Stella something on your screen, see Show Stella in ${docUrl("voice-and-companion")}.
`;

const VOICE_AND_COMPANION = (): string => `## Dictation
- Press the dictation shortcut (Option on Mac, Alt on Windows and Linux; change it in Settings › Shortcuts) to start, and press again to finish. It works in Stella and in any other app: the words land wherever you are typing.
- Or press the mic in the composer, on any device. On the phone it keeps recording when you switch apps.
- Settings › Audio: Super Fast dictation keeps the mic warm so the first word is never lost; dictation sounds; microphone and speaker choice.
- Dictation is on every plan. A Mac without a Stella account can transcribe on the device.

## Read aloud
Stella can speak her replies (Speechify or OpenAI voices). Play any reply from its actions, or turn on Read replies aloud from the composer's + menu or the companion's menu. It's on every plan.

## "Hey Stella"
Turn on the wake word in Settings › Audio and say "Hey Stella" to start a voice conversation with no clicking. It listens on your computer, stays off until you turn it on, and steps back when you say "bye".

## Live voice conversation
- Talk back and forth like a phone call. Stella hears you in real time, answers out loud, uses her tools and keeps tasks going, and can look at your screen when you ask.
- Start it from the composer, the voice shortcut (Cmd+Shift+D on Mac, Ctrl+Shift+D elsewhere), "Hey Stella", or the phone app.
- Voices: Stella voices, OpenAI or Grok. The transcript stays in the conversation with a short summary.
- Live voice comes with every paid plan, or runs on your own OpenAI or xAI key.

## Show Stella
- Record your screen while you talk, to show Stella what you mean: press Option+Shift+S (Alt+Shift+S on Windows), or pick Record screen from the + menu. It works from any app on Mac and Windows.
- Talk and click around as you normally would. Hold Shift to draw red marks on the screen, Shift-click to pin a mark, Esc to discard.
- Stop, add a note if you like, and it goes to Stella, who watches the recording, hears what you said and sees what you drew.

## Desktop companion
Settings › General › Desktop companion puts a small Stella on your desktop, above your other windows. Click it for a mini composer. It shows Stella's replies as bubbles and a count of tasks in progress, and its menu starts dictation or a voice conversation and turns read-aloud on or off.
`;

const mediaLines = (): string =>
  MEDIA_MODELS.map((model) => `- ${model.name} (${model.kind}): ${model.does.replace(/ \([a-z_]+(?:, optional [a-z_]+)?\)/g, "")}`).join("\n");

const sentenceList = (items: readonly string[]): string =>
  items.map((item) => (item.startsWith("Stella") ? item : item.charAt(0).toLowerCase() + item.slice(1))).join(", ");

const APPS_FILES_MEDIA = (): string => `## Documents
- Stella creates and edits real Word, Excel and PowerPoint files (formatting, formulas, charts, proofreading) and PDFs, ready for the apps you already use, with a live preview while she works.
- Files, pages and apps open in one viewer you can resize or pull out into its own window: images, audio, video, PDFs, Office files, text and logs.

## Canvases
- For reports, dashboards, plans and interactive pieces, Stella writes a web page (a canvas). It opens in the viewer and shows as a preview card under the reply, on the computer and the phone.
- Buttons and forms in a canvas send your choice straight back to the chat.
- Canvases are private by default. Make one public to get a link anyone can open, and make it private again any time.

## Apps
- Stella builds working apps and sites: real projects on your computer (including ones with a separate frontend and server) that stay running while you use them, under Apps.
- Cloud apps are hosted by Stella, so they open in Apps on your computer, the web and your phone.

## Research and maps
Stella searches and reads the web and answers with sources, and shows places, routes and maps in the chat.

## Images, video, music, speech and 3D
Ask in plain words ("make a 10-second clip of…", "turn this photo into a 3D model") and Stella picks the model. Generation comes with every paid plan and uses its usage budget. Video always has sound. Current models:
${mediaLines()}

Transcription of audio and video files works on every plan. Agents calling these models directly: ${abs("/docs/media")}.
`;

const EMAIL_AND_SCHEDULES = (): string => `## Email
- Connect Gmail (one or more Google accounts) and Stella reads your new mail at set times (three times a day on paid plans, once a day on Free). Urgent mail wakes her in between and reaches your phone.
- The Email page, on the computer, the web and the phone, keeps what matters: **Needs you** (with her suggestion and a drafted reply), **I handled** (with undo), and **Waiting on others**. Noise is left out, with Clear all and Unsubscribe for it; a log shows what Stella did.
- Replies stay Gmail drafts until you tap Send. Stella never sends or archives on her own unless a standing instruction says so.
- Teach it in plain English: "tell me right away when my landlord emails", "when an invoice arrives, file it in Drive", "newsletters don't matter". Mail you dismiss teaches her too.
- On Free, Stella sorts your mail; prepared replies and summaries need a paid plan or your own OpenRouter key.
- Beyond the Email page, Stella can find emails, catch up on threads and draft or send replies whenever you ask.

## Schedules
Ask in plain words and Stella sets it up; a card in the chat confirms it, and the Schedule page (computer and phone) lists everything.
- **Reminders**: a message at a time or on repeat, with Done and Snooze.
- **Scheduled tasks**: Stella does a piece of work at a time or on repeat ("every Monday at 8, summarize my week") and reports back in the chat.
- **Watches**: a small check runs on a timer without using AI (a price, a page, a delivery status) and Stella steps in only when it finds something, so watching is cheap.
- On Free, scheduled work runs on your computer and waits for it if it is off or asleep; on paid plans it can run in the cloud. Daily runs per plan: ${PLAN_ORDER.map((id) => `${PLAN_CATALOG[id].label} ${PLAN_CATALOG[id].limits.scheduleFiresPerDay}`).join(", ")}.
`;

const CONNECTORS_AND_LOGINS = (): string => `## Connect your apps
- Ask Stella to use a service and she offers a one-click connect card, then keeps working. Google (Gmail, Calendar, Docs, Drive; several Google accounts at once) and more than 120 services by sign-in, among them Notion, GitHub, Linear, Jira, Outlook, Zoom, Todoist, Spotify, Stripe, HubSpot, Salesforce, Figma, Dropbox, Airtable, Asana and Calendly.
- Connections belong to your account, so they work on every computer and in the cloud. Stella carries out each action for you without handing your credentials to the model.
- Apps and sites without a connector are still in reach through Stella's browser and computer use (${docUrl("browser-and-computer-use")}).

## Custom MCP servers
Give Stella an MCP server's address (or the command that starts it) and she adds it to your account, so its tools work in the cloud and on every computer. A server started by a command runs on that computer and is reached through it while it is on.

## Secure input
When a task needs a password, card number, one-time code or address, Stella shows a secure card on whichever device you're on, phone included. Sensitive values go straight into the page field or command that needs them; the model never sees them.

## Saved logins
- Choose to remember a login or card from a secure card and Stella uses it next time without asking, and without ever reading it. They live in your devices' secure storage; manage them in Settings › Saved private values.
- Turn on Sync to your other devices to have them on all your computers and your phone. Sync is end-to-end encrypted: only your own devices can open them, not Stella's servers.
- A new device joins with a 6-digit code shown on both screens. Allow on any of your trusted devices answers for all of them.
- Tasks in the cloud can use saved logins too.
`;

const SELF_MODIFICATION = (): string => `## Change anything by asking
The desktop app runs from its own source code on your computer, and Stella can change any line of it. Other assistants change through plug-ins or extensions; Stella rewrites itself. Ask in plain chat: a new layout or colour, a button or panel, a new feature, different behaviour. No coding.

## How a change goes in
- A task prepares the change as a draft and Stella checks it still starts.
- A change to the interface only goes in as soon as the task finishes, with Undo on the card under its report. A look change that breaks something undoes itself.
- Anything deeper (the runtime, the desktop shell) waits until you click Update on that card.

## On all your computers
- Changes you make reach your other computers with one Update. They are merged before they are offered, and you choose this computer only or all of them; a computer that is off gets them when it is back.
- Stella installs new versions by herself (the arrow next to the Update button turns Automatic updates off). If a new version overlaps your changes, Stella merges the two, checks the result starts, then installs it; if it can't, she stays on the version you have and leaves the Update button for you.

## Behaviour, rules and personality
- Tell Stella how to behave (tone, what to always or never do, which model for which work) and she keeps it as a standing rule that every task follows.
- Her personality and instructions are part of the app too: ask and she can rewrite them.

## Skills
Stella keeps reusable how-tos as skills (in ~/.stella/skills) and can write new ones from a workflow you worked out together. Your custom skills upload to your account so tasks in the cloud have them.

## Open source
MIT licence: https://github.com/1missthesun/stella.
`;

const planLine = (id: (typeof PLAN_ORDER)[number]): string => {
  const plan = PLAN_CATALOG[id];
  const extras = [
    plan.cloudContainers ? "tasks in the cloud" : "tasks on your own computers",
    plan.mediaGeneration ? "image, video, music and 3D" : null,
    `${gb(plan.limits.driveBytes)} Drive`,
  ].filter(Boolean);
  const what = id === "free"
    ? "the full app on your own ChatGPT, Claude or Gemini plan, API keys or local models, plus a small free trial of Stella's models"
    : `${plan.tagline.toLowerCase()} of Stella's models`;
  return `- **${plan.label}** — ${planPriceLabel(id)}: ${what}; ${extras.join(", ")}.`;
};

const PLANS_PRIVACY_SELF_HOST = (): string => `## Plans
Plans are ${planNames()}. There is no Go plan any more; pages that list one are out of date.
${PLAN_ORDER.map(planLine).join("\n")}

Every plan includes: ${sentenceList(INCLUDED_IN_EVERY_PLAN)}.

On your own ChatGPT, Claude or Gemini plan, Stella costs nothing on top and sets no limit of its own. Free needs no credit card. Live voice conversation comes with every paid plan; dictation, read-aloud and "Hey Stella" are on every plan.

## The usage budget
One budget pays for everything Stella runs on her side: ${sentenceList(BUDGET_COVERS)}. It is spread over shorter windows so one busy day can't use the month. When it runs out, that use pauses until it resets; extra credit keeps it going. Work on your own plan, API keys or local models doesn't touch it. See usage and change plans in Plans & Usage.

## Without an account
The desktop app works signed out, on your own ChatGPT, Claude or Gemini plan, API keys or local models. Conversations, memory and files stay on your computer and nothing about your conversations goes to Stella's servers. Sign in later and choose whether to add them to your account.

## Your data
- Signed in, conversations and task records are stored, encrypted, in Stella Cloud. They are never used to train models, sold, or shown in ads, and Stella staff have no view of your message content. Turn off Save chat history in the cloud (Settings › Privacy) to keep chats on that computer.
- Stella's own models pass requests through Stella's infrastructure so billing and limits work; the providers that serve them handle data under their own policies. On your own plan or key, requests go to that provider.
- Settings › Privacy: download your data, delete your data, grant 24-hour support access only when you choose, turn anonymous usage metrics off. Settings › Account: signed-in devices, passkeys, sign out everywhere, delete account.
- Privacy policy: ${abs("/privacy.md")}. Terms: ${abs("/terms.md")}.

## Self-hosting
Run Stella's server on your own Cloudflare account: about $5 a month for Cloudflare Workers Paid plus usage, models from your own Claude or ChatGPT subscription, and Stella charges nothing. There is no Stella account: the apps pair with your server by a one-time code. One command sets it up; agents follow ${abs("/self-host.md")}.
`;

export const PRODUCT_DOCS: ProductDoc[] = [
  {
    slug: "models",
    title: "Models and AI plans",
    covers: "Using your ChatGPT, Claude or Gemini plan, Stella's own models, your API keys, local models, and choosing a model per chat or task.",
    body: MODELS,
  },
  {
    slug: "memory-and-tasks",
    title: "Conversation, memory and tasks",
    covers: "The one ongoing chat, background tasks and helpers, memory and standing rules, searching past conversation, and how Stella reaches you.",
    body: MEMORY_AND_TASKS,
  },
  {
    slug: "devices-and-cloud",
    title: "Devices, cloud and Stella Drive",
    covers: "Every platform and how to install, phone and computers together, where work runs (your computers or the cloud), Stella Drive and what syncs.",
    body: DEVICES_AND_CLOUD,
  },
  {
    slug: "browser-and-computer-use",
    title: "Browser and computer use",
    covers: "Stella for Chrome, Stella's built-in browser, the cloud browser and sign-in handoff, learning a site's API, and computer use on macOS, Windows and Linux.",
    body: BROWSER_AND_COMPUTER,
  },
  {
    slug: "voice-and-companion",
    title: "Voice, Show Stella and the desktop companion",
    covers: "Dictation in any app, read-aloud, \"Hey Stella\", live voice conversation, recording your screen with Show Stella, and the desktop companion.",
    body: VOICE_AND_COMPANION,
  },
  {
    slug: "apps-files-and-media",
    title: "Documents, canvases, apps and media",
    covers: "Word, Excel, PowerPoint and PDF, the file viewer, interactive canvases and share links, local and cloud apps, and image, video, music, speech and 3D generation.",
    body: APPS_FILES_MEDIA,
  },
  {
    slug: "email-and-schedules",
    title: "Email and schedules",
    covers: "Gmail sorting (Needs you, I handled, Waiting on others), reply drafts and email rules; reminders, scheduled tasks and AI-free watches.",
    body: EMAIL_AND_SCHEDULES,
  },
  {
    slug: "connectors-and-logins",
    title: "Connectors and saved logins",
    covers: "Connecting Google and 120+ other services, custom MCP servers, secure input cards, and encrypted saved logins synced across devices.",
    body: CONNECTORS_AND_LOGINS,
  },
  {
    slug: "self-modification",
    title: "Changing Stella itself",
    covers: "Asking Stella to change its own app, Undo and Update, changes across your computers, automatic updates, standing rules, personality and skills.",
    body: SELF_MODIFICATION,
  },
  {
    slug: "plans-privacy-and-self-hosting",
    title: "Plans, privacy and self-hosting",
    covers: "What each plan costs and includes, the usage budget, using Stella without an account, where your data lives, account controls, and running your own server.",
    body: PLANS_PRIVACY_SELF_HOST,
  },
];

export const getProductDoc = (slug: string): ProductDoc | undefined =>
  PRODUCT_DOCS.find((doc) => doc.slug === slug);

export const PRODUCT_SUMMARY = "Stella (stella.sh) is a personal AI assistant made by FromYou LLC. You talk to it in one ongoing chat on Mac, Windows, Linux, iPhone, iPad, Android or the web, and it does the work: it uses your computer and browser, works with your files, makes documents, pages, apps and media, sorts your email, runs schedules, and works on several tasks in the background while you keep talking. It runs on the ChatGPT, Claude or Gemini plan you already pay for, your own API keys, local models, or Stella's own models, and the desktop app can rewrite any part of itself when you ask. Open source (MIT).";

export const renderProductDocsIndex = (): string => `# Stella product docs

> How Stella works, for agents and people answering questions about it. Each topic below is one short, self-contained file: fetch only the one you need.

${PRODUCT_SUMMARY}

Plans: ${PLAN_ORDER.map((id) => `${PLAN_CATALOG[id].label} (${planPriceLabel(id)})`).join(", ")}. Free with the ChatGPT, Claude or Gemini plan you already have.

## Topics
${PRODUCT_DOCS.map((doc) => `- [${doc.title}](${docUrl(doc.slug)}): ${doc.covers}`).join("\n")}

## More
- [Media API](${abs("/docs/media")}): calling Stella's media models directly.
- [Self-host setup](${abs("/self-host.md")}): step-by-step server setup, for agents.
- [What's New](${abs("/learn-more/whats-new.md")}): every release, newest first.
- [Site map](${abs("/llms.txt")}): every page on stella.sh, including comparisons and how-to guides.
`;

export const renderProductDoc = (doc: ProductDoc): string => `# ${doc.title}

> Part of Stella's product docs (${abs("/docs.md")}). ${doc.covers}

${doc.body().trim()}
`;
