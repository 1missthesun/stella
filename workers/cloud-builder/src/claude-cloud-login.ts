import {
  CLOUD_CLAUDE_ACCOUNTS_ROOT,
  CLOUD_CLAUDE_LOGIN_BACKUP_PREFIX,
  CLOUD_CLAUDE_LOGINS_ROOT,
  isCloudClaudeAccountKey,
} from "@stella/contracts/cloud-native-state";
import { presignR2Url, r2Signer } from "./r2-presign.js";
import { sandboxClient, type SandboxHandle } from "./sandbox-client.js";
import {
  isTestAccountOwner,
  TEST_CLAUDE_EMAIL,
  testClaudeCredentials,
} from "./test-claude.js";
import { worldSandboxId } from "./workspace.js";


export const claudeCloudAccountKey = async (email: string): Promise<string> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(email.trim().toLowerCase()),
    ),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const LOGIN_ID = /^[0-9a-f]{32}$/u;

const SCRIPT = String.raw`set -u
umask 077
accounts=${CLOUD_CLAUDE_ACCOUNTS_ROOT}
logins=${CLOUD_CLAUDE_LOGINS_ROOT}
json() { jq -cn "$@"; }
fail() { json --arg error "$1" '{ok:false,error:$error}'; exit 0; }
cli_error() {
  # The CLI's own words: everything it printed except the sign-in link.
  { tr -d '\000\033\007' <"$1/out"; } 2>/dev/null \
    | grep -v 'https://' \
    | sed -e 's/^.*Paste code here if prompted > //' \
    | grep -v -e '^Opening browser' -e '^[[:space:]]*$' \
    | tail -n 3
}
action=$1
# The accounts directory is created only by a sign-in or a restore: a
# container without one has no logins, and must never back up an empty set.
if [ "$action" != restore ] && [ "$action" != backup ] && [ "$action" != probe-inspect ]; then
  mkdir -p "$accounts" "$logins"
  chmod 700 "$accounts" "$logins"
fi
case "$action" in
start)
  id=$2
  email=$3
  find "$logins" -mindepth 1 -maxdepth 1 -mmin +20 -exec rm -rf -- {} + 2>/dev/null
  dir="$logins/$id"
  mkdir "$dir" "$dir/config" || fail "Couldn't start signing in. Try again."
  mkfifo "$dir/in" || fail "Couldn't start signing in. Try again."
  if [ -n "$email" ]; then set -- auth login --email "$email"; else set -- auth login; fi
  setsid bash -c '
    dir=$1; shift
    exec 3<>"$dir/in"
    env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_BASE_URL \
      CLAUDE_CONFIG_DIR="$dir/config" BROWSER=true NO_COLOR=1 \
      timeout 900 claude "$@" <&3 >"$dir/out" 2>&1
    echo $? >"$dir/exit.tmp" && mv "$dir/exit.tmp" "$dir/exit"
  ' claude-login "$dir" "$@" </dev/null >/dev/null 2>&1 &
  echo $! >"$dir/pid"
  i=0
  while [ $i -lt 300 ]; do
    url=$({ tr -d '\000' <"$dir/out"; } 2>/dev/null | grep -o 'https://[^[:space:][:cntrl:]]*' | head -n 1)
    if [ -n "$url" ]; then json --arg url "$url" '{ok:true,authorizeUrl:$url}'; exit 0; fi
    [ -e "$dir/exit" ] && break
    sleep 0.1
    i=$((i + 1))
  done
  error=$(cli_error "$dir")
  pkill -KILL -s "$(cat "$dir/pid")" 2>/dev/null
  rm -rf -- "$dir"
  fail "${"$"}{error:-Claude Code did not start signing in. Try again.}"
  ;;
finish)
  id=$2
  dir="$logins/$id"
  [ -p "$dir/in" ] || fail "This sign-in expired. Start again."
  [ -e "$dir/exit" ] || printf '%s\n' "$CODE" >"$dir/in"
  i=0
  while [ ! -e "$dir/exit" ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i + 1)); done
  if [ ! -e "$dir/exit" ]; then
    pkill -KILL -s "$(cat "$dir/pid")" 2>/dev/null
    rm -rf -- "$dir"
    fail "Claude Code didn't finish signing in. Start again."
  fi
  if [ "$(cat "$dir/exit")" != 0 ]; then
    error=$(cli_error "$dir")
    rm -rf -- "$dir"
    fail "${"$"}{error:-Claude Code could not sign in. Start again.}"
  fi
  status=$(env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR="$dir/config" claude auth status --json 2>/dev/null)
  email=$(printf '%s' "$status" | jq -r '.email // empty' 2>/dev/null)
  plan=$(printf '%s' "$status" | jq -r '.subscriptionType // empty' 2>/dev/null)
  if [ -z "$email" ]; then rm -rf -- "$dir"; fail "Claude Code signed in but didn't say which account."; fi
  key=$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]' | sha256sum | cut -c1-64)
  target="$accounts/$key"
  rm -rf -- "$target.old"
  [ -e "$target" ] && mv -- "$target" "$target.old"
  mv -- "$dir/config" "$target" && chmod 700 "$target"
  rm -rf -- "$target.old" "$dir"
  json --arg email "$email" --arg plan "$plan" --arg key "$key" '{ok:true,email:$email,plan:$plan,key:$key}'
  ;;
cancel)
  dir="$logins/$2"
  [ -e "$dir/pid" ] && pkill -KILL -s "$(cat "$dir/pid")" 2>/dev/null
  rm -rf -- "$dir"
  json '{ok:true}'
  ;;
logout)
  target="$accounts/$2"
  if [ -d "$target" ]; then
    env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR="$target" timeout 30 claude auth logout >/dev/null 2>&1
    rm -rf -- "$target"
  fi
  json '{ok:true}'
  ;;
backup)
  # An archive of the whole accounts directory, streamed by curl from this
  # container straight to the owner's backup object (presigned URL in URL).
  # Only the login fields used to compare two copies and to say when each
  # login ends are read; no token is ever printed.
  [ -d "$accounts" ] || { json '{ok:true,skipped:true}'; exit 0; }
  parent=$(dirname "$accounts")
  name=$(basename "$accounts")
  # The stored object is then this container's own copy: its ETag is kept
  # beside the logins, so the next restore here downloads nothing.
  archive=$parent/.claude-accounts-backup.tgz
  marker=$parent/.claude-accounts-etag
  headers=$parent/.claude-accounts-backup.headers
  merged=$parent/.claude-accounts-merge
  rm -f -- "$archive" "$marker" "$headers"
  rm -rf -- "$merged" "$merged.tgz"
  source_root=$parent
  if [ "${"$"}{MERGE:-}" = 1 ]; then
    # An agent's container only refreshes logins; it never signs in or out.
    # Other containers of the same owner refresh too, so storing this copy
    # whole could put back a refresh token Anthropic already replaced. The
    # stored backup decides which logins exist; each one keeps whichever
    # credential is fresher, and this container takes the fresher one too.
    code=$(curl -s -o "$merged.tgz" -w '%{http_code}' --max-time 60 "$GET_URL")
    if [ "$code" = 200 ]; then
      mkdir "$merged" && chmod 700 "$merged" \
        && tar -xzpf "$merged.tgz" --same-owner --no-overwrite-dir -C "$merged" \
        && [ -d "$merged/$name" ] && [ ! -L "$merged/$name" ] \
        || { rm -rf -- "$merged" "$merged.tgz"; fail "Couldn't read the stored Claude Code logins."; }
      rm -f -- "$merged.tgz"
      for theirs_dir in "$merged/$name"/*; do
        [ -d "$theirs_dir" ] && [ ! -L "$theirs_dir" ] || continue
        theirs=$theirs_dir/.credentials.json
        mine=$accounts/$(basename "$theirs_dir")/.credentials.json
        [ -f "$mine" ] && [ ! -L "$mine" ] && [ -f "$theirs" ] && [ ! -L "$theirs" ] || continue
        newer=$(jq -rn --slurpfile a "$mine" --slurpfile b "$theirs" '
          def rank: (.claudeAiOauth // {}) | [
            ((.refreshToken // "") != "" and .loginEnded == null),
            (.refreshTokenExpiresAt // 0),
            (.expiresAt // 0)
          ];
          if ($a[0] | rank) > ($b[0] | rank) then "mine"
          elif ($a[0] | rank) < ($b[0] | rank) then "theirs"
          else "same" end' 2>/dev/null)
        if [ "$newer" = mine ]; then
          cp -p -- "$mine" "$theirs"
        elif [ "$newer" = theirs ]; then
          cp -p -- "$theirs" "$mine.tmp" && mv -f -- "$mine.tmp" "$mine"
        fi
      done
      source_root=$merged
    elif [ "$code" != 404 ]; then
      rm -f -- "$merged.tgz"
      fail "Couldn't read the stored Claude Code logins ($code)."
    fi
    rm -f -- "$merged.tgz"
  fi
  tar -C "$source_root" -czf "$archive" "$name" || { rm -rf -- "$archive" "$merged"; fail "Couldn't pack the Claude Code logins."; }
  # When each stored login ends: the key, the end time and whether Claude
  # Code already found it ended. Nothing else from the credential.
  health=$(for dir in "$source_root/$name"/*; do
      [ -f "$dir/.credentials.json" ] && [ ! -L "$dir/.credentials.json" ] || continue
      jq -c --arg key "$(basename "$dir")" --argjson now "$(($(date +%s) * 1000))" '
        (.claudeAiOauth // {}) as $o
        | {key:$key, endsAt:($o.refreshTokenExpiresAt // null),
           ended:(($o.refreshToken // "") == "" or $o.loginEnded != null
             or (($o.refreshTokenExpiresAt // ($now + 1)) <= $now))}' "$dir/.credentials.json" 2>/dev/null
    done | jq -cs . 2>/dev/null)
  rm -rf -- "$merged"
  code=$(curl -s -D "$headers" -o /dev/null -w '%{http_code}' --max-time 60 -T "$archive" "$URL")
  stored=$(tr -d '\r"' <"$headers" 2>/dev/null | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p' | tail -n 1)
  rm -f -- "$archive" "$headers"
  [ "$code" = 200 ] || fail "Couldn't store the Claude Code login backup ($code)."
  # A merged backup can differ from this container's set of logins, so only
  # an unmerged one marks this copy as the stored one.
  if [ -n "$stored" ] && [ "$source_root" = "$parent" ]; then printf '%s\n' "$stored" >"$marker"; fi
  json --argjson logins "${"$"}{health:-[]}" '{ok:true,logins:$logins}'
  ;;
restore)
  # The stored backup is the owner's logins; whatever this container's disk
  # or snapshot carried may be older, so it is replaced. Without a backup
  # the container keeps what it has. A container that already holds the
  # backup it would fetch (ETAG, the one it last restored) keeps its copy;
  # ETAG=absent says there is no backup to fetch.
  parent=$(dirname "$accounts")
  archive=$parent/.claude-accounts-restore.tgz
  stage=$parent/.claude-accounts-restore
  marker=$parent/.claude-accounts-etag
  headers=$parent/.claude-accounts-restore.headers
  if [ -n "${"$"}{ETAG:-}" ] && [ -d "$accounts" ] && [ ! -L "$accounts" ] && [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(cat "$marker")" = "$ETAG" ]; then
    json '{ok:true,restored:false,current:true}'
    exit 0
  fi
  if [ "${"$"}{ETAG:-}" = absent ]; then
    mkdir -p "$accounts" && chmod 700 "$accounts"
    json '{ok:true,restored:false}'
    exit 0
  fi
  rm -f -- "$marker" "$headers"
  rm -rf -- "$archive" "$stage"
  code=$(curl -s -D "$headers" -o "$archive" -w '%{http_code}' --max-time 60 "$URL")
  fetched=$(tr -d '\r"' <"$headers" 2>/dev/null | sed -n 's/^[Ee][Tt][Aa][Gg]: *//p' | tail -n 1)
  rm -f -- "$headers"
  if [ "$code" = 404 ]; then
    rm -f -- "$archive"
    mkdir -p "$accounts" && chmod 700 "$accounts"
    json '{ok:true,restored:false}'
    exit 0
  fi
  [ "$code" = 200 ] || { rm -f -- "$archive"; fail "Couldn't fetch the Claude Code login backup ($code)."; }
  mkdir "$stage" && chmod 700 "$stage"
  tar -xzpf "$archive" --same-owner --no-overwrite-dir -C "$stage" || { rm -rf -- "$archive" "$stage"; fail "Couldn't unpack the Claude Code login backup."; }
  rm -f -- "$archive"
  name=$(basename "$accounts")
  if [ ! -d "$stage/$name" ] || [ -L "$stage/$name" ]; then rm -rf -- "$stage"; fail "The Claude Code login backup is malformed."; fi
  rm -rf -- "$accounts.old"
  [ -e "$accounts" ] && mv -- "$accounts" "$accounts.old"
  mv -- "$stage/$name" "$accounts" && chown root:root "$accounts" && chmod 700 "$accounts"
  rm -rf -- "$stage" "$accounts.old"
  if [ -n "$fetched" ]; then printf '%s\n' "$fetched" >"$marker"; fi
  json '{ok:true,restored:true}'
  ;;
probe-plant)
  # Dev test accounts only: a FAKE login in the fixed probe account's
  # directory, never a real one.
  dir="$accounts/$2"
  mkdir -p "$dir" && chmod 700 "$dir"
  printf '%s' "$PROBE_CREDENTIALS" >"$dir/.credentials.json" && chmod 600 "$dir/.credentials.json"
  printf '%s' "$PROBE_CONFIG" >"$dir/.claude.json" && chmod 600 "$dir/.claude.json"
  json '{ok:true}'
  ;;
test-seed)
  dir="$accounts/$2"
  mkdir -p "$dir" && chmod 700 "$dir"
  printf '%s' "$TEST_CREDENTIALS" >"$dir/.credentials.json.tmp" && chmod 600 "$dir/.credentials.json.tmp" \
    || { rm -f -- "$dir/.credentials.json.tmp"; fail "Couldn't set up the test Claude login."; }
  # The same login stays the same file, so a Claude process kept from the
  # last turn still holds the current one.
  if cmp -s -- "$dir/.credentials.json.tmp" "$dir/.credentials.json"; then
    rm -f -- "$dir/.credentials.json.tmp"
    json '{ok:true}'
    exit 0
  fi
  mv -f -- "$dir/.credentials.json.tmp" "$dir/.credentials.json" \
    || { rm -f -- "$dir/.credentials.json.tmp"; fail "Couldn't set up the test Claude login."; }
  json '{ok:true}'
  ;;
probe-inspect)
  # Dev test accounts only, and only the fixed probe directory, whose
  # content is the fake login above.
  dir="$accounts/$2"
  perms=$(stat -c '%U:%G %a %n' "$(dirname "$accounts")" "$accounts" "$dir" "$dir/.credentials.json" "$dir/.claude.json" 2>&1)
  sums=$(cd "$dir" 2>/dev/null && sha256sum .credentials.json .claude.json 2>&1)
  # Read-only: never create the accounts directory a backup would then store.
  status=""
  if [ -d "$dir" ]; then status=$(env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR="$dir" timeout 60 claude auth status --json 2>/dev/null | jq -c '{loggedIn, authMethod, email, subscriptionType}' 2>/dev/null); fi
  json --arg perms "$perms" --arg sums "$sums" --arg status "$status" --arg image "$(cat /opt/stella/image-build.json 2>/dev/null | jq -c . 2>/dev/null)" --arg boot "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)" '{ok:true,perms:$perms,sha256:$sums,authStatus:$status,image:$image,bootId:$boot}'
  ;;
*)
  fail "Unknown action."
  ;;
esac
`;

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

