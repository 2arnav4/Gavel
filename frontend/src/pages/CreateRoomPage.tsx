import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import { BackButton } from "../components/ui/BackButton";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { createRoom } from "../services/api";
import { useSessionStore } from "../stores/useSessionStore";
import { getErrorMessage } from "../utils/error";

// Matches the server's fallback. Shown pre-filled so the field reads as a
// setting with a sensible value rather than a question.
const DEFAULT_STARTING_BUDGET = 100_000;
const DEFAULT_MIN_BID_INCREMENT = 500;

export function CreateRoomPage() {
  const navigate = useNavigate();
  const authUser = useSessionStore((state) => state.authUser);
  const setSession = useSessionStore((state) => state.setSession);

  const username = authUser?.username ?? "";
  const [roomName, setRoomName] = useState("");
  const [budget, setBudget] = useState(String(DEFAULT_STARTING_BUDGET));
  const [increment, setIncrement] = useState(String(DEFAULT_MIN_BID_INCREMENT));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authUser) {
      navigate("/");
    }
  }, [authUser, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !roomName.trim()) {
      setError("Both username and room name are required.");
      return;
    }

    const budgetValue = Number(budget);
    if (!Number.isFinite(budgetValue) || budgetValue <= 0) {
      setError("Starting budget must be a positive number.");
      return;
    }

    const incrementValue = Number(increment);
    if (!Number.isFinite(incrementValue) || incrementValue <= 0) {
      setError("Minimum raise must be a positive number.");
      return;
    }
    if (incrementValue > budgetValue) {
      setError("Minimum raise cannot exceed the bidder budget.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await createRoom(username.trim(), roomName.trim(), budgetValue, incrementValue);
      setSession({
        roomCode: data.room.code,
        sessionToken: data.sessionToken,
        username: data.participant.username,
        participantId: data.participant._id,
        role: data.participant.role,
      });
      navigate(`/lobby/${data.room.code}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Something went wrong while creating the room."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer className="px-4 py-12 sm:px-6 sm:py-16">
      <PageHeader
        title="Create Auction Room"
        description="Set up your auction room, invite bidders, and start a live bidding session."
      >
        <BackButton />
      </PageHeader>

      <div className="mx-auto max-w-md w-full mt-8">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="border border-border bg-surface-raised/40 backdrop-blur-md p-6 rounded-xl space-y-6 shadow-xl"
        >
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Identity comes from the session, so it is stated rather than asked for. */}
          <div className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-surface-overlay/40 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
              {username.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-text-muted">Hosting as</p>
              <p className="truncate text-sm font-medium text-text-primary">{username}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="roomName"
              className="text-xs font-semibold uppercase tracking-wider text-text-secondary"
            >
              Room Name
            </label>
            <input
              id="roomName"
              type="text"
              required
              placeholder="e.g. Rare Art & Collectibles"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/20 rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all outline-none"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="budget"
              className="text-xs font-semibold uppercase tracking-wider text-text-secondary"
            >
              Bidder Budget
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-text-muted">₹</span>
              <input
                id="budget"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 100000"
                value={budget}
                onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/20 rounded-lg pl-8 pr-4 py-2.5 text-sm tabular-nums text-text-primary placeholder:text-text-muted transition-all outline-none"
                disabled={loading}
              />
            </div>
            <p className="text-[10px] text-text-muted">
              Every bidder starts with this purse and cannot bid beyond what is left of it.
              Fixed once the room is created.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="increment"
              className="text-xs font-semibold uppercase tracking-wider text-text-secondary"
            >
              Minimum Raise
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-text-muted">₹</span>
              <input
                id="increment"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 500"
                value={increment}
                onChange={(e) => setIncrement(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/20 rounded-lg pl-8 pr-4 py-2.5 text-sm tabular-nums text-text-primary placeholder:text-text-muted transition-all outline-none"
                disabled={loading}
              />
            </div>
            <p className="text-[10px] text-text-muted">
              The smallest legal raise over the standing bid, like an auctioneer's step.
              The opening bid is still the item's asking price exactly.
            </p>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-2"
            variant="primary"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating Room...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Create Room
              </>
            )}
          </Button>
        </form>
      </div>
    </PageContainer>
  );
}
