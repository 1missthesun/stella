# Connector verification resumption — 7 September 2026

This is a progress record, not a completion or production-readiness attestation.
The owner authorized account registration under `contact@fromyou.ai`, use of
their signed-in external Chrome, preparation of demos, and submission to the
providers. The August handoff's requirement for another general owner approval
does not supersede that authorization.

## Google: live evidence

- Project: `fromyou-468223`, project number `398468929332`.
- Owner completed Cloud Console reauthentication during this session.
- Branding is verified. Data access remains under review.
- Verification Center: homepage, privacy policy, branding, appropriate data
  access, and minimum scopes show complete. App functionality shows an error
  because the demonstration is insufficient. Additional requirements are in
  progress.
- The existing verification email conversation has a new message dated
  7 September 2026, 12:54 AM. Google says Console changes reopened the
  submission. Reply in that existing conversation after remediation.
- The live Data Access list matches the nine strings on
  `fix/google-scope-parity-upgrade`: `openid`, userinfo email/profile,
  `gmail.modify`, `calendar`, `documents`, `drive`, `spreadsheets`, `tasks`.
- Existing clients: **Stella Login** (web application) and **Stella** (desktop).
- The Console currently references an older YouTube Shorts demo. It was not
  replaced in this session.

The newest email requests full in-app functionality for every service scope,
source-account proof of writes/deletions, readable expanded consent, and exact
scope matching. It explicitly allows a staging environment or hidden test route
for a live app and warns against enabling unverified scopes for production
traffic. The older request for reviewer access remains unresolved; do not claim
reviewer access has been provisioned or tested.

## Deployment and registration evidence

- The locally configured Convex project is `stella-0437e`; its dev deployment is
  `outgoing-bulldog-865`.
- The production `CONVEX_URL` setting returned
  `https://intent-jackal-330.convex.cloud`. The August report's
  `benevolent-minnow-586` must not be assumed to be the current production
  deployment. Confirm actual deployment identity and routing before deploying.
- `https://connect.stella.sh/api/connectors/oauth/callback` returned 404.
- Unauthenticated GETs to `/api/native-oauth/providers` on both
  `intent-jackal-330.convex.site` and `benevolent-minnow-586.convex.site`
  returned `No matching routes found`.
- Production environment **names** show existing native OAuth credentials for
  several SaaS providers. Presence alone does not prove usable registration,
  matching client IDs, provider review, or representative calls. Avoid creating
  duplicate provider apps until the existing registration is inspected.
- Notion's integration console required login. Google login was attempted with
  `contact@fromyou.ai`; the popup stalled and completion was not verified.

No provider submission, provider registration change, deployment, rollout, or
credential change was completed in this session.

## Isolated Google implementation work

The newer `codex/finish-connector-rollout` worktree contains unfinished backend
changes. Those changes were left intact. Its runnable desktop still had the old
Google scope list and lacked native Sheets/Tasks catalog entries.

A separate worktree was created at:

`/home/alex/.codex/worktrees/google-connector-verification/stella-v2`

Branch: `codex/google-connector-verification`, based on `53070365c`.

Commit `8f3304cfe` ports the corrected scope union, Sheets and Tasks services,
tool metadata/allowlist, Workspace bundle, and Docs append fix to that base.
`STELLA_GOOGLE_OAUTH_REVIEW=1` selects bundled Google catalog entries over
server entries in the isolated review process. This is a staging mechanism,
not a production migration. Its end-to-end connection behavior is not proven.

Validation completed:

- `bun install --frozen-lockfile`.
- `bun run electron:typecheck` (including IPC manifest tests).
- `bun run test:run tests/runtime/kernel/google-workspace`: 5 files, 19 tests
  passed.
- `bun run test:run tests/runtime/kernel/connectors/native-integrations.test.ts`:
  7 tests passed.

The isolated verifier session is `5a4fc2fe`, with a dev Pro test account.
Its evidence lives under
`.agents/skills/verify-stella/artifacts/connector-review-2026-09-07/` in that
worktree. An earlier session `d9f94705` in the connector-rollout worktree was
stopped through the verifier cleanup command; evidence and durable data were
preserved.

## Recording and remaining work

`gpu-screen-recorder` and `ffmpeg` are installed. The recorder enumerated
`DP-1` at 3840×2160. Recording itself has not yet been validated.

The OS default browser is `chromium.desktop`, whereas the authorized connected
Chrome is a different browser session. Stella's rehearsal opened authentication
outside the controllable Chrome session. The owner was asked to move that
authorization page into their signed-in Chrome, or report that none opened.
Do not count a waiting connection card as a successful OAuth grant.

Next work:

1. Resolve the actual product connection path and browser handoff, including
   the staging backend/token-exchange prerequisites. Ensure it uses Stella's
   own Google registration rather than Composio.
2. Complete a rehearsal with real Google service calls. Use clearly identified
   disposable demo data; do not expose unrelated mail or files.
3. Record one continuous consent-to-source-results demo. Cover Gmail send and
   label modification, Calendar write/free-busy, Docs edits, existing Drive
   file search/rename plus folder creation, Sheets writes, and Tasks
   create/update/complete. Claims must stay within implemented functionality.
4. Verify reviewer access and video accessibility, then reply in the existing
   Google verification conversation with the actual evidence.
5. Reconcile the remaining 59-connector inventory against current code,
   credentials, provider consoles, callbacks, and representative calls; finish
   outstanding registrations and review submissions.

No acceptable replacement movie has been produced or submitted yet. Overall
connector replacement remains incomplete.
