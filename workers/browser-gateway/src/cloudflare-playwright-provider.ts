import {
  acquire,
  connect,
  sessions,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@cloudflare/playwright";
import { collectElements, type RawElement } from "./collect-elements.page.js";
import { GatewayError } from "./errors.js";
import { handoffNetworkRequestAllowed } from "./handoff-navigation-policy.js";
import { browserGuardrailDomains } from "./network-policy.js";
import { sha256Hex, stableJson } from "./protocol.js";
import {
  SENSITIVE_OBSERVATION_SELECTOR,
  redactVisibleText,
  sanitizePageUrl,
} from "./safe-observation.js";
import {
  ELEMENT_REF_ATTRIBUTE,
  exactRoleSelector,
  toPlaywrightSelector,
} from "./selectors.js";
import { trustedVerifyPageResult } from "./trusted-verification.js";
import type {
  BrowserBackend,
  BrowserCookie,
  BrowserHandoff,
  HandoffState,
  NetworkEntry,
  RemoteCloseOutcome,
  SafeElement,
  SafeObservation,
  SafeScreenshot,
  SafeTab,
  ScreenshotRequest,
  ScrollRequest,
  TrustedVerification,
  TrustedVerificationState,
} from "./browser-provider.js";
import {
  isBrowserStorageSnapshot,
  type BrowserStorageSnapshot,
} from "./browser-provider.js";

type BrowserWorker = { fetch: typeof fetch };

const boundedString = (value: unknown, maximum: number): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new GatewayError("bad_request", 400);
  }
  return value;
};

const safeTitle = (value: string): string =>
  redactVisibleText(value).slice(0, 512);

const SENSITIVE_CONTROL_PATTERN =
  "(?:password|email|tel|username|one-time-code|otp|token|secret|passkey|cc-)";

const MAX_OBSERVED_ELEMENTS = 150;
const SCREENSHOT_MAX_BYTES = 6 * 1024 * 1024;
const NETWORK_LOG_SIZE = 500;
const NETWORK_BODY_RETAINED = 100;
const RESPONSE_BODY_MAX_CHARS = 8 * 1024 * 1024;




const safeElement = (raw: RawElement): SafeElement => {
  const name = redactVisibleText(raw.name ?? "").slice(0, 120);
  const nameIsPublic = name === raw.name;
  const selector =
    raw.id && !raw.id.includes("@")
      ? `#${raw.id}`
      : raw.testId
        ? `[data-testid="${raw.testId}"]`
        : nameIsPublic && name
          ? exactRoleSelector(raw.role, name)
          : undefined;
  const href = raw.href ? sanitizePageUrl(raw.href) : "";
  return {
    ref: raw.ref,
    role: raw.role,
    name,
    ...(selector ? { selector } : {}),
    ...(href ? { href } : {}),
    ...(raw.checked !== undefined ? { checked: raw.checked } : {}),
    ...(raw.disabled ? { disabled: true } : {}),
    ...(raw.sensitive ? { sensitive: true } : {}),
  };
};

const base64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const trustedVerifyPage = async (
  page: Page,
  verification: TrustedVerification,
  expectedState: TrustedVerificationState,
): Promise<boolean> =>
  (await trustedVerifyPageResult(page, verification, expectedState)).verified;

export class CloudflarePlaywrightProvider implements BrowserBackend {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private cdp: CDPSession | undefined;
  private currentSessionId: string | undefined;
  private currentPolicyDigest: string | undefined;
  // Stella owns the human handoff end to end. Cloudflare's structured
  // `Cloudflare.handoff` command is deliberately not used: its Live View
  // renders a hardcoded "Human Intervention Required" panel with its own
  // Done/Failed buttons on top of the page, duplicating Stella's controls.
  // The navigation fence, verification, expiry, and Done/Cancel decisions all
  // live in the gateway, so the remote browser only needs an interactive
  // Live View of the fenced page.
  private activeHandoffId: string | undefined;
  private network: Array<{
    entry: NetworkEntry;
    response?: import("@cloudflare/playwright").Response;
  }> = [];
  private handoffOriginViolation = false;
  private handoffRouteHandler:
    Parameters<BrowserContext["route"]>[1] | undefined;

  constructor(
    private readonly endpoint: BrowserWorker,
    private readonly keepAliveMs: number,
  ) {}

  sessionId(): string | undefined {
    return this.currentSessionId;
  }

