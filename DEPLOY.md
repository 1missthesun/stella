# Deploying Stella (dev and prod)

Commit to `master`, `git fetch` + rebase before deploying, push after. Other
sessions deploy dev too. Never print secrets: pipe them into `wrangler secret put`.
Nothing user-facing deploys on push except the R2 asset workflows noted below.

**To test a backend change, don't deploy dev: start your own Preview**
(next section). Dev is one shared deployment, and every agent's test deploy
replaces the one before it. Deploy dev to ship what is on `master`, or when a
claim needs what a Preview lacks (containers, the desktop's own model calls).
That needs no go-ahead, but `deploy:dev` (cloud-builder, model-gateway) runs
`scripts/check-dev-deploy.mjs` first and refuses a dirty tree or a HEAD missing
commits from origin/master, which is how agents kept rolling back each other's
work. Push your commits right after, or the next deploy from master removes
them, and say in your report that you deployed dev. `STELLA_DEV_DEPLOY_FORCE=1`
skips the check; use it only to restore dev deliberately.

**Pushes that publish to every install, prod included**, with no further step:
`packages/native/` or its workflow file (native helpers); installs pick them up
at their next launcher prepare. Treat a master push touching them as a prod
release and get the go-ahead first; to validate a build without publishing, run
`build-native-helpers.yml` by hand with `publish=false`. stella-browser is
different: a push publishes it to the dev channel only (see Desktop, step 4),
and prod moves when someone runs `promote-stella-browser.yml`.

**Logins differ per machine and change; check instead of assuming.**
`env -u CLOUDFLARE_API_TOKEN bunx wrangler whoami` lists the scopes
(`artifacts (write)` for app-source publish; stored Workers Logs are read
with a separate token, see "Reading Worker logs"), and `bunx eas-cli whoami`
shows the EAS account. When a login is
missing, hand the step to the computer that has it or ask the user to sign in
there; never copy credentials between machines. A secret only the user has
(a provider key such as dev's `COMPOSIO_API_KEY`) is collected with
`request_secure_input` (sensitive field) and written with `use_secure_value`
into `bunx wrangler secret put NAME`, never pasted into chat.

## Previews: your own backend for testing

`bun run preview -- up` (from `workers/cloud-builder`) deploys your tree's
cloud-builder as a [Worker Preview](https://developers.cloudflare.com/workers/previews/)
and prints its URL. Every Preview is a separate copy of the backend, so it
cannot overwrite dev or another agent's Preview.

```bash
cd workers/cloud-builder
env -u CLOUDFLARE_API_TOKEN bun run preview -- up --name <short-name>   # ~1 min; rerun to update
export STELLA_BACKEND_URL=https://<short-name>-stella-v2-cloud-builder-preview.fromyou.workers.dev
node ../../.agents/skills/verify-stella/cloud-turn.mjs --prompt "Reply with exactly: ok"
node ../../.agents/skills/verify-stella/control-stella.mjs session launch --account pro
env -u CLOUDFLARE_API_TOKEN bun run preview -- down --name <short-name>  # when finished
```

`--name` defaults to the git branch (at most 31 characters of `a-z0-9-`).
`bun run preview -- list` shows the Previews that exist. Delete yours when you
are done.

How it is isolated:

- Every Preview lives under its own Worker, `stella-v2-cloud-builder-preview`,
  never `stella-v2-cloud-builder-dev`. `up` cannot change dev's code, vars,
  secrets or routes.
- **Durable Objects** (conversations, owner gates, worlds, sessions) get a
  separate namespace per Preview from Cloudflare. They are deleted with the
  Preview.
- **D1**: `up` creates `stella-v2-preview-<name>`, applies this tree's
  migrations to it, and binds it. `down` deletes it. Test accounts, sessions
  and every other row exist only there.
- **R2 and KV**: Previews share test resources (`stella-v2-*-preview` buckets
  with 14-day expiry, KV `stella-v2-app-routes-preview`). Keys are
  per-owner, and owners are unique per Preview. `ASN_POLICY` is dev's,
  which is read-only. `CANVAS_SHARES` is the shared `stella-canvas-shares`,
  as in dev.
- **Secrets** come from the preview Worker's base config, so a new Preview
  has them with no setup: `BETTER_AUTH_SECRET`, `OWNER_SECRETS_KEK`,
  `OAUTH_STATE_SECRET` and `MEDIA_SIGNING_SECRET` are Preview-only random
  values, and `STELLA_ADMIN_API_SECRET` and `BUILDER_SERVICE_SECRET` equal
  dev's, so existing tooling works unchanged. `CAPABILITY_SIGNING_KEY` is the
  `builder-preview-1` key, which the dev model gateway trusts (its
  `CAPABILITY_JWKS`) for the Preview's cloud turns and desktop sessions. To give one Preview a third-party key (fal,
  Stripe test, …):
  `... | bunx wrangler preview secret put NAME --worker-name stella-v2-cloud-builder-preview --name <name>`.
- **Web search** needs no secret anywhere: every environment and Preview
  reaches Cloudflare's Web Search API through its `AI` binding and the
  account's `default` AI Gateway, billed to the account's AI Gateway credits
  (provider: var `WEB_SEARCH_PROVIDER`, Exa by default). If searches
  answer 402, the credit balance is empty: top it up under AI → AI Gateway →
  Credits.
- Configuration is the `previews` block of `wrangler.jsonc`. The Preview's own
  URL is passed as `CLOUD_BUILDER_PUBLIC_URL` (JWT issuer, turn broker), and
  `STELLA_AUTH_URL` is unset, so auth callbacks use that URL too.

What a Preview cannot do yet (Cloudflare limits, 2026-10):

- **No agent sandboxes.** Previews accept only fixed-image container apps.
  The `Sandbox` object picks its image and instance size per start
  (`scheduling_policy: "durable_object"`), which Wrangler refuses under
  `previews`. Chat turns, the orchestrator, auth, billing and every HTTP or RPC
  route work. Anything that starts a container (background agents, cloud
  shell, app builds) still needs dev.
- **Service bindings reach the dev Workers**: model gateway, browser gateway,
  telemetry. A Preview can't bind to another Worker's Preview, so a change
  that spans cloud-builder and the gateway still needs a dev gateway deploy.
  The gateway's calls back into cloud-builder (`BillingControl`: owner
  enforcement and usage) go to **dev** cloud-builder. For a Preview's owners,
  that means inert per-owner records in dev's `OwnerGate` namespace, under
  owner ids dev has never issued. No dev user is affected.
- **The desktop's own model calls go through the dev gateway.** The desktop
  exchanges its Preview sign-in at the dev gateway as usual. The dev gateway
  (var `PREVIEW_BACKEND_HOST_SUFFIX`, never set in production) verifies a
  token from `https://<name>-stella-v2-cloud-builder-preview.fromyou.workers.dev`
  against that Preview's own JWKS, runs its usual gates, and has the Preview
  issue the capability (`POST /api/gateway/preview-session-capability`,
  served only by a Worker that signs with `builder-preview-1`). The Preview's
  billing admits the session; usage settles into dev's `BillingControl`,
  which rejects it as an unknown grant (logged, never retried). If desktop
  turns show no reply, `electron.log` names the refused exchange.
- Cron Triggers, queue consumers and the `auth-dev.stella.sh` route don't run
  on Previews. `wrangler tail` doesn't support Previews either. Logs and
  traces are persisted at full sampling under the Preview's Observability tab
  in the dashboard.
- Each Preview's URL is public, like dev's. Test accounts are enabled on it.

One-time setup (already done; listed for rebuilding or rotating). Create the
buckets and KV namespace named in the `previews` block. Set the preview Worker's
`subdomain` to `{"enabled": false, "previews_enabled": true}` (API
`PATCH /accounts/<id>/workers/workers/stella-v2-cloud-builder-preview`;
without it the URL answers error 1042). Then put the base secrets:
`bun run preview -- setup-secrets --capability-key-file <pem>`. It reads
`STELLA_ADMIN_API_SECRET` and `BUILDER_SERVICE_SECRET` from the environment
or `.dev.vars`. To rotate the capability key, generate a P-256 key, put its
public JWK as `builder-preview-1` in the model gateway's dev
`CAPABILITY_JWKS`, deploy the gateway, and rerun `setup-secrets`. Base
secrets only reach Previews created afterwards.

## What ships how

| You changed | Ship it with | Users get it |
|---|---|---|
| Desktop UI, Electron shell, runtime (`packages/desktop*`, `packages/runtime`, …) | `app-source:publish` to `stella-app-dev` / `stella-app-prod` | "N updates" pill → Update |
| Backend, including prompts (`workers/cloud-builder`) | cloud-builder deploy | Immediately (desktops refetch prompts on their next turn) |
| Other workers | That worker's deploy | Immediately |
| Mobile JS/TS | OTA (`publish-ota.sh`) | Downloaded on launch, applied on the next cold start |
| Mobile native (`app.json`, native modules, plugins, `patches/`) | EAS store build + submit | Store update |
| `launcher/` | `build-launchers.yml` with `publish=true` | Installed launchers self-update; new downloads |
| `packages/native/` | Push to master (workflow publishes to R2) | Next launcher prepare (see below) |
| `packages/stella-browser/cli` | Push to master (dev channel), then `promote-stella-browser.yml` | Next launcher prepare after promotion |
| Electron version (`package.json`) | Push (signed identity) + app-source publish | Update installs it and relaunches (see below) |
| Website / web chat (`packages/website`) | `deploy-stella.sh` to the website Worker | Immediately |

There is no desktop build in CI and no installer to ship: the desktop app is
a git checkout run from source by the native launchers.

## What lives where

| Piece | Dev | Prod |
|---|---|---|
| Backend (cloud-builder) | `stella-v2-cloud-builder-dev.fromyou.workers.dev`, `auth-dev.stella.sh` | `stella-v2-cloud-builder-prod.fromyou.workers.dev`, `auth.stella.sh` |
| Stripe webhook (live mode; on the custom domain so a workers.dev rename can't break it) | `we_1ULz5EGxJob0lqtdxqfXfKaw` → `https://auth-dev.stella.sh/api/stripe/webhook` | `we_1UMkFSGxJob0lqtd8RWd9r1Q` → `https://auth.stella.sh/api/stripe/webhook` |
| GitHub App `stella-agent-cloud` (one app; only prod has its secrets) | callback `https://auth-dev.stella.sh/api/cloud/projects/github/callback` | callback/setup `https://auth.stella.sh/api/cloud/projects/github/callback`, webhook `https://auth.stella.sh/api/cloud/projects/github/webhook` |
| Model gateway | `stella-v2-model-gateway-dev` | `stella-v2-model-gateway` |
| D1 | `stella-v2-dev` | `stella-v2-prod` |
| App source (Artifacts) | `stella-app-dev` | `stella-app-prod` |
| Website + web chat | Worker `stella-website-dev` (`stella-website-dev.fromyou.workers.dev`) | Worker `stella-website-prod` on `stella.sh` (Vercel kept as fallback, see the cutover below) |
| Mobile OTA channel | `preview` | `production` |
| Desktop | Source checkout / verify harness; dev-backend launchers read `stella-app-dev` | `stella-app-prod` upstream via launchers from R2 `launcher/stable/` |

Other workers: `telemetry`, `browser-gateway`, `apps-host` (dev and prod envs),
`canvas-share` (one deployment, `stellashare.app`). Which app-source namespace a
launcher reads is set by the backend it talks to (`ARTIFACTS` binding in
cloud-builder's `wrangler.jsonc`).

## Cloudflare workers

Run from each worker's directory. Use the Wrangler login, not the `.dev.vars`
token (it can't push containers): prefix with `env -u CLOUDFLARE_API_TOKEN`.
If wrangler fails with `Unknown argument: …/wrangler-dist/cli.js`, the `node`
on PATH is Stella's Electron shim from before the fix in
`packages/runtime/kernel/tools/shell/shims.ts`; drop `~/.stella/shell-shims`
from PATH for the command until that Stella updates.
cloud-builder builds its container image, so Docker must respond (`docker info`;
if it hangs, force-quit and reopen Docker Desktop).

Order: **D1 migrations → cloud-builder → model-gateway → the rest.** The gateway
refuses any model it has no price for, and it prices models from
cloud-builder's catalog. When a release adds or changes a model, deploy
cloud-builder, wait a couple of minutes for the gateway to refresh its price
list, then deploy the gateway; skipping the wait failed dev turns for 2–4
minutes. A deploy kills in-flight container agent turns.

```bash
# dev
cd workers/cloud-builder && bunx wrangler d1 migrations apply stella-v2-dev --remote
env -u CLOUDFLARE_API_TOKEN bun run deploy:dev            # cloud-builder
cd ../model-gateway && env -u CLOUDFLARE_API_TOKEN bun run deploy:dev
# then telemetry, browser-gateway, apps-host: bun run deploy:dev

# prod
cd workers/cloud-builder && bunx wrangler d1 migrations apply stella-v2-prod --env production --remote
env -u CLOUDFLARE_API_TOKEN bun run deploy:production
cd ../model-gateway && env -u CLOUDFLARE_API_TOKEN bun run deploy:production
# then telemetry, browser-gateway, apps-host: bun run deploy:production
# canvas-share (only when it changed): bun run deploy
```

New bindings, vars or secrets: add them to the `env.production` block of the

### Sandbox image and code bundle (cloud-builder)

The sandbox image (`workers/cloud-builder/Dockerfile`) holds the OS, tools,
Bun, Claude Code, the office CLI and the third-party packages the executor
imports, and **no Stella source**. It changes only when the Dockerfile,
`sandbox-image.bun.lock` (refresh with `bun run image:lock:refresh` when the
executor's dependencies change), the office CLI or `sandbox-bin/` changes. A
container snapshot restores only onto the image it was taken from, so a deploy
that changes only Stella source keeps every owner's snapshot.

Stella's code (`packages/{contracts,runtime,executor-cloud,model-catalog}`)
ships as a content-addressed bundle instead. The Worker build packs it into
`.wrangler/sandbox-code/sandbox-code/<sha256>.tar.gz`, deploys it as a static
asset of the same Worker version (`ASSETS`, never served publicly), and
compiles the hash in. When an agent container starts, fresh or from a
snapshot, the Sandbox object runs the image's `stella-code-install <sha256>`,
which fetches the bundle over an intercepted host, refuses bytes with any
other hash, and installs it root-owned under `/run/stella-code/<sha256>`.
Every executor process starts through `/opt/stella/bin/stella-executor`. A
container runs the bundle it started with until it stops; a deploy reaches it
at its next start, so a turn in progress finishes on its old code.

What a deploy prints:

- `image:prepare`: `{"event":"sandbox_image_inputs","sha256":…}`. Same value
  as the last deploy means the same image.
- `[custom build] {…"sandboxCode":{"sha256":…}}`: the code bundle this version
  serves.
- Wrangler: `Image already exists remotely, skipping push` when the image is
  unchanged; `containers:check` then shows the same
  `Sandbox=…@sha256:<digest>` as the version before.

The digest is stable only while the build machine's Docker cache holds the
layers. A pruned cache or a different machine rebuilds them with new
timestamps and a new digest, and every snapshot resets once (containers start
from the image and the owner's dependency archive).

Which code a container runs: `bunx wrangler tail --format json` shows
`sandbox_container_started` with `source` (`snapshot` or `image`, plus
`snapshotSkipped: "image_changed"` when the image moved), `codeBundle` (the
bundle's sha256) and `codeSource` (`fetched`, or `cached` when a snapshot
carried a tarball that still hashes). A failed install logs
`sandbox_code_install_failed` and the container is stopped. Inside a
container, `readlink /run/stella-code/current` names the bundle.

### Container image metadata (cloud-builder)

A Worker **version** carries the `containers` image digest, and only a full
`wrangler deploy` of `wrangler.jsonc` publishes it. Any other upload — a
dashboard settings/variables save, a raw API script `PUT`, an account-wide
rewrite such as renaming the workers.dev subdomain — creates a version with
`source: api` and **no containers array**, and every sandbox start on it then
fails with `Image or container snapshot must be set for the new runtime`. That
is what happened to production on 2026-10-07: the 06:04 UTC API upload that
rewrote the four `*.workers.dev` vars replaced a good Wrangler deploy and left
prod unable to start sandboxes.

So **never change cloud-builder's vars, bindings or code outside
`wrangler deploy`.** Change `wrangler.jsonc` and deploy. `deploy:dev`,
`deploy:acceptance` and `deploy:production` now refuse to upload a config that
declares no containers or no `ASSETS` code bundle binding, and fail after the
deploy if the version receiving traffic lost either. To check a live
deployment at any time:

```bash
cd workers/cloud-builder
env -u CLOUDFLARE_API_TOKEN bun run containers:check             # dev
env -u CLOUDFLARE_API_TOKEN bun run containers:check:production  # prod
```

Restoring a deployment that lost them is a normal deploy of this config
(`bun run deploy:production`), which rebuilds and re-uploads the image.
`wrangler versions deploy <old-version>@100%` would also bring containers back,
but it restores that version's vars with them, so it is only for an emergency
where those vars are still correct.

#### When `--strict` refuses to deploy

Every prod deploy script passes `--strict`, which aborts when the live
deployment carries changes Wrangler did not make. An API upload is exactly
that, so after one — the 06:04 UTC rewrite above — `--strict` refuses forever,
non-interactively, with no way to accept: the very state it blocks is the one
a deploy has to replace. Overwriting is the point, and that is what the
warning it prints means (`last updated via the script API`).

So when it refuses, read the live deployment first and confirm the repo is
what should win, then deploy that once without `--strict`:

```bash
cd workers/<worker>
env -u CLOUDFLARE_API_TOKEN bunx wrangler deployments list --env production
env -u CLOUDFLARE_API_TOKEN bunx wrangler versions view <id> --env production
env -u CLOUDFLARE_API_TOKEN bunx wrangler deploy --env production
```

`versions view` prints every var, binding and secret name the live version
holds; compare it to the `env.production` block before overwriting, because a
deploy without `--keep-vars` deletes vars absent from the config (secrets are
never deleted). Keep the flag in the scripts: the next deploy is Wrangler's
own, so it stops objecting on its own. Do **not** drop the container checks
around it — they are separate commands and the real guard.

The check also found what `--strict` was right to worry about: the model
gateway's `env.production` bound `CONFIG_SNAPSHOT` with no `id`, so a deploy
could have provisioned a fresh namespace and orphaned the live one. A binding
with no id is a bug; read the deployed id and pin it rather than deploying
past it. Prod was repaired and pinned on 2026-10-08.


worker's `wrangler.jsonc` too (bindings and vars don't inherit), regenerate
types (`node scripts/generate-worker-types.mjs` in cloud-builder), and set prod
secrets before the prod deploy: `... | bunx wrangler secret put NAME --env production`.

### Test accounts' cloud Claude login (dev only)

`STELLA_TEST_CLAUDE_OAUTH_TOKEN` on `stella-v2-cloud-builder-dev` is a
`claude setup-token` token (one year, `user:inference`). On a deployment with
`STELLA_TEST_ACCOUNTS=1`, every `@test.stella.local` owner's cloud lists the
Claude account `claude@test.stella.local`, and its Claude turns run on this
token, written into the root-only account directory in the container
(`workers/cloud-builder/src/test-claude.ts`). Never set it on prod (prod has
no `STELLA_TEST_ACCOUNTS`, so it would do nothing there anyway) or in any
committed config. Previews have no containers, so they need no copy.

To rotate it: the user runs `claude setup-token` on their own computer and
the agent collects the token with `request_secure_input` (sensitive), then
`use_secure_value` into
`cd workers/cloud-builder && printf %s '{{secret}}' | env -u CLOUDFLARE_API_TOKEN bunx wrangler secret put STELLA_TEST_CLAUDE_OAUTH_TOKEN --env=""`,
and `env -u CLOUDFLARE_API_TOKEN bun run containers:check` after, since a
secret change makes a new Worker version. The next Claude turn of each test
owner writes the new token.

### Reading Worker logs

`wrangler tail` samples, needs a live shell, and doesn't show Durable Object
logs (the owner store, BuildSession), and Wrangler's OAuth login has no scope
for stored logs. Query the stored ones instead:
`node scripts/worker-logs.mjs --worker stella-v2-cloud-builder-dev --minutes 30 --search <event or text>`
(`--json` for raw events; works for any Worker, Previews' logs included). It
reads an API token with only Account › Workers Observability › Read from
`CLOUDFLARE_OBSERVABILITY_TOKEN` or `~/.config/stella-dev/cloudflare-observability-token`
(omarchy has one, `stella-agents-worker-logs-read`, made 2026-10-12). On another
computer, create one in the dashboard (Profile › API Tokens › Create Token,
custom, that single permission on Stella's account) and save it to that file
with mode 600; never paste it into chat.

cloud-builder and canvas-share set `observability.redact_query_string`, so
stored logs and traces keep paths but never query strings (magic-link
`?token=`, OAuth `?code=`/`?state=`, `?ott=`). Search by path or by the
`event` names the code logs.

### Production admin API (Cloudflare Access)

In production, every `/api/admin/*` route needs a Cloudflare Access JWT
(`Cf-Access-Jwt-Assertion`) as well as the `STELLA_ADMIN_API_SECRET` bearer.
`auth.stella.sh/api/admin` sits behind the Access application (MFA for people,
a service token for automation). The prod workers.dev host isn't behind
Access, so it refuses admin calls with 403. The Worker checks the JWT against
`ADMIN_ACCESS_TEAM_DOMAIN` and `ADMIN_ACCESS_AUD` in `env.production` of
`workers/cloud-builder/wrangler.jsonc`. If either is unset, prod admin
answers 503. Dev and Previews are bearer-only.

Scripts send the service token from `STELLA_CF_ACCESS_CLIENT_ID` and
`STELLA_CF_ACCESS_CLIENT_SECRET` when they are set. On Rahul's Mac they are in the
keychain (services `stella-prod-cf-access-client-id` and
`stella-prod-cf-access-client-secret`, and the prod admin bearer under
`stella-prod-admin-api-secret`, all with account `rahul`):

```bash
export STELLA_CF_ACCESS_CLIENT_ID="$(security find-generic-password -s stella-prod-cf-access-client-id -a rahul -w)"
export STELLA_CF_ACCESS_CLIENT_SECRET="$(security find-generic-password -s stella-prod-cf-access-client-secret -a rahul -w)"
export STELLA_ADMIN_API_SECRET="$(security find-generic-password -s stella-prod-admin-api-secret -a rahul -w)"
curl -s -H "CF-Access-Client-Id: $STELLA_CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $STELLA_CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $STELLA_ADMIN_API_SECRET" "https://auth.stella.sh/api/admin/owners/top?limit=5"
```

Call prod admin only through `auth.stella.sh`, never the workers.dev host.

### Prompts

Edit `packages/runtime/extensions/stella-runtime/{agent-metadata,prompts}/*.md`,
run `bun run prompts:sync-defaults`, commit. Deploying cloud-builder publishes
them to cloud turns and to desktops, which fetch `/api/stella/prompts`; no
app-source publish is needed. Check: `curl -s <backend>/api/stella/prompts`
revision equals `bun run prompts:check-defaults`.

## Desktop

The desktop app is a git checkout of the app-source `upstream` repo, run from
source by the native launchers (no electron-builder, no electron-updater, no
CI-built app). A publish appears in each install's Updates sidebar; nothing
applies until the user clicks Update.

1. **App source** (any desktop/runtime change):
   `env -u CLOUDFLARE_API_TOKEN bun run app-source:publish -- --namespace stella-app-dev`
   (and `stella-app-prod` for prod). It publishes `HEAD` by default
   (`--ref` to choose). An unchanged tree publishes nothing.
2. **Launchers** (only when `launcher/` changed): a push only builds and
   self-tests them. Publish with `gh workflow run build-launchers.yml --ref master -f publish=true`.
   It signs and notarizes macOS (DMG + zip), signs `Stella.exe`, builds the Linux
   binaries, and uploads them with `VERSION` to `launcher/stable/`. Installed
   launchers update themselves from `VERSION`.
3. **Electron version bump**: the push of `package.json` runs
   `build-electron-identity.yml`, which publishes the Developer ID-signed
   `Stella.app` for that Electron version. Let it finish before publishing app
   source, or macOS launchers fall back to an ad-hoc copy and prompt for the
   Keychain.
4. **Native helpers** (`packages/native/`): the push runs
   `build-native-helpers.yml`, which uploads to R2 and moves `current.json`
   only when the commit is still master's head. **stella-browser**
   (`packages/stella-browser/{cli,scripts,package.json}`): the push runs
   `build-stella-browser.yml`, which uploads immutable builds and moves only
   `stella-browser/dev/current.json`. Installs read `stella-browser/current.json`;
   promote at release with `gh workflow run promote-stella-browser.yml --ref master`
   (the dev channel's build) or `-f source_sha=<full sha>`. A dev machine can
   take the dev channel with `STELLA_BROWSER_MANIFEST_URL=…/stella-browser/dev/current.json`
   for `packages/desktop/scripts/download-stella-browser.mjs`. What is live now:
   `curl -s https://pub-a319aaada8144dc9be5a83625033769c.r2.dev/native-helpers/current.json`
   (`stella-browser/current.json` and `stella-browser/dev/current.json` likewise). Installs fetch them in the
   launcher's prepare step (`packages/desktop/scripts/prepare-install.mjs`),
   which runs on install, relaunch and rollback.

What users are actually on: each publish is one commit on that namespace's
`upstream` repo carrying a `Stella-Source: <monorepo sha>` trailer, so reading
that repo's head says which commit the channel serves — and therefore what a
publish will really ship. Check it before calling a publish "one fix": the
namespace can be many commits behind master.

### What an applied update does

Applying an update fast-forwards the checkout, then
(`app-source-service.ts`): runs `bun install` and relaunches through the
launcher if `bun.lock` or a `package.json` changed, relaunches if
`packages/desktop/electron/` changed, restarts the runtime if
`packages/runtime/` or `packages/contracts/` changed, and otherwise hot-swaps
the renderer.

Nothing runs `electron-rebuild`, and nothing needs to: the native addons
Electron loads (`uiohook-napi`, `mac-screen-capture-permissions`) are N-API
only, so one build loads in any Electron. Before adding a native dependency,
check it is N-API (no `nan`, no `v8.h`); one that isn't would fail to load
after an Electron bump until something rebuilds it.

## Website and web chat

`packages/website` runs on Cloudflare Workers through OpenNext. Nothing deploys
on push; run it from `packages/website` after rebasing. Put `/usr/bin` first on
`PATH` where `node` is an Electron shim, and keep the `VITE_*` and `NEXT_PUBLIC_*`
values out of the way: `scripts/deploy-stella.sh` pins every public value itself
(backend, site URL, Turnstile key; the Google Ads tag only in `production`). The
Maps browser key is the one value it takes from the environment.

```bash
cd packages/website
# dev → https://stella-website-dev.fromyou.workers.dev (dev backend, no Ads tag)
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY="$(cat <browser key file>)" env -u CLOUDFLARE_API_TOKEN bun run deploy:dev
# prod → stella-website-prod (prod backend, Ads tag on); refuses without the browser key
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY="$(cat <browser key file>)" env -u CLOUDFLARE_API_TOKEN bun run deploy:production
```

The only runtime secret is `GOOGLE_MAPS_SERVER_API_KEY` (the legacy
`POST /api/maps/resolve` for released desktops):
`env -u CLOUDFLARE_API_TOKEN bunx wrangler secret put GOOGLE_MAPS_SERVER_API_KEY --env="" < <server key file>`
(`--env production` for prod). The browser key is referrer-restricted to
`stella.sh` and `localhost:3000`, so maps on a workers.dev URL show
`RefererNotAllowedMapError`. The dev backend does not trust the workers.dev origin
either, so sign-in and `/chat` there fail CORS. Test those against the built
Worker locally on a trusted origin:
`env -u CLOUDFLARE_API_TOKEN bunx wrangler dev --port 57314 --env=""` (use
`--port 3000` for maps).

`wrangler.jsonc` holds both Workers. `worker.mjs` wraps the OpenNext worker so
responses match Vercel: prerendered HTML gets `public, max-age=0, must-revalidate`
instead of Next's raw `s-maxage`, and `/_next/image` is cached for a day.
`public/_headers` sets the static-asset headers (`/_next/static`, `/chat-app`,
logos, mock images) that `next.config.ts` headers cannot reach on Workers. Pages
are served from the build's static-assets cache, so there is no ISR: adding
`revalidate` or `unstable_cache` needs the R2 incremental cache.

### Cutover from Vercel (done 2026-10-07)

`stella.sh` is a Workers custom domain on `stella-website-prod` (`routes` in
`env.production`). Before the cutover it was a DNS-only `CNAME stella.sh →
dfd97f9c23152005.vercel-dns-016.com`. `www.stella.sh` is still the Vercel CNAME,
and Vercel redirects it to the apex. The Vercel project stays connected as the
fallback until the switch is confirmed.

- Rollback: remove the `stella.sh` custom domain from `stella-website-prod`
  (dashboard → Workers → Settings → Domains & Routes), recreate the DNS-only
  CNAME above, and comment `routes` again. Vercel still builds master, so it
  serves the same site.
- When confirmed: move `www.stella.sh` to a proxied `AAAA 100::` record with a
  Redirect Rule `www.stella.sh/*` → `https://stella.sh/${1}` (301, keep the
  query string), then in Vercel disconnect the Git integration, remove both
  domains and delete the project.

## Mobile

**OTA is the default.** Run per platform, from `packages/mobile`, with a clean tree:

```bash
STELLA_OTA_PIN_STORE_RUNTIME=1 scripts/publish-ota.sh production ios
STELLA_OTA_PIN_STORE_RUNTIME=1 scripts/publish-ota.sh production android
```

(`preview` instead of `production` for dev builds.) The script targets the build
the stores actually serve. `STELLA_OTA_PIN_STORE_RUNTIME=1` is needed because the
fingerprint drifts with bun's store paths; it refuses if any native package or
native input changed since the store build, and then only a store build can ship it.
**The bundle's `EXPO_PUBLIC_*` come from the EAS environment, not from this repo.**
`eas.json`'s per-profile `env` applies to EAS *builds*; `eas update` reads the named
environment on the server (`eas env:list --environment production`). So editing a
hostname in the tree changes nothing an OTA ships. Changing a backend URL means
`eas env:set --name EXPO_PUBLIC_STELLA_BACKEND_URL --value <url> --environment
production` (and `preview`/`development`), then a republish; read the exported
bundle back (`strings dist/_expo/static/js/ios/*.hbc | rg workers.dev`) before
believing it. Missing this on the 2026-10-07 `fromyou.workers.dev` move left every
production bundle pointed at a hostname that no longer resolved, and the phone
could not sign in.

`--native-match`, which `STELLA_OTA_PIN_STORE_RUNTIME=1` runs, compares this tree's
native inputs against the *store build's commit*: `packages/mobile/app.json`,
`plugins`, `modules`, `widgets`, `targets`, `patches/`, plus native package versions
in `bun.lock`. **Deletions count exactly like additions** — the diff has no status
filter — so removing a native module trips it; patches of non-native packages are
ignored. When master has moved natively but its JS is what you want to ship, publish
from a release-only commit, never pushed to master, whose native inputs match the
target build exactly: revert the native-only patch, restore files the target still
has, and put `app.json` back to the target's version. Prove two things before
publishing — the exported bundle really carries the change, and an export differing
only by the restored files is byte-identical.

A *new native dependency* is the harder version of this, because its JS is in
the bundle: master's JS imports a module the store binary cannot load. Removing
the dependency is not enough — the call site has to go too, and the release-only
commit stands or falls on how contained it is. Check with
`rg "<package>|<ExportName>"` before assuming the whole feature is stranded:
one call site behind an existing failure path is a two-line change, while a
module used across screens means waiting for the store build. On 2026-10-08
`expo-video-thumbnails` (added by `b7a12c812` for the reply attachment strip)
had exactly one call, in `src/lib/chat-evidence-previews.ts`, whose caller
already turns a thrown preview into a pill row — the same fallback an
unreadable codec takes. Replacing that call with the throw, dropping the
dependency from `packages/mobile/package.json`, re-resolving `bun.lock`, and
restoring the store build's CarPlay plugin let **all** of the day's mobile JS
ride the OTA, costing only video poster frames. Confirm `bun install` reports
`Removed: 1` and nothing else moved, and re-run `--native-match`: it is the
only thing that actually proves the tree is publishable.


**Runtimes, not versions, decide who receives an update.** A binary asks for its
channel and its own fingerprint runtime, so every live build needs its own group. The
script pins to the build the stores serve, so once a newer build goes live the older
runtime can no longer be targeted through it: those stragglers keep the last group they
got and catch up when the store updates them. `STELLA_OTA_IOS_TESTFLIGHT_BUILD=<n>`
targets an iOS build that exists in App Store Connect but is not live yet, so a binary
in review already has its update waiting the moment it is approved.

**`eas.json` pins bun** (`"bun"` in each build profile). The fingerprint hashes bun's
store paths, so if the builders' bun differs from the one that resolved `bun.lock`,
every build dies in `CONFIGURE_EXPO_UPDATES` with a local-vs-EAS runtime mismatch. Keep
the pin equal to the bun that owns the lockfile, and install and build with exactly
that bun: `bun run eas:check-bun` in `packages/mobile` checks it (`publish-ota.sh`
runs it) and prints the fix. Shells on omarchy default to mise's bun 1.3.14; Stella's
own 1.4.0 is at `~/.local/share/stella/runtimes/bun-1.4.0/bun`.

`publish-ota.sh` invokes `bunx`, which Stella's bundled bun does not ship; put a shim
on `PATH` rather than editing the script.

**App Store / Play release: only when explicitly asked.** `eas build --profile
production` then `eas submit`, per platform. Apple rejects a submission that reuses
`expo.version`, so bump it in `app.json` first; build numbers come from EAS
(`appVersionSource: remote`). Confirm the Android submit prints
`Release track: production` — it falls back to internal when the profile says nothing.
ASC app id `6761148311`, Apple team `7UVYHQ763X`, Android package `com.fromyou.stella`.

Whether a submission happened is the **App Store version's** review state, not the
build's: a build row can read "Ready to Submit" in TestFlight while the version itself
is "Waiting for Review", and the public-build resolver only ever reports what is already
live. Read the version.

`eas submit` only uploads the binary. Creating the App Store version, attaching
the build, setting "What's New" and actually submitting for review are App Store
Connect API calls, and the Play release notes are a Play API call — `eas submit`
leaves them empty, so a Play release otherwise goes live with no "What's new" at
all. Both private keys can be read back out of EAS through Expo's GraphQL
(`appStoreConnectApiKey { keyP8 issuerIdentifier }`,
`googleServiceAccountKey { keyJson }`), so neither needs a key on disk.
`~/.stella/outputs/mobile-release-tools/{asc,play}.mjs` drive the rest and are
the fastest way to run or re-read a submission.

Two traps there. **The ASC key EAS submits with is not allowed to create a
version**: the `stella-ai` key (`V5TBYBR59A`) can read, but `POST
/v1/appStoreVersions` answers 403 `the API key in use does not allow this
request`. The ADMIN key lives on the **`ruuxilol`** account (`3K28358BZB`) on the
same issuer, so pick the key whose `roles` contain `ADMIN` rather than the one
the submit profile uses. And review submission is the modern three-call flow —
`reviewSubmissions`, then `reviewSubmissionItems`, then PATCH `submitted: true` —
not the retired `appStoreVersionSubmissions`.

**Keep the `expo.version` bump off `master` until the store build is live.**
`app.json` is an OTA native input, so bumping master to 1.0.44 makes
`--native-match` refuse every OTA aimed at the 1.0.43 builds the stores are
still serving. Carry the bump on a release branch, build both platforms from
that one commit so the stores agree, and merge it to master only once the new
build is the one being served. Android needs its own build and submit; an iOS
release covers nothing on Play.


## Smoke check after a prod deploy

- `curl -s https://auth.stella.sh/api/auth/jwks` → 200.
- Anonymous sign-in, then one chat turn: `POST /api/auth/sign-in/anonymous`,
  `GET /api/auth/token`, `POST /conversations/<uuid>/turns`
  `{"protocol":1,"clientMsgId":"<uuid>","prompt":"Reply with exactly: ok","lane":"chat"}`,
  then poll `GET /conversations/<uuid>/history` for the assistant reply.
- Desktop against a given backend: `STELLA_BACKEND_URL=<backend> TMPDIR=/tmp node .agents/skills/verify-stella/control-stella.mjs session launch`.
