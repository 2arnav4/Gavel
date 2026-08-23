import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, LogIn, AlertCircle } from "lucide-react";
import { BackButton } from "../components/ui/BackButton";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { joinRoom } from "../services/api";
import { useSessionStore } from "../stores/useSessionStore";
import { getErrorMessage } from "../utils/error";

export function JoinRoomPage() {
  const navigate = useNavigate();
  const authUser = useSessionStore((state) => state.authUser);
  const setSession = useSessionStore((state) => state.setSession);

  const username = authUser?.username ?? "";
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authUser) {
      navigate("/");
    }
  }, [authUser, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !roomCode.trim()) {
      setError("Both username and room code are required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await joinRoom(roomCode.trim(), username.trim());
      setSession({
        roomCode: data.room.code,
        sessionToken: data.sessionToken,
        username: data.participant.username,
        participantId: data.participant._id,
        role: data.participant.role,
      });
      navigate(`/lobby/${data.room.code}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Something went wrong while joining the room."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer className="px-4 py-12 sm:px-6 sm:py-16">
      <PageHeader
        title="Join Existing Room"
        description="Enter a room code and your username to participate in a live auction."
      >
        <BackButton />
      </PageHeader>

      <div className="mx-auto max-w-md w-full mt-8">
        <form
          onSubmit={handleSubmit}
          className="border border-border bg-surface-raised/40 backdrop-blur-md p-6 rounded-xl space-y-6 shadow-xl"
        >
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="roomCode"
              className="text-xs font-semibold uppercase tracking-wider text-text-secondary"
            >
              Room Code
            </label>
            <input
              id="roomCode"
              type="text"
              required
              placeholder="e.g. ABC123"
              maxLength={6}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/20 rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all outline-none uppercase font-mono tracking-wider"
              disabled={loading}
            />
          </div>

          {/* Identity comes from the session, so it is stated rather than asked for. */}
          <div className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-surface-overlay/40 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
              {username.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-text-muted">Bidding as</p>
              <p className="truncate text-sm font-medium text-text-primary">{username}</p>
            </div>
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
                Joining Room...
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                Join Room
              </>
            )}
          </Button>
        </form>
      </div>
    </PageContainer>
  );
}
