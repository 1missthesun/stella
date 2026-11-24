export type AntigravityStatus = {
  installed: boolean;
  signedIn: boolean;
  models?: string[];
};

export type AntigravitySignInProgress =
  | { phase: "preparing" }
  | { phase: "code"; loginId: string; url: string };
