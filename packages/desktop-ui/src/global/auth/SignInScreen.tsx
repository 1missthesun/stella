import { AuthMethods } from "./AuthDialog";
import "./AuthDialog.css";

export function SignInScreen() {
  return (
    <div className="auth-screen" data-testid="sign-in-screen">
      <div className="auth-screen__card">
        <AuthMethods />
      </div>
    </div>
  );
}
