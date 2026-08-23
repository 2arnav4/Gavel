import { Sparkles } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute right-0 top-1/4 h-[300px] w-[400px] rounded-full bg-accent-muted/5 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-6xl text-center">
        <div className="animate-fade-in-up mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised/80 px-3 py-1 text-xs text-text-secondary">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Live bidding, synchronized for everyone
        </div>

        <h1 className="animate-fade-in-up-delay-1 bg-gradient-to-b from-text-primary to-text-secondary bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl md:text-6xl lg:text-7xl">
          Gavel
        </h1>

        <p className="animate-fade-in-up-delay-2 mx-auto mt-6 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
          Host live auctions with multiple participants. Create a room, invite
          bidders, and watch bids roll in real time with a synchronized
          countdown timer.
        </p>
      </div>
    </section>
  );
}
