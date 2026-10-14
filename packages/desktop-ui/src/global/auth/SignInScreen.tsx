import { AuthMethods } from "./AuthDialog";
import "./AuthDialog.css";

/**
 * Stella needs an account before the first chat. A computer (or browser)
 * with none sees this in place of the chat until the user signs in; on a
 * self-hosted server the pairing screen takes its place instead.
 */
export function SignInScreen() {
  return (
    <div className="auth-screen" data-testid="sign-in-screen">
      <div className="auth-screen__card">
        <AuthMethods />
      </div>
    </div>
  );
}
