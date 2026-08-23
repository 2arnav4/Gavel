import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Clock,
  Crown,
  Pause,
  Play,
  Users,
  AlertCircle,
  Tag,
  MessageSquare,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { PageContainer } from "../../components/ui/PageContainer";
import { Button } from "../../components/ui/Button";
import { useSessionStore } from "../../stores/useSessionStore";
import { useSocket } from "../../hooks/useSocket";
import { disconnectSocket, getSocket } from "../../services/socket";
import type { AuctionItem, Bid } from "../../services/api";

interface ToastMsg {
  id: string;
  message: string;
  type: "info" | "success" | "error";
}

/**
 * The smallest legal bid right now.
 *
 * Mirrors getMinimumBid on the server: the opening bid is the asking price
 * exactly, and every raise after that must clear the room's increment. Kept
 * identical so the UI never offers an amount the server would reject.
 */
function getMinimumBid(startingBid: number, currentBid: number, increment: number): number {
  return currentBid > 0 ? currentBid + increment : startingBid;
}

export function AuctionPage() {
  // Room codes are stored uppercase, so a lowercase URL must not read as a
  // different room and lock out a session that is actually valid.
  const { code: rawCode } = useParams<{ code: string }>();
  const code = rawCode?.toUpperCase();
  const navigate = useNavigate();

  const {
    roomCode: sessionRoomCode,
    username: sessionUsername,
    role: sessionRole,
    participantId: sessionParticipantId,
    clearRoomSession,
  } = useSessionStore();

  // Connect to Socket.IO to track live bidding item, presence, and bids history
  const {
    status: socketStatus,
    room,
    participants,
    activeItem,
    serverClockOffset,
    bids,
    bidError,
    setBidError,
    error: socketError,
  } = useSocket(code || "");

  const [bidVal, setBidVal] = useState("");
  const [localBidErr, setLocalBidErr] = useState<string | null>(null);
  
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const addToast = useCallback((message: string, type: "info" | "success" | "error" = "info") => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const minBidIncrement = room?.minBidIncrement ?? 1;
  // The opening bid may match the asking price exactly; every later bid must
  // clear the room's minimum raise.
  const minBidVal = activeItem
    ? getMinimumBid(activeItem.startingBid ?? 0, activeItem.currentBid ?? 0, minBidIncrement)
    : 1;
  // currentBid is zero until someone actually bids, so it is only a real price
  // once it is positive.
  const highestBid = activeItem && activeItem.currentBid > 0 ? activeItem.currentBid : null;

  // While paused there is no deadline to count down to, so the frozen remainder
  // is rendered instead of a live difference.
  const isPaused = Boolean(room?.isPaused);
  const endsAtMs = room?.endsAt ? Date.parse(room.endsAt) : Number.NaN;
  const secondsRemaining = isPaused
    ? Math.max(0, Math.ceil((room?.pausedRemainingMs ?? 0) / 1000))
    : Number.isFinite(endsAtMs)
      ? Math.max(0, Math.ceil((endsAtMs - (clockNow + serverClockOffset)) / 1000))
      : 0;
  const biddingOpen = Boolean(activeItem) && !isPaused && secondsRemaining > 0;

  const me = participants.find((participant) => participant._id === sessionParticipantId);
  const remainingBudget = me ? me.budget - me.spent : null;
  // A bidder whose purse cannot even cover the minimum is out of the running for
  // this item, which is worth saying plainly rather than letting them bid and be
  // rejected by the server.
  const canAffordMinimum = remainingBudget === null || remainingBudget >= minBidVal;

  // Preset raises stepped by the room's own increment, so every chip is a legal
  // bid by construction. Anything beyond the purse is dropped rather than shown
  // disabled: an unaffordable option is noise under a countdown.
  const quickBids = [
    { label: "Minimum", amount: minBidVal },
    { label: `+₹${minBidIncrement.toLocaleString()}`, amount: minBidVal + minBidIncrement },
    { label: `+₹${(minBidIncrement * 2).toLocaleString()}`, amount: minBidVal + minBidIncrement * 2 },
    { label: `+₹${(minBidIncrement * 5).toLocaleString()}`, amount: minBidVal + minBidIncrement * 5 },
  ].filter((quick) => remainingBudget === null || quick.amount <= remainingBudget);

  if (remainingBudget !== null && canAffordMinimum && !quickBids.some((q) => q.amount === remainingBudget)) {
    quickBids.push({ label: "All in", amount: remainingBudget });
  }

  useEffect(() => {
    if (!Number.isFinite(endsAtMs)) return;
    const interval = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [endsAtMs]);

  // Listen to live events for broadcast logs and toast notifications
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleItemEnded = (data: { item: AuctionItem; resolution: "sold" | "unsold" }) => {
      const username = data.item.highestBidderUsername || "none";
      const price = data.item.currentBid || data.item.startingBid;
      const formattedMsg = data.resolution === "sold"
        ? `${data.item.name} sold to ${username} for ₹${price.toLocaleString()}`
        : `${data.item.name} marked unsold`;

      setActivityLogs((prev) => [...prev, `✦ ${formattedMsg}`]);
      addToast(formattedMsg, "info");
    };

    const handleItemActivated = (data: { item: AuctionItem }) => {
      const msg = `Item ${data.item.name} is active. Minimum bid: ₹${(data.item.currentBid || data.item.startingBid).toLocaleString()}`;
      setActivityLogs((prev) => [...prev, `✦ ${msg}`]);
      addToast(`New item active: ${data.item.name}`, "info");
      setLocalBidErr(null);
      setBidVal("");
    };

    const handleBidAccepted = (data: { bid: Bid }) => {
      const msg = `Bid of ₹${data.bid.amount.toLocaleString()} accepted for ${data.bid.username}`;
      setActivityLogs((prev) => [...prev, `✔ ${msg}.`]);
      addToast(`New bid: ₹${data.bid.amount.toLocaleString()} by ${data.bid.username}`, "success");
    };

    const handleBidRejected = (data: { reason: string; minimumBid: number }) => {
      addToast(data.reason, "error");
    };

    const handleServerError = (data: { message: string }) => addToast(data.message, "error");

    socket.on("item:ended", handleItemEnded);
    socket.on("item:activated", handleItemActivated);
    socket.on("bid:accepted", handleBidAccepted);
    socket.on("bid:rejected", handleBidRejected);
    socket.on("error", handleServerError);

    return () => {
      socket.off("item:ended", handleItemEnded);
      socket.off("item:activated", handleItemActivated);
      socket.off("bid:accepted", handleBidAccepted);
      socket.off("bid:rejected", handleBidRejected);
      socket.off("error", handleServerError);
    };
    // socketStatus is a dependency because getSocket() returns null until the
    // connection has been created; without it these listeners would never attach
    // on a first render that beat the socket into existence.
  }, [addToast, socketStatus]);

  // Security check: Redirect if the user has no session or is in the wrong room
  const hasNoAccess = !sessionUsername || !sessionRole || sessionRoomCode !== code;

  // Automatically navigate to results page when room transitions to completed status
  useEffect(() => {
    if (room?.status === "completed" && code) {
      navigate(`/results/${code}`);
    }
  }, [room?.status, code, navigate]);

  const handleLeaveRoom = () => {
    // Leaving a room ends the room membership only. Clearing the whole session
    // would also sign the user out while their auth cookie stayed set, so the
    // next reload would silently sign them back in.
    disconnectSocket();
    clearRoomSession();
    navigate("/");
  };

  // Submit new bid (Participants only)
  const handleSubmitBid = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem) return;

    if (!bidVal.trim()) {
      setLocalBidErr("Enter an amount, or tap one of the presets above.");
      return;
    }

    const bidAmount = Number(bidVal);

    if (!Number.isFinite(bidAmount) || bidAmount < minBidVal) {
      setLocalBidErr(`Bid must be at least ₹${minBidVal.toLocaleString()}.`);
      return;
    }

    if (remainingBudget !== null && bidAmount > remainingBudget) {
      setLocalBidErr(`That exceeds your remaining purse of ₹${remainingBudget.toLocaleString()}.`);
      return;
    }

    setLocalBidErr(null);
    setBidError(null);

    const socket = getSocket();
    if (socket) {
      socket.emit("bid:place", { amount: bidAmount });
    }
    setBidVal(""); // Reset input field
  };

  // Sell active item (Admin only)
  const handleSellItem = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit("item:sell");
    }
  };

  // Mark active item unsold (Admin only)
  const handleMarkUnsold = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit("item:unsold");
    }
  };

  // Freeze or restore the countdown (Admin only)
  const handleTogglePause = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit(isPaused ? "auction:resume" : "auction:pause");
    }
  };

  // Checked before the connection states: without a session token the socket can
  // never connect, so reporting a connection failure would send the user to a
  // dead end instead of to the join screen that actually fixes it.
  if (hasNoAccess) {
    return (
      <PageContainer className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="border border-border bg-surface-raised/40 p-8 rounded-xl text-center max-w-md mx-auto space-y-6 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Users className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">Access Denied</h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              You are trying to access room <span className="font-mono text-accent font-semibold">{code}</span> but do not have an active session. Please register to join.
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate(`/join?code=${code}`)} className="w-full">
            Join Room
          </Button>
        </div>
      </PageContainer>
    );
  }

  const isLoading = !room && socketStatus === "connecting";

  if (isLoading) {
    return (
      <PageContainer className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex h-12 w-12 items-center justify-center">
            <div className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/20 opacity-75" />
            <div className="relative rounded-full h-8 w-8 bg-accent/20 flex items-center justify-center">
              <Clock className="h-4 w-4 text-accent animate-spin" />
            </div>
          </div>
          <p className="text-sm text-text-secondary">Establishing live auction connection...</p>
        </div>
      </PageContainer>
    );
  }

  if (socketError || (!room && socketStatus === "disconnected")) {
    return (
      <PageContainer className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="border border-border bg-surface-raised/40 p-8 rounded-xl text-center max-w-md mx-auto space-y-6 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertCircle className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">Realtime Connection Failed</h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              {socketError ?? "Failed to connect to the live auction room. Check if the server is running."}
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate("/")} className="w-full">
            Back to Home
          </Button>
        </div>
      </PageContainer>
    );
  }

  const isAdmin = sessionRole === "admin";
  // The host runs the auction rather than bidding in it, so listing them here
  // would misrepresent who you are actually competing against.
  const bidders = participants.filter((participant) => participant.role !== "admin");

  return (
    <PageContainer className="px-4 py-12 sm:px-6 sm:py-16 max-w-5xl">
      <div className="space-y-8">
        
        {/* Connection status header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mr-2">
                LIVE AUCTION
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isPaused ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : secondsRemaining <= 10 ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-accent/30 bg-accent/10 text-accent"}`}>
                <Clock className="h-3 w-3" />
                {secondsRemaining}s
              </span>
              {isPaused && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  <Pause className="h-3 w-3" />
                  Paused
                </span>
              )}
              {socketStatus === "connected" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  Synced
                </span>
              )}
              {socketStatus === "connecting" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Reconnecting...
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
              {room?.name}
            </h1>
          </div>

          <Button
            variant="ghost"
            onClick={handleLeaveRoom}
            className="self-start sm:self-center border border-border/50 text-xs text-text-secondary hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20"
          >
            Leave Room
          </Button>
        </div>

        {/* Host Control center resolving controls (Visible to Admin only) */}
        {isAdmin && activeItem && (
          <div className="border border-amber-500/20 bg-amber-500/5 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
            <div className="space-y-1 text-center sm:text-left">
              <h3 className="text-sm font-semibold text-amber-400 flex items-center justify-center sm:justify-start gap-1.5">
                <Crown className="h-4 w-4" />
                Host Resolution Console
              </h3>
              <p className="text-xs text-text-secondary">
                {isPaused
                  ? "Bidding is frozen. Resume to restore the countdown from where it stopped."
                  : "Pause to freeze the clock, or resolve the item. The next pending item activates automatically."}
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                onClick={handleTogglePause}
                variant="secondary"
                className={`flex-1 sm:flex-initial text-xs border ${isPaused ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" : "border-border/50"}`}
              >
                {isPaused ? (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </>
                )}
              </Button>
              <Button
                onClick={handleSellItem}
                variant="primary"
                className="flex-1 sm:flex-initial bg-green-500 hover:bg-green-600 border-green-500/20 text-zinc-950 font-bold text-xs"
              >
                Sell Item (₹{(highestBid ?? activeItem.startingBid ?? 0).toLocaleString()})
              </Button>
              <Button
                onClick={handleMarkUnsold}
                variant="secondary"
                className="flex-1 sm:flex-initial text-xs border border-border/50"
              >
                Mark Unsold
              </Button>
            </div>
          </div>
        )}

        {/* Live Auction Board Layout */}
        <div className="grid gap-6 md:grid-cols-3 items-start">
          
          {/* Active Item Container (2/3 width) */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Current Item Presentation */}
            <div className="border border-border bg-surface-raised/40 p-6 rounded-xl space-y-6 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 h-32 w-32 rounded-full bg-accent/5 blur-[30px] pointer-events-none" />
              
              <div className="flex items-center justify-between border-b border-border/40 pb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2">
                  <Tag className="h-4 w-4 text-accent" />
                  Active Auction Item
                </span>
                {biddingOpen && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-400 bg-green-500/15 border border-green-500/30 px-2.5 py-0.5 rounded-full">
                    Bidding Open
                  </span>
                )}
                {activeItem && isPaused && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
                    Bidding Paused
                  </span>
                )}
              </div>

              {!activeItem ? (
                <div className="py-12 text-center space-y-3">
                  <Clock className="h-10 w-10 text-text-muted mx-auto animate-pulse" />
                  <h3 className="text-base font-semibold text-text-primary">Waiting for item activation...</h3>
                  <p className="text-xs text-text-secondary max-w-sm mx-auto">
                    The host is resolving items. Bidding will open immediately once the next item activates.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-text-primary tracking-tight">
                      {activeItem.name}
                    </h2>
                    {activeItem.description ? (
                      <p className="text-sm text-text-secondary leading-relaxed">
                        {activeItem.description}
                      </p>
                    ) : (
                      <p className="text-xs text-text-muted italic">No item details provided.</p>
                    )}
                  </div>

                  {/* Pricing Box */}
                  <div className="grid grid-cols-2 gap-4 bg-surface-overlay/60 border border-border/50 p-5 rounded-lg">
                    <div>
                      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">
                        Starting Price
                      </span>
                      <span className="text-2xl font-bold text-text-primary tracking-tight tabular-nums">
                        ₹{(activeItem.startingBid ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="border-l border-border/40 pl-4">
                      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">
                        {highestBid ? "Highest Bid" : "No Bids Yet"}
                      </span>
                      <span className="text-3xl font-bold text-accent tracking-tight tabular-nums">
                        ₹{(highestBid ?? activeItem.startingBid ?? 0).toLocaleString()}
                      </span>
                      {activeItem.highestBidderUsername ? (
                        <span className="text-[11px] font-semibold text-green-400 block mt-1 truncate">
                          {activeItem.highestBidderUsername === sessionUsername
                            ? "You are leading"
                            : `Leading: ${activeItem.highestBidderUsername}`}
                        </span>
                      ) : (
                        <span className="text-[11px] text-text-muted block mt-1">
                          Opens at the starting price
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bidding Placement input Box (Visible to Bidders only) */}
            {!isAdmin && activeItem && isPaused && (
              <div className="border border-amber-500/20 bg-amber-500/5 p-6 rounded-xl flex items-center gap-3 shadow-lg">
                <Pause className="h-5 w-5 text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-400">Bidding paused by the host</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    The clock is frozen at {secondsRemaining}s. Bidding reopens the moment the host resumes.
                  </p>
                </div>
              </div>
            )}

            {!isAdmin && biddingOpen && (
              <div className="border border-border bg-surface-raised/40 p-6 rounded-xl space-y-4 shadow-lg">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2 border-b border-border/40 pb-3">
                  <DollarSign className="h-4 w-4 text-accent" />
                  Place Bid
                </span>

                {/* noValidate: the browser's own tooltip for `min` is an
                    unstyled native popup that appears on submit and cannot be
                    themed. All validation is ours, rendered inline. */}
                <form onSubmit={handleSubmitBid} className="space-y-4" noValidate>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border/50 bg-surface-overlay/40 px-3 py-2">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        {highestBid ? `Minimum bid (+₹${minBidIncrement.toLocaleString()})` : "Minimum bid"}
                      </span>
                      <span className="text-lg font-bold tabular-nums text-text-primary">
                        ₹{minBidVal.toLocaleString()}
                      </span>
                    </div>
                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        canAffordMinimum
                          ? "border-border/50 bg-surface-overlay/40"
                          : "border-red-500/30 bg-red-500/10"
                      }`}
                    >
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        Your purse
                      </span>
                      <span
                        className={`text-lg font-bold tabular-nums ${canAffordMinimum ? "text-green-400" : "text-red-400"}`}
                      >
                        ₹{(remainingBudget ?? 0).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {!canAffordMinimum && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <p>
                        Your remaining purse cannot cover the minimum bid on this item. You can still
                        compete for later items.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {quickBids.map((quick) => {
                      const isSelected = bidVal === String(quick.amount);
                      return (
                        <button
                          key={quick.label}
                          type="button"
                          onClick={() => {
                            setBidVal(String(quick.amount));
                            setLocalBidErr(null);
                            setBidError(null);
                          }}
                          className={`flex flex-col items-center rounded-lg border px-2 py-2 transition-all cursor-pointer ${
                            isSelected
                              ? "border-accent bg-accent/15 text-accent"
                              : "border-border/60 bg-surface-overlay/50 text-text-secondary hover:border-accent/40 hover:bg-accent/5 hover:text-text-primary"
                          }`}
                        >
                          <span className="text-[9px] font-medium uppercase tracking-wider opacity-70">
                            {quick.label}
                          </span>
                          <span className="text-sm font-bold tabular-nums">
                            ₹{quick.amount.toLocaleString()}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {(localBidErr || bidError) && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <p>{localBidErr || bidError?.reason}</p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-text-muted">₹</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={`Or type an amount (min ₹${minBidVal.toLocaleString()})`}
                        value={bidVal}
                        onChange={(e) => {
                          // Digits only. A minus sign can never reach state, so
                          // a negative bid is unreachable rather than rejected.
                          setBidVal(e.target.value.replace(/[^0-9]/g, ""));
                          setLocalBidErr(null);
                        }}
                        className="w-full bg-surface-overlay border border-border/80 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-lg pl-8 pr-4 py-2.5 text-sm tabular-nums text-text-primary placeholder:text-text-muted transition-all outline-none"
                      />
                    </div>
                    <Button type="submit" variant="primary" className="py-2.5 px-6 font-bold text-sm">
                      Submit Bid
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Sidebar Section (1/3 width) */}
          <div className="space-y-6">
            
            {/* Bid History list timeline */}
            <div className="border border-border bg-surface-raised/40 p-6 rounded-xl space-y-4 shadow-lg min-h-[220px] flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2 border-b border-border/40 pb-3">
                <TrendingUp className="h-4 w-4 text-accent" />
                Live Bids Log ({bids.length})
              </span>

              {bids.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 space-y-1.5 text-text-muted">
                  <DollarSign className="h-7 w-7 stroke-[1.5]" />
                  <p className="text-xs font-medium">No bids on this item yet</p>
                  <p className="text-[10px] leading-relaxed max-w-[190px]">
                    The log resets for each item. Bids appear here the instant the server accepts them.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[320px] pr-1">
                  {bids.map((b, index) => {
                    const isLeading = index === 0;
                    return (
                      <div
                        key={b._id}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                          isLeading
                            ? "border-accent/40 bg-accent/10"
                            : "border-border/30 bg-surface-overlay/40"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <div
                            className={`h-6 w-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                              isLeading ? "bg-accent text-white" : "bg-accent/10 text-accent"
                            }`}
                          >
                            {b.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="overflow-hidden">
                            <p className="font-semibold text-text-primary truncate leading-tight">
                              {b.username}
                              {b.username === sessionUsername && (
                                <span className="ml-1 text-[9px] text-text-muted">(You)</span>
                              )}
                            </p>
                            {isLeading && (
                              <p className="text-[9px] font-medium uppercase tracking-wider text-accent">
                                Leading
                              </p>
                            )}
                          </div>
                        </div>
                        <span
                          className={`font-bold tabular-nums shrink-0 ${isLeading ? "text-accent text-sm" : "text-text-secondary"}`}
                        >
                          ₹{b.amount.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bidders Connection Sidebar */}
            <div className="border border-border bg-surface-raised/40 p-6 rounded-xl space-y-4 shadow-lg flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2 border-b border-border/40 pb-3">
                <Users className="h-4 w-4 text-accent" />
                Bidders ({bidders.length})
              </span>

              <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-1">
                {bidders.length === 0 && (
                  <p className="py-4 text-center text-xs text-text-muted">
                    No bidders in this room yet.
                  </p>
                )}
                {bidders.map((p) => (
                  <div
                    key={p._id}
                    className="flex items-center justify-between bg-surface-overlay/20 border border-border/30 p-2.5 rounded-lg text-xs"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="h-5.5 w-5.5 rounded-full bg-surface-overlay border border-border flex items-center justify-center font-medium text-[9px] text-text-secondary shrink-0">
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="overflow-hidden">
                        <p className="font-semibold text-text-primary truncate leading-tight">
                          {p.username}
                          {p.username === sessionUsername && (
                            <span className="ml-1 text-[8px] text-text-muted">(You)</span>
                          )}
                        </p>
                        <p className="text-[10px] tabular-nums text-text-muted">
                          ₹{(p.budget - p.spent).toLocaleString()} left
                        </p>
                      </div>
                    </div>

                    {p.isConnected ? (
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                    ) : (
                      <span className="inline-flex h-2 w-2 rounded-full bg-zinc-500" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Notification logs panel */}
            <div className="border border-border bg-surface-raised/40 p-6 rounded-xl space-y-4 shadow-lg">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2 border-b border-border/40 pb-3">
                <MessageSquare className="h-4 w-4 text-accent" />
                Live Broadcasts
              </span>

              <div className="h-64 overflow-y-auto space-y-1.5 pr-1">
                {activityLogs.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center gap-1.5 text-text-muted">
                    <MessageSquare className="h-6 w-6 stroke-[1.5]" />
                    <p className="text-xs font-medium">Nothing has happened yet</p>
                    <p className="text-[10px] max-w-[190px] leading-relaxed">
                      Bids, item changes and results are announced here as they happen.
                    </p>
                  </div>
                ) : (
                  // Newest first: during a live auction the latest event is the
                  // one that matters, and scrolling to find it wastes the clock.
                  [...activityLogs].reverse().map((log, index) => {
                    const isSuccess = log.includes("✔");
                    return (
                      <p
                        key={activityLogs.length - index}
                        className={`rounded-md px-2 py-1.5 text-[11px] leading-snug ${
                          isSuccess
                            ? "bg-green-500/5 text-green-400"
                            : "bg-surface-overlay/40 text-text-secondary"
                        }`}
                      >
                        {log}
                      </p>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Floating Toast Notification Container */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl border bg-zinc-950/90 backdrop-blur-md shadow-2xl flex items-center gap-3 transition-all transform duration-300 ${
              toast.type === "error"
                ? "border-red-500/30 text-red-400"
                : toast.type === "success"
                ? "border-green-500/30 text-green-400"
                : "border-border text-text-primary"
            }`}
          >
            <span className="text-xs font-semibold">{toast.message}</span>
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
