export type SafeElement = Readonly<{
  ref: string;
  role: string;
  name: string;
  selector?: string;
  href?: string;
  checked?: boolean;
  disabled?: boolean;
  sensitive?: boolean;
}>;

export type SafeObservation = Readonly<{
  url: string;
  title: string;
  text: string;
  elements: readonly SafeElement[];
}>;

export type SafeScreenshot = Readonly<{
  mimeType: "image/jpeg";
  data: string;
  width: number;
  height: number;
}>;

export type ScreenshotRequest = Readonly<{ fullPage: boolean }>;

export type BrowserCookie = Readonly<{
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}>;

export type NetworkEntry = Readonly<{
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  ok?: boolean;
  failure?: string;
  bodyAvailable?: boolean;
}>;

export type ScrollRequest = Readonly<{
  direction: "up" | "down" | "left" | "right";
  amount: number;
  selector?: string;
}>;

export type SafeTab = Readonly<{
  tabId: string;
  url: string;
  title: string;
  active: boolean;
}>;

export type BrowserHandoff = Readonly<{
  handoffId: string;
  targetId: string;
}>;

export type HandoffState = Readonly<{
  active: boolean;
  handoffId?: string;
}>;

export type TrustedVerification = Readonly<{
  expectedOrigin: string;
  authenticatedSelector: string;
  loggedOutSelector: string;
  resumeUrl: string;
}>;

export type TrustedVerificationState = "authenticated" | "logged_out";

/** `pending`: the remote session may still be running and must be closed later. */
export type RemoteCloseOutcome = "closed" | "pending";

export interface BrowserBackend {
  ensure(args: {
    sessionId?: string;
    storageState?: unknown;
    allowedOrigins: readonly string[];
    onSessionAcquired: (sessionId: string, policyDigest: string) => void;
  }): Promise<void>;
  sessionId(): string | undefined;
  policyDigest(): string | undefined;
  navigate(url: string): Promise<SafeObservation>;
  observe(): Promise<SafeObservation>;
  history(direction: "back" | "forward" | "reload"): Promise<SafeObservation>;
  hover(selector: string): Promise<void>;
  scroll(request: ScrollRequest): Promise<void>;
  setChecked(selector: string, checked: boolean): Promise<void>;
  text(selector: string): Promise<string>;
  screenshot(request: ScreenshotRequest): Promise<SafeScreenshot>;
  evaluate(script: string, arg: unknown): Promise<unknown>;
  cookies(urls?: readonly string[]): Promise<readonly BrowserCookie[]>;
  setCookies(cookies: readonly BrowserCookie[]): Promise<void>;
  clearCookies(): Promise<void>;
  requests(limit: number): Promise<readonly NetworkEntry[]>;
  responseBody(
    url: string,
  ): Promise<Readonly<{ url: string; status: number; body: string }>>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  wait(selector: string, timeoutMs: number): Promise<void>;
  tabs(): Promise<readonly SafeTab[]>;
  focusTab(tabId: string): Promise<void>;
  storageState(): Promise<unknown>;
  verifyImportedStorageState(args: {
    storageState: unknown;
    allowedOrigins: readonly string[];
    verification: TrustedVerification;
  }): Promise<void>;
  startHandoff(args: {
    handoffTimeoutMs: number;
    expectedOrigin: string;
  }): Promise<BrowserHandoff>;
  renewLiveView(liveViewTtlMs: number, targetId?: string): Promise<string>;
  handoffState(): Promise<HandoffState>;
  completeHandoff(success: boolean): Promise<void>;
  trustedVerify(
    verification: TrustedVerification,
    expectedState: TrustedVerificationState,
  ): Promise<boolean>;
  closeContext(): Promise<void>;
  closeRemote(sessionId?: string): Promise<RemoteCloseOutcome>;
}