type ScriptResult = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export const claudeLoginContainer = async (env: Cloudflare.Env, ownerId: string): Promise<SandboxHandle> =>
  sandboxClient(
    (env as unknown as { Sandbox: DurableObjectNamespace<import("./sandbox-container.js").Sandbox> })
      .Sandbox,
    await worldSandboxId(ownerId),
    { size: "small", workload: "world", owner: ownerId },
  );

const runScript = async (
  env: Cloudflare.Env,
  ownerId: string,
  args: string[],
  options: {
    code?: string;
    url?: string;
    extraEnv?: Record<string, string>;
    timeoutMs: number;
    container?: SandboxHandle;
  },
): Promise<ScriptResult> => {
  const sandbox = options.container ?? (await claudeLoginContainer(env, ownerId));
  const result = await sandbox.exec(
    ["bash", "-c", shellQuote(SCRIPT), "claude-login", ...args.map(shellQuote)].join(" "),
    {
      cwd: "/",
      timeout: options.timeoutMs,
      ...(options.code !== undefined || options.url !== undefined || options.extraEnv
        ? {
            env: {
              ...options.extraEnv,
              ...(options.code !== undefined ? { CODE: options.code } : {}),
              ...(options.url !== undefined ? { URL: options.url } : {}),
            },
          }
        : {}),
    },
  );
  const line = result.stdout.trim().split("\n").pop() ?? "";
  try {
    const parsed = JSON.parse(line) as ScriptResult;
    if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") return parsed;
  } catch {
    // Fall through to the generic failure.
  }
  console.error(
    JSON.stringify({
      level: "error",
      event: "claude_cloud_login_script_failed",
      action: args[0],
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-500),
    }),
  );
  return { ok: false, error: "Your cloud couldn't run Claude Code's sign-in. Try again." };
};

