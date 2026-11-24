import { AuthMethods } from "./AuthDialog";
import "./AuthDialog.css";

/** Where chats only live in an account: the browser has no local chat to open. */
export function SignInScreen() {
  return (
    <div className="auth-screen" data-testid="sign-in-screen">
      <div className="auth-screen__card">
        <AuthMethods />
      </div>
    </div>
  );
}
