/** Google Antigravity on this computer: Google's own CLI (`agy`), and the Google sign-in it keeps for Stella. */
export type AntigravityStatus = {
  installed: boolean;
  signedIn: boolean;
};

export type AntigravitySignInProgress =
  | { phase: "preparing" }
  /** Google's page is open; the CLI waits for the code it shows. */
  | { phase: "code"; loginId: string; url: string };
