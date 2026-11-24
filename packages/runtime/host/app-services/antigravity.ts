/** Google Antigravity's sign-in, run through Google's own CLI (see kernel/integrations/antigravity-sign-in). */
import type { AntigravityStatus } from "@stella/contracts/antigravity";
import { createCancelableRegistry } from "./cancelable.js";

const loadSignIn = () => import("../../kernel/integrations/antigravity-sign-in.js");
const loadStatus = () => import("../../kernel/integrations/antigravity-cli-status.js");

const signIns = createCancelableRegistry();

const loginIdOf = (request: { loginId?: unknown } | null | undefined): string => {
  const loginId = typeof request?.loginId === "string" ? request.loginId : "";
  if (!loginId) throw new Error("A sign-in id is required.");
  return loginId;
};

export const antigravityStatusForApp = async (dataDir: string): Promise<AntigravityStatus> => {
  const [{ antigravityInstalled, antigravitySignedIn }, { antigravityHomeFor, knownAntigravityModels }] = await Promise.all([loadSignIn(), loadStatus()]);
  const home = antigravityHomeFor(dataDir);
  const signedIn = await antigravitySignedIn(home);
  const models = signedIn ? knownAntigravityModels(home) : [];
  return { installed: antigravityInstalled(), signedIn, ...(models.length > 0 ? { models } : {}) };
};

/** One scheduled check: install, update or repair `agy` where Stella uses it. */
export const checkAntigravityCliUpdate = async (dataDir: string) => {
  const [{ updateAntigravityCli }, { knownAntigravitySignIn, antigravityHomeFor }] = await Promise.all([
    import("../../kernel/integrations/antigravity-cli-install.js"),
    loadStatus(),
  ]);
  try {
    return await updateAntigravityCli({ signedIn: knownAntigravitySignIn(antigravityHomeFor(dataDir)) });
  } catch (error) {
    return { status: "failed" as const, version: null, output: error instanceof Error ? error.message : String(error) };
  }
};

export const signInAntigravityForApp = async (
  dataDir: string,
  request: { loginId?: unknown } | null | undefined,
  onUrl: (url: string) => void,
): Promise<void> => {
  const loginId = loginIdOf(request);
  const [{ signInAntigravity }, { antigravityHomeFor }] = await Promise.all([loadSignIn(), loadStatus()]);
  await signIns.run(loginId, (signal) => signInAntigravity({ loginId, home: antigravityHomeFor(dataDir), signal, onUrl }));
};

export const answerAntigravitySignInForApp = async (
  request: { loginId?: unknown; code?: unknown } | null | undefined,
): Promise<void> => {
  const { answerAntigravitySignIn } = await loadSignIn();
  answerAntigravitySignIn(loginIdOf(request), typeof request?.code === "string" ? request.code : "");
};

export const cancelAntigravitySignInForApp = (request: { loginId?: unknown } | null | undefined) => ({
  canceled: signIns.cancel(typeof request?.loginId === "string" ? request.loginId : "", new Error("Google sign-in was canceled.")),
});

export const signOutAntigravityForApp = async (dataDir: string): Promise<void> => {
  const [{ signOutAntigravity }, { antigravityHomeFor }] = await Promise.all([loadSignIn(), loadStatus()]);
  await signOutAntigravity(antigravityHomeFor(dataDir));
};