const loginBackupKey = async (ownerId: string): Promise<string> =>
  `${CLOUD_CLAUDE_LOGIN_BACKUP_PREFIX}/${await claudeCloudAccountKey(`owner:${ownerId}`)}.tgz`;

const loginBackupUrl = async (
  env: Cloudflare.Env,
  ownerId: string,
  method: "GET" | "PUT",
): Promise<string | null> => {
  const signer = r2Signer(env, (env as unknown as { R2_BACKUP_BUCKET?: string }).R2_BACKUP_BUCKET);
  if (!signer) return null;
  return await presignR2Url(signer, {
    method,
    key: await loginBackupKey(ownerId),
    expiresInSeconds: 10 * 60,
  });
};

/** When one stored cloud login ends, keyed by its account directory. */
export type ClaudeCloudLoginHealth = { key: string; endsAt: number | null; ended: boolean };

const loginHealthOf = (value: unknown): ClaudeCloudLoginHealth[] =>
  Array.isArray(value)
    ? value.flatMap((entry): ClaudeCloudLoginHealth[] => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        if (typeof row.key !== "string" || !isCloudClaudeAccountKey(row.key)) return [];
        const endsAt =
          typeof row.endsAt === "number" && Number.isFinite(row.endsAt) ? row.endsAt : null;
        return [{ key: row.key, endsAt, ended: row.ended === true }];
      })
    : [];

