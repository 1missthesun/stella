import { App } from "./App.tsx";
import { AppProviders } from "./context/AppProviders";
import { BackendAuthProvider } from "./global/auth/BackendAuthProvider";
import { ErrorBoundary } from "./shell/ErrorBoundary";

export function AppRoot() {
  return (
    <ErrorBoundary>
      <BackendAuthProvider enableRuntimeEffects>
        <AppProviders>
          <App />
        </AppProviders>
      </BackendAuthProvider>
    </ErrorBoundary>
  );
}
