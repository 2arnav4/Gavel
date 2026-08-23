import { AppProviders } from "./providers";
import { AppRouter } from "./router";
import { AuthInitializer } from "./AuthInitializer";

export function App() {
  return (
    <AppProviders>
      <AuthInitializer>
        <AppRouter />
      </AuthInitializer>
    </AppProviders>
  );
}
