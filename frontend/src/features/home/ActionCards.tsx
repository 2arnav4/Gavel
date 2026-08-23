import { LogIn, Plus } from "lucide-react";
import { ActionCard } from "../../components/ui/ActionCard";

const actions = [
  {
    to: "/create",
    icon: Plus,
    title: "Create Auction Room",
    description:
      "Set up a new auction, add items, and invite participants with a shareable room code.",
  },
  {
    to: "/join",
    icon: LogIn,
    title: "Join Existing Room",
    description:
      "Enter a room code and your username to join an auction as a participant.",
  },
] as const;

export function ActionCards() {
  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="animate-fade-in-up-delay-3 mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 sm:gap-6">
        {actions.map((action) => (
          <ActionCard key={action.to} {...action} />
        ))}
      </div>
    </section>
  );
}
