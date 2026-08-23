import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

type BackButtonProps = {
  label?: string;
};

export function BackButton({ label = "Back to Home" }: BackButtonProps) {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-2 text-sm text-text-secondary transition-colors duration-200 hover:text-text-primary"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
