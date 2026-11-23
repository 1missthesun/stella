import {
  BrowserSecretMaskRun,
  BrowserSecretPlaceholderError,
  BrowserSecretVault,
  PAGE_SECRET_FIELDS_SCRIPT,
  mayCarryPageValues,
  protectActionData,
  rememberPageSecretFields,
  siteOfUrl,
  substituteBrowserPlaceholders,
  type SavedBrowserSecrets,
} from "@stella/node-shared/browser/secret-masking.js";
import { containsBrowserSecretPlaceholder } from "@stella/node-shared/browser/secret-placeholder.js";
import { GatewayError } from "./errors.js";

/*
 * Agents get placeholders for the credentials in what the browser returns, as
 * they do from the browsers on a computer. The values stay in the gateway.
 */

const MAX_VAULTS = 16;

type Params = Record<string, unknown>;

export type SecretPage = Readonly<{
  url(): Promise<string | undefined>;
  evaluate(script: string): Promise<unknown>;
}>;

/** This gateway's actions by the name the masking rules know them. */
const MASKED_ACTIONS: Readonly<Record<string, string>> = {
  "browser.evaluate": "evaluate",
  "browser.requests": "requests",
  "browser.response_body": "responsebody",
  "browser.cookies": "cookies_get",
};

export type SubstitutedParams = Readonly<{
  params: unknown;
  inserted?: ReadonlyMap<string, string>;
}>;

export class ThreadBrowserSecrets {
  private constructor(private readonly vault: BrowserSecretVault) {}

  static from(saved?: SavedBrowserSecrets): ThreadBrowserSecrets {
    return new ThreadBrowserSecrets(new BrowserSecretVault(saved));
  }

  save(maxChars: number): SavedBrowserSecrets {
    return this.vault.save(maxChars);
  }

  async substitute(
    action: string,
    params: unknown,
    page: SecretPage,
  ): Promise<SubstitutedParams> {
    if (
      typeof params !== "object" ||
      params === null ||
      !action.startsWith("browser.") ||
      !containsBrowserSecretPlaceholder(JSON.stringify(params))
    ) {
      return { params };
    }
    const inserted = new Map<string, string>();
    const swap = async (name: string, given: Params): Promise<Params> => {
      const swapped = await substituteBrowserPlaceholders(
        this.vault,
        "command",
        [name, given],
        async () => siteOfUrl(await page.url()),
      );
      if (!swapped) return given;
      for (const [value, placeholder] of swapped.inserted) {
        inserted.set(value, placeholder);
      }
      return swapped.args[1] as Params;
    };
    const given = params as Params;
    let next: Params = given;
    try {
      switch (action) {
        case "browser.open": {
          const { url } = await swap("navigate", { url: given.startUrl });
          next = { ...given, startUrl: url };
          break;
        }
        case "browser.navigate":
          next = await swap("navigate", given);
          break;
        case "browser.evaluate":
          next = await swap("evaluate", given);
          break;
        case "browser.set_cookies":
          if (Array.isArray(given.cookies)) {
            const cookies: unknown[] = [];
            for (const cookie of given.cookies) {
              cookies.push(
                typeof cookie === "object" && cookie !== null
                  ? await swap("cookies_set", cookie as Params)
                  : cookie,
              );
            }
            next = { ...given, cookies };
          }
          break;
        case "browser.login_takeover":
          break;
        default:
          next = await swap(action, given);
      }
    } catch (error) {
      if (error instanceof BrowserSecretPlaceholderError) {
        throw new GatewayError("secret_refused", 409, error.message);
      }
      throw error;
    }
    return { params: next, inserted };
  }

  async mask(
    action: string,
    params: unknown,
    data: unknown,
    page: SecretPage,
    inserted?: ReadonlyMap<string, string>,
  ): Promise<unknown> {
    if (data === undefined || action === "browser.screenshot") return data;
    const run = new BrowserSecretMaskRun(this.vault, {
      ...(inserted ? { reverse: inserted } : {}),
    });
    if (action === "browser.evaluate" && mayCarryPageValues(data)) {
      run.site = rememberPageSecretFields(
        this.vault,
        await page.evaluate(PAGE_SECRET_FIELDS_SCRIPT).catch(() => undefined),
      );
    }
    let masked = protectActionData(
      run,
      MASKED_ACTIONS[action] ?? action,
      params as Params,
      data,
    );
    const before = run.masked;
    masked = run.deep(masked);
    if (run.masked !== before) masked = run.deep(masked);
    if (run.hasPendingSites) {
      run.bindPendingSites(
        siteOfUrl(await page.url().catch(() => undefined)),
      );
    }
    return masked;
  }
}

/** One thread's secrets each, the least recently used dropped. */
export class ThreadSecretCache {
  private readonly threads = new Map<string, ThreadBrowserSecrets>();

  get(threadDigest: string): ThreadBrowserSecrets | undefined {
    const found = this.threads.get(threadDigest);
    if (found) this.put(threadDigest, found);
    return found;
  }

  put(threadDigest: string, secrets: ThreadBrowserSecrets): void {
    this.threads.delete(threadDigest);
    this.threads.set(threadDigest, secrets);
    while (this.threads.size > MAX_VAULTS) {
      this.threads.delete(this.threads.keys().next().value!);
    }
  }

  clear(): void {
    this.threads.clear();
  }
}
