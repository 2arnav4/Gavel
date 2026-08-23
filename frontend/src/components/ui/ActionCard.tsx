import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

type ActionCardProps = {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
};

export function ActionCard({
  to,
  icon: Icon,
  title,
  description,
}: ActionCardProps) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col rounded-xl border border-border bg-surface-raised/50 p-6 transition-all duration-300 hover:border-accent/40 hover:bg-surface-overlay hover:shadow-[0_0_40px_rgba(99,102,241,0.08)]"
    >
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-overlay transition-colors duration-300 group-hover:border-accent/30 group-hover:bg-accent/10">
        <Icon className="h-5 w-5 text-text-secondary transition-colors duration-300 group-hover:text-accent" />
      </div>

      <h3 className="mb-2 text-lg font-semibold tracking-tight text-text-primary">
        {title}
      </h3>

      <p className="mb-6 flex-1 text-sm leading-relaxed text-text-secondary">
        {description}
      </p>

      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-all duration-300 group-hover:gap-2.5">
        Get started
        <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
}
