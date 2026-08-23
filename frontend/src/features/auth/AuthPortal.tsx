import { useState } from "react";
import { LogIn, ShieldAlert, User, HelpCircle, UserPlus, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useSessionStore } from "../../stores/useSessionStore";
import { login, register } from "../../services/api";
import { getErrorMessage } from "../../utils/error";

export function AuthPortal() {
  const setAuthUser = useSessionStore((state) => state.setAuthUser);
  const setAuthToken = useSessionStore((state) => state.setAuthToken);

  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const validateClientPassword = (pass: string): string | null => {
    if (pass.length < 8) {
      return "Password must be at least 8 characters long.";
    }
    if (!/[A-Z]/.test(pass)) {
      return "Password must contain at least one uppercase letter.";
    }
    if (!/[a-z]/.test(pass)) {
      return "Password must contain at least one lowercase letter.";
    }
    if (!/[0-9]/.test(pass)) {
      return "Password must contain at least one digit.";
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pass)) {
      return "Password must contain at least one special character (e.g. !, @, #, $, etc.).";
    }
    return null;
  };

  const handleLoginSubmit = async (e: React.FormEvent | null, customUser?: string, customPass?: string) => {
    if (e) e.preventDefault();

    const targetUser = customUser ?? username;
    const targetPass = customPass ?? password;

    if (!targetUser.trim()) {
      setError("Please specify a username.");
      return;
    }

    if (!customUser && !targetPass) {
      setError("Please specify a password.");
      return;
    }

    // Client-side password validation on Sign Up
    if (!customUser && activeTab === "signup") {
      const passwordErr = validateClientPassword(targetPass);
      if (passwordErr) {
        setError(passwordErr);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      let data;
      if (!customUser && activeTab === "signup") {
        data = await register(targetUser.trim(), targetPass);
      } else {
        data = await login(targetUser.trim(), targetPass ? targetPass : undefined);
      }
      // Stored before the user, so any request triggered by the state change
      // already has a token to send.
      setAuthToken(data.token ?? null);
      setAuthUser({ username: data.username, role: data.role });
    } catch (err: unknown) {
      console.error("Authentication failed:", err);
      setError(getErrorMessage(err, "Authentication failed."));
    } finally {
      setLoading(false);
    }
  };

  const triggerQuickDemo = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    void handleLoginSubmit(null, user, pass);
  };

  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="mx-auto max-w-md w-full animate-fade-in-up-delay-3">
        <form
          onSubmit={(e) => handleLoginSubmit(e)}
          className="border border-border bg-surface-raised/40 backdrop-blur-md p-6 rounded-xl space-y-6 shadow-xl"
        >
          <div className="border-b border-border/40 pb-4 text-center">
            <h2 className="text-lg font-bold text-text-primary tracking-tight">Onboard Session Log-in</h2>
            <p className="text-xs text-text-secondary mt-1">
              Select a preconfigured demo account or enter a custom account to sign in/up.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-sm text-red-400">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="leading-snug">{error}</p>
            </div>
          )}

          {/* Quick Demo Credentials Selection */}
          <div className="space-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <HelpCircle className="h-3 w-3 text-accent" />
              Instant Demo Accounts
            </span>
            <div className="grid grid-cols-1">
              <button
                type="button"
                onClick={() => triggerQuickDemo("demo", "password123")}
                disabled={loading}
                className="flex flex-col items-center justify-center p-4 rounded-lg border border-border bg-surface-overlay/25 hover:bg-accent/10 hover:border-accent/40 text-center transition-all cursor-pointer group"
              >
                <span className="text-xs font-bold text-accent group-hover:text-accent-hover">Use Demo Account</span>
                <span className="text-[10px] text-text-muted mt-0.5 font-mono">Username: demo / Password: password123</span>
              </button>
            </div>
          </div>

          {/* Selection Tabs */}
          <div className="flex border-b border-border/40">
            <button
              type="button"
              onClick={() => {
                setActiveTab("signin");
                setError(null);
              }}
              disabled={loading}
              className={`flex-1 pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-center transition-all border-b-2 cursor-pointer ${
                activeTab === "signin"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("signup");
                setError(null);
              }}
              disabled={loading}
              className={`flex-1 pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-center transition-all border-b-2 cursor-pointer ${
                activeTab === "signup"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Input Form */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="auth-username"
                className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1"
              >
                <User className="h-3 w-3 text-text-muted" />
                Username
              </label>
              <input
                id="auth-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. Alice"
                disabled={loading}
                className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-lg px-4 py-2 text-xs text-text-primary placeholder:text-text-muted transition-all outline-none"
              />
            </div>

            <div className="space-y-1.5 animate-fade-in">
              <label
                htmlFor="auth-password"
                className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1"
              >
                <Lock className="h-3 w-3 text-text-muted" />
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password123"
                  disabled={loading}
                  className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-lg px-4 py-2 pr-10 text-xs text-text-primary placeholder:text-text-muted transition-all outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary hover:bg-surface-raised cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>

              {activeTab === "signup" && password && (
                <div className="text-[10px] space-y-1 mt-2 p-2 rounded bg-surface-overlay/50 border border-border/20">
                  <p className="font-semibold text-text-secondary">Password Requirements:</p>
                  <ul className="list-disc pl-3.5 space-y-0.5 text-text-muted">
                    <li className={password.length >= 8 ? "text-green-400" : ""}>At least 8 characters</li>
                    <li className={/[A-Z]/.test(password) ? "text-green-400" : ""}>At least one uppercase letter (A-Z)</li>
                    <li className={/[a-z]/.test(password) ? "text-green-400" : ""}>At least one lowercase letter (a-z)</li>
                    <li className={/[0-9]/.test(password) ? "text-green-400" : ""}>At least one number (0-9)</li>
                    <li className={/[!@#$%^&*(),.?":{}|<>]/.test(password) ? "text-green-400" : ""}>At least one special character</li>
                  </ul>
                </div>
              )}
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-2"
            variant="primary"
          >
            {activeTab === "signup" ? (
              <>
                <UserPlus className="h-4 w-4" />
                {loading ? "Registering..." : "Sign Up"}
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                {loading ? "Authenticating..." : "Sign In"}
              </>
            )}
          </Button>
        </form>
      </div>
    </section>
  );
}