/**
 * Store the owner's Claude Code logins from one container (the sign-in
 * container after a sign-in or a sign-out, an agent's after every Claude
 * turn, since the CLI may have rotated its refresh token there). An agent's
 * container passes `merge`: it never adds or removes a login, and another
 * container may have refreshed one since, so each login keeps whichever copy
 * is fresher. Returns when each stored login ends, or null when nothing was
 * stored.
 */
export const backupClaudeCloudLogins = async (
  env: Cloudflare.Env,
  ownerId: string,
  container?: SandboxHandle,
  options: { merge?: boolean } = {},
): Promise<ClaudeCloudLoginHealth[] | null> => {
  const url = await loginBackupUrl(env, ownerId, "PUT");
  if (!url) return null;
  const getUrl = options.merge ? await loginBackupUrl(env, ownerId, "GET") : null;
  if (options.merge && !getUrl) return null;
  const result = await runScript(env, ownerId, ["backup"], {
    url,
    timeoutMs: 120_000,
    ...(getUrl ? { extraEnv: { MERGE: "1", GET_URL: getUrl } } : {}),
    ...(container ? { container } : {}),
  });
  if (!result.ok) {
    console.error(
      JSON.stringify({ level: "error", event: "claude_cloud_login_backup_failed", message: result.error }),
    );
    return null;
  }
  return result.skipped === true ? [] : loginHealthOf(result.logins);
};