  policyDigest(): string | undefined {
    return this.currentPolicyDigest;
  }

  async ensure(args: {
    sessionId?: string;
    storageState?: BrowserStorageSnapshot;
    allowedOrigins: readonly string[];
    onSessionAcquired: (sessionId: string, policyDigest: string) => void;
  }): Promise<void> {
    const allowedDomains = [...browserGuardrailDomains(args.allowedOrigins)];
    const policyDigest = await sha256Hex(stableJson(allowedDomains));
    if (
      this.browser &&
      this.context &&
      this.page &&
      this.currentPolicyDigest === policyDigest
    ) {
      return;
    }
    await this.closeContext();
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = undefined;
    }

    let browser: Browser | undefined;
    if (args.sessionId) {
      try {
        browser = await connect(this.endpoint, args.sessionId);
        this.currentSessionId = args.sessionId;
      } catch {
        browser = undefined;
      }
    }
    if (!browser) {
      let acquired: { sessionId: string };
      try {
        acquired = await acquire(this.endpoint, {
          keep_alive: this.keepAliveMs,
          recording: false,
          guardrails: { allowedDomains },
        });
      } catch {
        throw new GatewayError("browser_unavailable", 503);
      }
      this.currentSessionId = acquired.sessionId;
      this.currentPolicyDigest = policyDigest;
      args.onSessionAcquired(acquired.sessionId, policyDigest);
      try {
        browser = await connect(this.endpoint, acquired.sessionId);
      } catch {
        throw new GatewayError("browser_unavailable", 503);
      }
    }
    this.browser = browser;
    this.currentPolicyDigest = policyDigest;
    try {
      this.context = await browser.newContext(
        args.storageState ? { storageState: args.storageState } : undefined,
      );
      this.recordNetwork(this.context);
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
    } catch {
      await this.closeRemote();
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  private recordNetwork(context: BrowserContext): void {
    this.network = [];
    const remember = (
      request: import("@cloudflare/playwright").Request,
      update: Partial<NetworkEntry>,
      response?: import("@cloudflare/playwright").Response,
    ) => {
      let item = this.network.find(
        (candidate) =>
          candidate.entry.url === request.url() &&
          candidate.entry.method === request.method() &&
          candidate.entry.status === undefined &&
          candidate.entry.failure === undefined,
      );
      if (!item) {
        item = {
          entry: {
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
          },
        };
        this.network.push(item);
        if (this.network.length > NETWORK_LOG_SIZE) this.network.shift();
      }
      item.entry = { ...item.entry, ...update };
      if (response) item.response = response;
      const withBodies = this.network.filter((candidate) => candidate.response);
      for (const stale of withBodies.slice(0, -NETWORK_BODY_RETAINED)) {
        delete stale.response;
      }
    };
    context.on("request", (request) => remember(request, {}));
    context.on("response", (response) =>
      remember(
        response.request(),
        { status: response.status(), ok: response.ok() },
        response,
      ),
    );
    context.on("requestfailed", (request) =>
      remember(request, { failure: request.failure()?.errorText ?? "failed" }),
    );
  }

  private requiredPage(): Page {
    if (!this.page) throw new GatewayError("browser_unavailable", 503);
    return this.page;
  }

  private async observation(
    page = this.requiredPage(),
  ): Promise<SafeObservation> {
    try {
      const [title, text, rawElements] = await Promise.all([
        page.title(),
        page
          .locator("body")
          .evaluate((element, selector) => {
            const clone = element.cloneNode(true) as unknown as {
              querySelectorAll(selector: string): Iterable<{ remove(): void }>;
              innerText?: string;
              textContent?: string | null;
            };
            for (const sensitive of clone.querySelectorAll(selector)) {
              sensitive.remove();
            }
            return clone.innerText || clone.textContent || "";
          }, SENSITIVE_OBSERVATION_SELECTOR)
          .catch(() => ""),
        page
          .locator("body")
          .evaluate(collectElements, {
            attribute: ELEMENT_REF_ATTRIBUTE,
            max: MAX_OBSERVED_ELEMENTS,
            sensitive: SENSITIVE_CONTROL_PATTERN,
          })
          .catch((): RawElement[] => []),
      ]);
      return {
        url: sanitizePageUrl(page.url()),
        title: safeTitle(title),
        // innerText deliberately excludes form control values.
        text: redactVisibleText(text),
        elements: rawElements.map(safeElement),
      };
    } catch {
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async navigate(url: string): Promise<SafeObservation> {
    try {
      await this.requiredPage().goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      return await this.observation();
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  observe(): Promise<SafeObservation> {
    return this.observation();
  }

  async history(
    direction: "back" | "forward" | "reload",
  ): Promise<SafeObservation> {
    const page = this.requiredPage();
    const options = { waitUntil: "domcontentloaded" as const, timeout: 30_000 };
    try {
      if (direction === "back") await page.goBack(options);
      else if (direction === "forward") await page.goForward(options);
      else await page.reload(options);
      return await this.observation();
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  private async safeAgentLocator(selector: string): Promise<Locator> {
    return this.requiredPage().locator(
      toPlaywrightSelector(boundedString(selector, 4_096)),
    );
  }

  async click(selector: string): Promise<void> {
    try {
      await (
        await this.safeAgentLocator(selector)
      ).click({
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    try {
      const locator = await this.safeAgentLocator(selector);
      if (typeof value !== "string" || value.length > 65_536) {
        throw new GatewayError("bad_request", 400);
      }
      await locator.fill(value, { timeout: 15_000 });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async press(selector: string, key: string): Promise<void> {
    try {
      await (
        await this.safeAgentLocator(selector)
      ).press(boundedString(key, 64), { timeout: 15_000 });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async select(selector: string, value: string): Promise<void> {
    try {
      await (
        await this.safeAgentLocator(selector)
      ).selectOption(boundedString(value, 1_024), { timeout: 15_000 });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async wait(selector: string, timeoutMs: number): Promise<void> {
    try {
      await this.requiredPage()
        .locator(toPlaywrightSelector(boundedString(selector, 4_096)))
        .first()
        .waitFor({ state: "visible", timeout: timeoutMs });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async hover(selector: string): Promise<void> {
    try {
      await (await this.safeAgentLocator(selector)).hover({ timeout: 15_000 });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async scroll(request: ScrollRequest): Promise<void> {
    try {
      if (request.selector) {
        await (
          await this.safeAgentLocator(request.selector)
        ).scrollIntoViewIfNeeded({ timeout: 15_000 });
        return;
      }
      const delta = request.amount;
      await this.requiredPage().mouse.wheel(
        request.direction === "left" ? -delta : request.direction === "right" ? delta : 0,
        request.direction === "up" ? -delta : request.direction === "down" ? delta : 0,
      );
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async setChecked(selector: string, checked: boolean): Promise<void> {
    try {
      await (await this.safeAgentLocator(selector)).setChecked(checked, {
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async text(selector: string): Promise<string> {
    try {
      return await (await this.safeAgentLocator(selector)).innerText({
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async screenshot(request: ScreenshotRequest): Promise<SafeScreenshot> {
    const page = this.requiredPage();
    try {
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      let bytes: Uint8Array | undefined;
      for (const quality of [80, 55, 30]) {
        bytes = await page.screenshot({
          type: "jpeg",
          quality,
          fullPage: request.fullPage,
          timeout: 30_000,
          animations: "disabled",
        });
        if (bytes.byteLength <= SCREENSHOT_MAX_BYTES) break;
      }
      if (!bytes || bytes.byteLength > SCREENSHOT_MAX_BYTES) {
        throw new GatewayError("browser_unavailable", 503);
      }
      return {
        mimeType: "image/jpeg",
        data: base64(bytes),
        width: viewport.width,
        height: viewport.height,
      };
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async evaluate(script: string, arg: unknown): Promise<unknown> {
    const page = this.requiredPage();
    const source = `(async () => {
      const __stellaValue = (${script}\n);
      return typeof __stellaValue === "function"
        ? await __stellaValue(${JSON.stringify(arg ?? null)})
        : await __stellaValue;
    })()`;
    try {
      return (await page.evaluate(source)) ?? null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.split("\n")[0] ?? "" : "";
      throw new GatewayError("evaluation_failed", 422, message.slice(0, 2_000));
    }
  }

  async cookies(urls?: readonly string[]): Promise<readonly BrowserCookie[]> {
    if (!this.context) throw new GatewayError("browser_unavailable", 503);
    try {
      return (await this.context.cookies(
        urls ? [...urls] : undefined,
      )) as readonly BrowserCookie[];
    } catch {
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async setCookies(cookies: readonly BrowserCookie[]): Promise<void> {
    if (!this.context) throw new GatewayError("browser_unavailable", 503);
    try {
      await this.context.addCookies(
        cookies as Parameters<BrowserContext["addCookies"]>[0],
      );
    } catch {
      throw new GatewayError("bad_request", 400);
    }
  }

  async clearCookies(): Promise<void> {
    if (!this.context) throw new GatewayError("browser_unavailable", 503);
    try {
      await this.context.clearCookies();
    } catch {
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async requests(limit: number): Promise<readonly NetworkEntry[]> {
    return this.network.slice(-limit).map((item) => ({
      ...item.entry,
      bodyAvailable: Boolean(item.response),
    }));
  }

  async responseBody(url: string): Promise<Readonly<{ url: string; status: number; body: string }>> {
    const item = [...this.network]
      .reverse()
      .find((candidate) => candidate.response && candidate.entry.url === url);
    if (!item?.response) throw new GatewayError("not_found", 404);
    try {
      const body = await item.response.text();
      return {
        url,
        status: item.response.status(),
        body: body.slice(0, RESPONSE_BODY_MAX_CHARS),
      };
    } catch {
      throw new GatewayError("not_found", 404);
    }
  }

  async tabs(): Promise<readonly SafeTab[]> {
    if (!this.context) throw new GatewayError("browser_unavailable", 503);
    const pages = this.context.pages().slice(0, 16);
    return Promise.all(
      pages.map(async (page, index) => ({
        tabId: String(index),
        url: sanitizePageUrl(page.url()),
        title: safeTitle(await page.title().catch(() => "")),
        active: page === this.page,
      })),
    );
  }

  async focusTab(tabId: string): Promise<void> {
    if (!this.context || !/^\d{1,2}$/u.test(tabId)) {
      throw new GatewayError("bad_request", 400);
    }
    const page = this.context.pages()[Number(tabId)];
    if (!page) throw new GatewayError("not_found", 404);
    this.page = page;
    await page.bringToFront();
  }

  async storageState(): Promise<BrowserStorageSnapshot> {
    if (!this.context) throw new GatewayError("browser_unavailable", 503);
    let state: unknown;
    try {
      state = await this.context.storageState({ indexedDB: true });
    } catch {
      throw new GatewayError("browser_unavailable", 503);
    }
    if (!isBrowserStorageSnapshot(state)) {
      throw new GatewayError("browser_unavailable", 503);
    }
    return state;
  }

  async verifyImportedStorageState(args: {
    storageState: BrowserStorageSnapshot;
    allowedOrigins: readonly string[];
    verification: TrustedVerification;
  }): Promise<void> {
    let temporaryBrowser: Browser | undefined;
    let temporaryContext: BrowserContext | undefined;
    try {
      const acquired = await acquire(this.endpoint, {
        keep_alive: this.keepAliveMs,
        recording: false,
        guardrails: {
          allowedDomains: [...browserGuardrailDomains(args.allowedOrigins)],
        },
      });
      temporaryBrowser = await connect(this.endpoint, acquired.sessionId);
      temporaryContext = await temporaryBrowser.newContext({
        storageState: args.storageState,
      });
      const page =
        temporaryContext.pages()[0] ?? (await temporaryContext.newPage());
      await page.goto(args.verification.resumeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const result = await trustedVerifyPageResult(
        page,
        args.verification,
        "authenticated",
      );
      if (!result.verified) {
        console.error(
          JSON.stringify({
            service: "cloudflare-playwright-provider",
            event: "imported_session_verification_failed",
            originMatches: result.originMatches,
            authenticatedVisible: result.authenticatedVisible,
            loggedOutVisible: result.loggedOutVisible,
          }),
        );
        throw new GatewayError("verification_failed", 409);
      }
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError("browser_unavailable", 503);
    } finally {
      await temporaryContext?.close().catch(() => undefined);
      if (temporaryBrowser) {
        try {
          const cdp = await temporaryBrowser.newBrowserCDPSession();
          await cdp.send("Browser.close");
        } catch {
          // Browser.close normally races the temporary connection shutdown.
        }
        await temporaryBrowser.close().catch(() => undefined);
      }
    }
  }

  private async handoffCdp(): Promise<CDPSession> {
    if (this.cdp) return this.cdp;
    if (!this.context) throw new GatewayError("browser_unavailable", 503);
    try {
      this.cdp = await this.context.newCDPSession(this.requiredPage());
      return this.cdp;
    } catch {
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async startHandoff(args: {
    handoffTimeoutMs: number;
    expectedOrigin: string;
  }): Promise<BrowserHandoff> {
    try {
      const cdp = await this.handoffCdp();
      this.activeHandoffId = undefined;
      this.handoffOriginViolation = false;
      await this.installHandoffNavigationFence(args.expectedOrigin);
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      const handoffId = crypto.randomUUID();
      this.activeHandoffId = handoffId;
      return { handoffId, targetId: targetInfo.targetId };
    } catch {
      await this.removeHandoffNavigationFence();
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  private async installHandoffNavigationFence(
    expectedOrigin: string,
  ): Promise<void> {
    if (!this.context) throw new GatewayError("browser_unavailable", 503);
    await this.removeHandoffNavigationFence();
    const handler: Parameters<BrowserContext["route"]>[1] = async (route) => {
      const request = route.request();
      if (
        handoffNetworkRequestAllowed({
          requestUrl: request.url(),
          documentNavigation:
            request.isNavigationRequest() &&
            request.resourceType() === "document",
          expectedOrigin,
        })
      ) {
        await route.continue();
        return;
      }
      this.handoffOriginViolation = true;
      await route.abort("blockedbyclient").catch(() => undefined);
    };
    this.handoffRouteHandler = handler;
    await this.context.route("**/*", handler);
  }

  private async removeHandoffNavigationFence(): Promise<void> {
    const handler = this.handoffRouteHandler;
    this.handoffRouteHandler = undefined;
    if (handler && this.context) {
      await this.context.unroute("**/*", handler).catch(() => undefined);
    }
  }

  async renewLiveView(
    liveViewTtlMs: number,
    targetId?: string,
  ): Promise<string> {
    try {
      if (this.handoffOriginViolation) {
        throw new GatewayError("verification_failed", 409);
      }
      const liveView = await (
        await this.handoffCdp()
      ).send("Cloudflare.getLiveView", {
        ...(targetId ? { targetId } : {}),
        mode: "tab",
        expiresInMs: liveViewTtlMs,
      });
      return liveView.devtoolsFrontendUrl;
    } catch {
      throw new GatewayError("browser_unavailable", 503);
    }
  }

  async handoffState(): Promise<HandoffState> {
    if (
      this.activeHandoffId &&
      this.context &&
      this.handoffRouteHandler
    ) {
      return { active: true, handoffId: this.activeHandoffId };
    }
    return { active: false };
  }

  async completeHandoff(success: boolean): Promise<void> {
    if (success && this.handoffOriginViolation) {
      await this.removeHandoffNavigationFence();
      return;
    }
    this.activeHandoffId = undefined;
    await this.removeHandoffNavigationFence();
  }

  async trustedVerify(
    verification: TrustedVerification,
    expectedState: TrustedVerificationState,
  ): Promise<boolean> {
    if (this.handoffOriginViolation) return false;
    return await trustedVerifyPage(
      this.requiredPage(),
      verification,
      expectedState,
    );
  }

  async closeContext(): Promise<void> {
    await this.removeHandoffNavigationFence();
    this.cdp = undefined;
    this.activeHandoffId = undefined;
    this.handoffOriginViolation = false;
    this.page = undefined;
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = undefined;
    }
  }

  async closeRemote(sessionId?: string): Promise<RemoteCloseOutcome> {
    await this.closeContext();
    if (!this.browser && sessionId) {
      try {
        this.browser = await connect(this.endpoint, sessionId);
        this.currentSessionId = sessionId;
      } catch {
        this.currentSessionId = undefined;
        this.currentPolicyDigest = undefined;
        return (await this.remoteSessionIsActive(sessionId))
          ? "pending"
          : "closed";
      }
    }
    if (this.browser) {
      try {
        const cdp = await this.browser.newBrowserCDPSession();
        await cdp.send("Browser.close");
      } catch {
        // Browser.close normally races the connection shutdown.
      }
      await this.browser.close().catch(() => undefined);
      this.browser = undefined;
    }
    this.currentSessionId = undefined;
    this.currentPolicyDigest = undefined;
    return "closed";
  }

  private async remoteSessionIsActive(sessionId: string): Promise<boolean> {
    try {
      const active = await sessions(this.endpoint);
      return active.some((session) => session.sessionId === sessionId);
    } catch {
      return true;
    }
  }
}
