import { useAuthDialog } from "./AuthDialog.styles";
import { AuthMethods } from "./AuthDialog";

export function SignInScreen() {
  const s = useAuthDialog();
  return (
    <row {...s.authScreen}>
      <col {...s.authScreenCard}>
        <AuthMethods />
      </col>
    </row>
  );
}
