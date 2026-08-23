import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <header className="space-y-3">
      {children}
      <h1 className="text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
        {title}
      </h1>
      <p className="max-w-xl text-base leading-relaxed text-text-secondary">
        {description}
      </p>
    </header>
  );
}
