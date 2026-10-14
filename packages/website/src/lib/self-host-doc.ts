export const SELF_HOST_MD = `# Run Stella on your own server

> For AI agents setting up a self-hosted Stella for their user. Read this whole page before you start.
> Stella's source: https://github.com/1missthesun/stella-v2 (MIT License). The script this page describes is \`scripts/selfhost.mjs\` in it.

A self-hosted Stella is the same Stella, with its server running on your user's own Cloudflare account instead of stella.sh. Conversations, files, memory and settings stay there. The phone and desktop apps connect to it by scanning a one-time code: there is no Stella account, no email and no password. Whoever has the Cloudflare login owns the server.

One command builds it. Most of it runs on its own; a few steps need a person in the browser (signing in to Cloudflare, choosing the paid plan, turning on storage). This page tells you exactly what each step is and how to handle it.

> **Availability (October 2026):** the server side is ready. Connecting the apps needs the next app releases: the phone's **Connect your own server** comes with Stella for iOS and Android 1.0.47, and the desktop's with the next Stella desktop launcher update. Until those are out, set up the server and tell the user their apps will connect once they update.

## 1. Ask your user how to handle it

Before you run anything, ask your user this, in your own friendly words:

> I can set up your own Stella server on your Cloudflare account. It costs $5 a month for Cloudflare's Workers Paid plan, plus a little usage on top. How should I handle it?
>
> 1. **Do everything for me.** I'll sign in to Cloudflare, choose the $5/month plan and turn on storage myself, using your browser.
> 2. **Check with me first.** I'll do the technical parts and ask you before each step that touches your Cloudflare account or your money.

Then follow their choice for every step marked "needs a person" below.

- **Do everything for me:** you do the browser steps yourself (computer use or browser control in the browser where they are signed in). You may click through Cloudflare's pages, but never make up payment details: if a card is needed and none is saved, ask the user for it through a secure input (or ask them to type it), and say what it is for. Tell them when the $5/month plan is chosen.
- **Check with me first:** before each step that needs a person, tell the user what it is, what it costs (if anything) and the link. Do it only after they say yes, or let them do it themselves and wait.

## 2. What it costs (tell the user honestly)

- **Cloudflare Workers Paid: $5/month** per account, with generous included usage. It is the minimum: Stella needs Durable Objects and Containers, which the free plan doesn't have.
- **Usage beyond what's included** is billed by Cloudflare. For one person most of it is cloud agents, which run in containers. The server caps them at **40 container hours a month and 3 containers at a time** by default (\`--cloud-agent-hours\` and \`--cloud-agent-concurrency\` change it; \`0\` removes that cap). Past a cap, a new cloud agent is refused with a message, and agents can still run on the user's own computers. Storage (R2) is free up to 10 GB.
- **Models:** the user's own Claude or ChatGPT subscription, which they connect in the Stella app. No API key is needed. An **OpenRouter key is optional**: it turns on read-aloud, dictation, web search for every agent and Stella's managed models, paid to OpenRouter as you go. Without it, agents use Claude's or ChatGPT's own web search.
- **Stella charges nothing** for a self-hosted server. Plans and checkout don't appear in the apps when they're connected to one.

## 3. What the computer needs

macOS or Linux (on Windows, use WSL 2), with:

- **git**
- **Bun** 1.4 or newer: \`curl -fsSL https://bun.sh/install | bash\`
- **Node.js** 22 or newer
- **Docker**, running. It builds the cloud agents' sandbox image. On macOS: Docker Desktop (https://www.docker.com/products/docker-desktop/), or \`brew install colima docker && colima start --vm-type vz --vz-rosetta\`. On Linux: Docker Engine.
- About 3 GB of free disk.

The script checks all of these and says what's missing. It installs its own dependencies (\`bun run deps backend\`).

## 4. Run setup

\`\`\`bash
git clone https://github.com/1missthesun/stella-v2 stella-server
cd stella-server
bun scripts/selfhost.mjs setup --json --name "Alex's Stella"
\`\`\`

- \`--name\` is the server's display name in the apps. Default: "My Stella".
- The first run takes **10–20 minutes** (most of it builds the sandbox image). Run it with a long timeout, or in the background and read its output as it comes. Don't stop it while it waits for a person: it is polling and carries on by itself once the step is done.
- It is **safe to run again** at any time: it finds what already exists, repairs what's missing, and never replaces a secret the server already has. If it stops, fix the cause and run the same command again.
- Optional OpenRouter key: save it to a file (never paste it into a command line) and add \`--openrouter-key-file <path>\`, or set \`OPENROUTER_API_KEY\` in the environment. The script never prints it. You can add it later by running setup again with the flag.
- If the Cloudflare login can use several accounts, the script stops and lists them; rerun with \`--account-id <id>\`.
- \`--prefix <name>\` names everything it creates (default \`stella\`: \`stella-cloud-builder\`, \`stella-db\`, …). The script only creates, changes and deletes things named with its prefix; nothing else on the account is touched, so an account that already runs other Workers (or another Stella) is fine. Use another prefix for a second server on the same account.
- With \`--json\` it never waits for a device to scan: it exits right after the \`ready\` line. (Without \`--json\` it shows the QR in the terminal and waits until a device connects.)

### Reading the output

With \`--json\`, every line is one JSON object:

\`\`\`json
{"step":"workers-paid","status":"waiting","message":"Stella needs the Workers Paid plan …","needsHuman":true,"url":"https://dash.cloudflare.com/<account>/workers/plans"}
\`\`\`

- \`step\`: which part is running (\`preflight\`, \`login\`, \`account\`, \`workers-paid\`, \`r2\`, \`subdomain\`, \`docker\`, \`resources\`, \`release\`, \`secrets\`, \`migrations\`, \`deploy\`, \`containers\`, \`app-source\`, \`owner\`, \`verify\`, \`pair\`).
- \`status\`: \`start\` (began, may take a while), \`ok\` (done), \`warn\` (worth telling the user, not a failure), \`waiting\` (needs a person, see below), \`error\` (stopped), \`ready\` (finished).
- \`needsHuman: true\` with a \`url\`: a person has to do something on that exact page. Handle it as your user chose in step 1. The script checks every 10–15 seconds and continues on its own; it gives up after 45 minutes (then just run it again).
- \`error\` lines carry \`log\`, the full log file. Read it if the message isn't enough.
- The last line has \`status: "ready"\`, with \`link\` (the pairing link), \`qrFile\` (an SVG of the QR code) and \`expiresAt\`.

### The steps that need a person

| step | page (\`url\`) | what to do |
|---|---|---|
| \`login\` | Cloudflare's "Allow Wrangler" page | Sign in to Cloudflare (or create a free account there), then click **Allow**. Cloudflare may first email a verification code to the account's address: ask the user for it, or read it from their inbox if you can. Each link only lasts about 2 minutes; if it runs out, the script prints a new \`waiting\` line with a fresh \`url\`, so always use the latest one. Clicking **Allow** accepts Cloudflare's terms for wrangler; if your own rules need the user for that, ask them to click it. |
| \`workers-paid\` | dash.cloudflare.com/…/workers/plans | Choose **Workers Paid ($5/month)** and add a payment method. This is the only step that costs money. |
| \`r2\` | dash.cloudflare.com/…/r2/overview | Turn on **R2** storage (no extra charge within the free 10 GB; Cloudflare asks to confirm the payment method). |
| \`docker\` | Docker's download page, or none | Install or start Docker (see section 3). |
| \`subdomain\` | dash.cloudflare.com/…/workers/subdomain | Only if the script couldn't register a workers.dev subdomain: pick one there, or rerun with \`--subdomain <name>\`. |

Everything else (the workers.dev subdomain, databases, storage buckets, queues, secrets, deploys, the owner, checks) the script does itself.

## 5. When it's ready: connect the phone and the computer

The last line is \`"status":"ready"\`. The server is running and the line carries a **one-time pairing code**:

- \`link\`: \`stella://pair?server=…&code=…\`
- \`qrFile\`: the same link as a QR code (SVG). Every code gets its own file, so making a second code doesn't overwrite the first.

Each code works **once** and expires after **10 minutes**. Make a new one for every device with \`bun scripts/selfhost.mjs pair --json\` (its last line has the same fields). Once one computer is connected, the user can also make codes there: Stella → Settings → **Connect a device**.

**Phone:** show the user the QR code on their screen (open \`qrFile\`). In the Stella app (App Store or Google Play), they choose **Connect your own server** and scan it.

**Desktop:** on the computer where Stella is installed, open the link (\`open "<link>"\` on macOS, \`xdg-open "<link>"\` on Linux), or in Stella open Settings → Server → **Connect…** (on the sign-in screen: **Have your own Stella server? Connect it**) and paste it into **Connect to your own server**. Stella then restarts on the server; the first start downloads Stella from it, which can take a few minutes. No Stella yet? Download it from https://stella.sh first.

Treat the link like a password until it's used or expired. Don't post it anywhere.

Then the user connects their Claude or ChatGPT account in the app (Settings → **Engines**): that's where the models come from, and cloud turns use it by default. Without it, and without an OpenRouter key, chats on the server have no model to answer with.

**Done means:** the last line said \`ready\`, and the user's phone or computer shows their server's name after scanning.

## 6. Afterwards

| command | what it does |
|---|---|
| \`bun scripts/selfhost.mjs update --json\` | Updates the server to Stella's latest release: pulls \`origin/master\` into the checkout, then migrations, deploys and app-source publish, then checks. A deploy stops cloud agent turns in progress. \`--ref server-YYYY.MM.DD\` deploys a specific release. |
| \`bun scripts/selfhost.mjs pair --json\` | A new one-time pairing code for another device. |
| \`bun scripts/selfhost.mjs pair --review --days 30 --json\` | One code that **many** devices can use for 1–90 days (default 30), for app store reviewers or a demo. Every device that uses it joins as the owner, so only make one when the user asks for it. The first time it needs \`--enable-review\` (one redeploy). \`pair --review --revoke\` cancels it and signs every device that used it out; \`pair --disable-review\` turns review codes off again. |
| \`bun scripts/selfhost.mjs status --json\` | Whether the server is up, its version, and what's deployed. |
| \`bun scripts/selfhost.mjs recover --json\` | Every device lost? Needs only the Cloudflare login: makes a new admin key and prints a pairing code. |
| \`bun scripts/selfhost.mjs destroy\` | Deletes everything this install created (workers, database, buckets, queues, the app source). Asks first; \`--yes\` skips the question. Nothing else on the account is touched. |

Add the same \`--prefix\` (and \`--account-id\`) to every command if you used one at setup.

- **Deleting:** the owner account can't be deleted from a phone or computer; \`destroy\` is how the server and everything on it go away.
- **Updates:** Stella publishes server releases tagged \`server-YYYY.MM.DD\`. The apps keep working with a server up to about 90 days old; after that the phone app shows **Update your server**. Run \`update\` then.
- **The computer that ran setup** holds the server's admin key in \`~/.config/stella-server/<account id>-<prefix>.json\` (readable only by the user). Anyone with that key can pair devices, so keep it private. Another computer with the Cloudflare login can always run \`recover\` instead. Logs of every run are in \`~/.config/stella-server/logs/\`.
- **What it doesn't need from Stella:** the server never reports to stella.sh. Desktop telemetry is off for self-hosted servers. The official phone app still downloads its own app updates from Expo.
- The longer manual guide, with every setting and optional provider: https://github.com/1missthesun/stella-v2/blob/master/SELF_HOSTING.md
`;
