import { ActionCards } from "../features/home/ActionCards";
import { HeroSection } from "../features/home/HeroSection";
import { AuthPortal } from "../features/auth/AuthPortal";
import { useSessionStore } from "../stores/useSessionStore";

export function HomePage() {
  const authUser = useSessionStore((state) => state.authUser);

  return (
    <div className="relative">
      <HeroSection />
      {authUser ? <ActionCards /> : <AuthPortal />}
    </div>
  );
}
