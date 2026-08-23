import { Link, useNavigate } from "react-router-dom";
import { LogOut, User } from "lucide-react";
import { useSessionStore } from "../stores/useSessionStore";
import { logout } from "../services/api";

export function Navbar() {
  const navigate = useNavigate();
  const authUser = useSessionStore((state) => state.authUser);
  const roomRole = useSessionStore((state) => state.role);
  const setAuthUser = useSessionStore((state) => state.setAuthUser);
  const clearSession = useSessionStore((state) => state.clearSession);

  const handleLogout = async () => {
    try {
      await logout();
      setAuthUser(null);
      clearSession();
      navigate("/");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  return (
    <header className="border-b border-border bg-surface-raised">
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          to="/"
          className="text-lg font-semibold tracking-tight text-text-primary transition-colors hover:text-accent"
        >
          Gavel
        </Link>

        {authUser && (
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-text-secondary bg-surface-overlay/80 border border-border px-2.5 py-1 rounded-full">
              <User className="h-3 w-3 text-accent" />
              <span>{authUser.username}</span>
              <span className="text-[10px] text-text-muted capitalize">
                ({roomRole === "admin" ? "Host" : roomRole === "participant" ? "Bidder" : authUser.role === "admin" ? "Host" : "Bidder"})
              </span>
            </span>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-text-muted hover:text-red-400 transition-colors font-medium cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Logout</span>
            </button>
          </div>
        )}
      </nav>
    </header>
  );
}
