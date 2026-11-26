---
name: x-api
description: "Use X (Twitter) through Stella's connected account."
---

# X (Twitter) through Stella

`stella-x-api` (on PATH in Stella shells) acts on the user's X account through Stella's own X app, whose tokens stay on Stella's backend. Never ask for, print or store X keys or tokens, and never read `~/.xurl` (another tool's live tokens).

## Connecting

```bash
stella-x-api status
stella-x-api connect                 # prints a URL for the user to approve
stella-x-api finish ABCD-EFGH-JKLM   # the one-time code the page shows them
```

Give the user the connect URL; after approving, they paste the code into the chat. The code works once, only for the Stella account that started it, for 10 minutes; if it fails or X reports the connection expired, run `connect` again.

## Commands

```bash
stella-x-api whoami --json
stella-x-api post "Hello from Stella"
stella-x-api read <post id or URL>
stella-x-api search "from:XDevelopers API" -n 10
stella-x-api request /2/users/me --query '{"user.fields":"id,name,username"}'
stella-x-api request /2/tweets --method POST --body '{"text":"Hello"}'
```

Output is JSON except `status`, `connect` and `finish` (pass `--json` for those). `request` takes X API v2 paths on `api.x.com` only, with no authorization headers: Stella adds the user's token. Media upload isn't supported yet; offer a text-only post instead.

Posting, replying, deleting, DMs, follows, blocks and other account changes need the user's go-ahead; a request for exactly that action is the go-ahead.
