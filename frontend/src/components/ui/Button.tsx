import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonBaseProps = {
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
};

type ButtonAsButton = ButtonBaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    to?: never;
  };

type ButtonAsLink = ButtonBaseProps & {
  to: string;
  onClick?: never;
  type?: never;
  disabled?: never;
};

type ButtonProps = ButtonAsButton | ButtonAsLink;

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover border border-accent/20 shadow-[0_0_20px_rgba(99,102,241,0.15)]",
  secondary:
    "bg-surface-overlay text-text-primary hover:bg-surface-raised border border-border hover:border-border",
  ghost:
    "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-transparent",
};

export function Button({
  variant = "primary",
  children,
  className = "",
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50";

  const styles = `${baseStyles} ${variantStyles[variant]} ${className}`;

  if ("to" in props && props.to) {
    return (
      <Link to={props.to} className={styles}>
        {children}
      </Link>
    );
  }

  const buttonProps = props as ButtonAsButton;

  return (
    <button className={styles} {...buttonProps}>
      {children}
    </button>
  );
}