export const restoreClaudeCloudLogins = async (
  env: Cloudflare.Env,
  ownerId: string,
  container?: SandboxHandle,
): Promise<boolean> => {
  const started = Date.now();
  const url = await loginBackupUrl(env, ownerId, "GET");
  if (!url) return false;
  const signedAt = Date.now();
  const stored = await (env as unknown as { BACKUP_BUCKET?: R2Bucket }).BACKUP_BUCKET?.head(
    await loginBackupKey(ownerId),
  ).then(
    (object) => (object ? object.etag.replace(/"/gu, "") : "absent"),
    () => undefined,
  );
  const headAt = Date.now();
  const result = await runScript(env, ownerId, ["restore"], {
    url,
    timeoutMs: 120_000,
    ...(stored ? { extraEnv: { ETAG: stored } } : {}),
    ...(container ? { container } : {}),
  });
  console.log(
    JSON.stringify({
      level: "info",
      event: "claude_cloud_login_restore_timing",
      backup: stored === undefined ? "unknown" : stored === "absent" ? "absent" : "present",
      outcome: !result.ok ? "failed" : result.current === true ? "current" : result.restored === true ? "restored" : "kept",
      signMs: signedAt - started,
      headMs: headAt - signedAt,
      scriptMs: Date.now() - headAt,
    }),
  );
  if (!result.ok) {
    console.error(
      JSON.stringify({ level: "error", event: "claude_cloud_login_restore_failed", message: result.error }),
    );
    return false;
  }
  if (result.restored === true) {
    console.log(JSON.stringify({ level: "info", event: "claude_cloud_login_restored" }));
  }
  return true;
};

export const CLAUDE_LOGIN_PROBE_EMAIL = "probe@test.stella.local";

export const claudeLoginProbe = async (
  env: Cloudflare.Env,
  ownerId: string,
  action: "plant" | "inspect" | "backup" | "restore" | "replace",
): Promise<unknown> => {
  const key = await claudeCloudAccountKey(CLAUDE_LOGIN_PROBE_EMAIL);
  if (action === "backup") return { ok: (await backupClaudeCloudLogins(env, ownerId)) !== null };
  if (action === "restore") return { ok: await restoreClaudeCloudLogins(env, ownerId) };
  if (action === "replace") {
    await (await claudeLoginContainer(env, ownerId)).destroy();
    return { ok: true };
  }
  if (action === "plant") {
    return await runScript(env, ownerId, ["probe-plant", key], {
      timeoutMs: 120_000,
      extraEnv: {
        PROBE_CREDENTIALS: JSON.stringify({
          claudeAiOauth: {
            accessToken: "sk-ant-oat01-stella-backup-probe-fake",
            refreshToken: "sk-ant-ort01-stella-backup-probe-fake",
            expiresAt: 4_102_444_800_000,
            scopes: ["user:inference", "user:profile"],
            subscriptionType: "pro",
          },
        }),
        PROBE_CONFIG: JSON.stringify({
          oauthAccount: {
            emailAddress: CLAUDE_LOGIN_PROBE_EMAIL,
            organizationUuid: "00000000-0000-0000-0000-000000000000",
          },
          hasCompletedOnboarding: true,
        }),
      },
    });
  }
  return await runScript(env, ownerId, ["probe-inspect", key], { timeoutMs: 120_000 });
};

export const seedTestClaudeLogin = async (
  env: Cloudflare.Env,
  ownerId: string,
  container: SandboxHandle,
): Promise<boolean> => {
  if (!(await isTestAccountOwner(env, ownerId))) return false;
  const credentials = testClaudeCredentials(env);
  if (!credentials) return false;
  const result = await runScript(
    env,
    ownerId,
    ["test-seed", await claudeCloudAccountKey(TEST_CLAUDE_EMAIL)],
    { timeoutMs: 60_000, container, extraEnv: { TEST_CREDENTIALS: credentials } },
  );
  if (!result.ok) {
    console.error(
      JSON.stringify({ level: "error", event: "test_claude_seed_failed", message: result.error }),
    );
  }
  return result.ok;
};

export const deleteClaudeCloudLoginBackup = async (
  env: Cloudflare.Env,
  ownerId: string,
): Promise<void> => {
  const bucket = (env as unknown as { BACKUP_BUCKET?: R2Bucket }).BACKUP_BUCKET;
  await bucket?.delete(await loginBackupKey(ownerId));
};

export const newClaudeCloudLoginId = (): string =>
  crypto.randomUUID().replaceAll("-", "");

export const startClaudeCloudLogin = async (
  env: Cloudflare.Env,
  ownerId: string,
  loginId: string,
  email: string | undefined,
): Promise<{ ok: true; authorizeUrl: string } | { ok: false; error: string }> => {
  if (!LOGIN_ID.test(loginId)) return { ok: false, error: "Invalid sign-in." };
  await restoreClaudeCloudLogins(env, ownerId);
  const result = await runScript(env, ownerId, ["start", loginId, email ?? ""], {
    timeoutMs: 120_000,
  });
  if (!result.ok) return result;
  const url = typeof result.authorizeUrl === "string" ? result.authorizeUrl : "";
  if (!/^https:\/\/[^\s]+$/u.test(url)) {
    return { ok: false, error: "Claude Code didn't give a sign-in link. Try again." };
  }
  return { ok: true, authorizeUrl: url };
};

export const finishClaudeCloudLogin = async (
  env: Cloudflare.Env,
  ownerId: string,
  loginId: string,
  code: string,
): Promise<
  | { ok: true; email: string; plan?: string; key: string; logins: ClaudeCloudLoginHealth[] | null }
  | { ok: false; error: string }
> => {
  if (!LOGIN_ID.test(loginId)) return { ok: false, error: "This sign-in expired. Start again." };
  const result = await runScript(env, ownerId, ["finish", loginId], {
    code,
    timeoutMs: 120_000,
  });
  if (!result.ok) return result;
  const email = typeof result.email === "string" ? result.email.trim() : "";
  const key = typeof result.key === "string" ? result.key : "";
  if (!email || !isCloudClaudeAccountKey(key)) {
    return { ok: false, error: "Claude Code signed in but didn't say which account." };
  }
  const plan = typeof result.plan === "string" && result.plan ? result.plan : undefined;
  const logins = await backupClaudeCloudLogins(env, ownerId);
  return { ok: true, email, key, logins, ...(plan ? { plan } : {}) };
};

export const cancelClaudeCloudLogin = async (
  env: Cloudflare.Env,
  ownerId: string,
  loginId: string,
): Promise<void> => {
  if (!LOGIN_ID.test(loginId)) return;
  await runScript(env, ownerId, ["cancel", loginId], { timeoutMs: 30_000 });
};

export const signOutClaudeCloudAccount = async (
  env: Cloudflare.Env,
  ownerId: string,
  key: string,
): Promise<void> => {
  if (!isCloudClaudeAccountKey(key)) return;
  await restoreClaudeCloudLogins(env, ownerId);
  await runScript(env, ownerId, ["logout", key], { timeoutMs: 60_000 });
  await backupClaudeCloudLogins(env, ownerId);
};
