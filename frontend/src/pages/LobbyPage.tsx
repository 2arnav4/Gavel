import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Copy,
  Check,
  LogOut,
  Clock,
  Users,
  Crown,
  AlertCircle,
  Tag,
  PlusCircle,
  FileText,
} from "lucide-react";
import { PageContainer } from "../components/ui/PageContainer";
import { Button } from "../components/ui/Button";
import { useSessionStore } from "../stores/useSessionStore";
import { useSocket } from "../hooks/useSocket";
import { addAuctionItem } from "../services/api";
import { disconnectSocket, getSocket } from "../services/socket";
import { getErrorMessage } from "../utils/error";

const ITEM_NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 300;

export function LobbyPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = rawCode?.toUpperCase();
  const navigate = useNavigate();

  const {
    roomCode: sessionRoomCode,
    username: sessionUsername,
    role: sessionRole,
    sessionToken,
    clearRoomSession,
  } = useSessionStore();

  const {
    status: socketStatus,
    room,
    participants,
    items,
    error: socketError,
  } = useSocket(code || "");

  const [copied, setCopied] = useState(false);

  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemBid, setItemBid] = useState("");
  const [itemLoading, setItemLoading] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemSuccess, setItemSuccess] = useState(false);

  const hasNoAccess = !sessionUsername || !sessionRole || sessionRoomCode !== code;

  const handleCopyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleLeaveRoom = () => {
    disconnectSocket();
    clearRoomSession();
    navigate("/");
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !sessionToken) return;

    if (!itemName.trim()) {
      setItemError("Item name is required.");
      return;
    }
    const bidAmount = Number(itemBid);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      setItemError("Starting bid must be positive.");
      return;
    }

    setItemLoading(true);
    setItemError(null);
    setItemSuccess(false);

    try {
      await addAuctionItem(
        code,
        sessionToken,
        itemName.trim(),
        itemDesc.trim(),
        bidAmount
      );

      setItemName("");
      setItemDesc("");
      setItemBid("");
      setItemSuccess(true);
      setTimeout(() => setItemSuccess(false), 3000);
    } catch (err: unknown) {
      setItemError(getErrorMessage(err, "Failed to add item."));
    } finally {
      setItemLoading(false);
    }
  };

  useEffect(() => {
    if (room?.status === "live" && code) {
      navigate(`/auction/${code}`);
    }
  }, [room?.status, code, navigate]);

  const handleStartAuction = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit("auction:start");
    }
  };

  if (hasNoAccess) {
    return (
      <PageContainer className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="border border-border bg-surface-raised/40 p-8 rounded-xl text-center max-w-md mx-auto space-y-6 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Users className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">Unauthorized Access</h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              You are trying to access room <span className="font-mono text-accent font-semibold">{code}</span> but do not have an active session. Please join the room with a username to proceed.
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
          <p className="text-sm text-text-secondary">Establishing realtime server connection...</p>
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
              {socketError ?? "Failed to connect to the realtime lobby server. Check if the server is running."}
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
  const bidders = participants.filter((participant) => participant.role !== "admin");

  return (
    <PageContainer className="px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-4xl w-full space-y-8">

        {}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {socketStatus === "connected" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  Realtime Synced
                </span>
              )}
              {socketStatus === "connecting" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Reconnecting...
                </span>
              )}
              {socketStatus === "disconnected" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-red-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Offline
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
            <LogOut className="h-3.5 w-3.5" />
            Leave Lobby
          </Button>
        </div>

        {}
        {isAdmin && (
          <div className="border border-amber-500/20 bg-amber-500/5 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm animate-fade-in-up">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-1.5">
                <Crown className="h-4 w-4" />
                Host Control Center
              </h3>
              <p className="text-xs text-text-secondary">
                Prepare your catalog. Once participants have joined, click the button to launch the live auction timer.
              </p>
            </div>
            <Button
              onClick={handleStartAuction}
              disabled={items.length === 0}
              variant="primary"
              className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.15)] text-zinc-950 font-bold cursor-pointer"
            >
              Start Live Auction
            </Button>
          </div>
        )}

        {}
        <div className="grid gap-6 sm:grid-cols-5">
          {}
          <div className="sm:col-span-3 border border-border bg-surface-raised/40 backdrop-blur-md p-6 rounded-xl space-y-6 flex flex-col justify-between shadow-lg">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Invite Code
                </span>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {room?.startingBudget != null && (
                    <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                      ₹{room.startingBudget.toLocaleString()} purse each
                    </span>
                  )}
                  {room?.minBidIncrement != null && (
                    <span className="rounded-full border border-border bg-surface-overlay px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-text-secondary">
                      ₹{room.minBidIncrement.toLocaleString()} min raise
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                Share this code with other users to let them join this room in realtime.
              </p>
            </div>

            <div className="flex items-center gap-2 bg-surface-overlay/80 border border-border/60 p-3 rounded-lg font-mono">
              <span className="text-2xl font-bold tracking-widest text-text-primary flex-1 text-center">
                {code}
              </span>
              <button
                onClick={handleCopyCode}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-raised transition-all hover:bg-surface-overlay hover:border-accent"
                title="Copy code"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4 text-text-secondary" />
                )}
              </button>
            </div>
          </div>

          {}
          <div className="sm:col-span-2 border border-border bg-surface-raised/40 backdrop-blur-md p-6 rounded-xl space-y-6 flex flex-col justify-between shadow-lg">
            <div className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Your Connection
              </span>
              <p className="text-sm text-text-secondary leading-relaxed">
                Your active profile in this bidding room.
              </p>
            </div>

            <div className="space-y-3 bg-surface-overlay/40 border border-border/40 p-4 rounded-lg">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-sm">
                  {sessionUsername?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 overflow-hidden">
                  <h4 className="text-sm font-semibold text-text-primary truncate">
                    {sessionUsername}
                  </h4>
                  <p className="text-xs text-text-muted truncate">Realtime Active</p>
                </div>
              </div>

              <div className="border-t border-border/30 pt-2.5 flex items-center justify-between">
                <span className="text-xs text-text-muted">Role</span>
                {sessionRole === "admin" ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                    <Crown className="h-3 w-3" />
                    Room Host
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full">
                    <Users className="h-3 w-3" />
                    Bidder
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {}
        <div className="grid gap-6 md:grid-cols-5 items-start">

          {}
          <div className={`${isAdmin ? "md:col-span-3" : "md:col-span-5"} border border-border bg-surface-raised/40 p-6 rounded-xl space-y-4 shadow-lg min-h-[300px] flex flex-col`}>
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2 border-b border-border/40 pb-3">
              <Tag className="h-4 w-4 text-accent" />
              Upcoming Auction Items ({items.length})
            </span>

            {items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-2">
                <FileText className="h-8 w-8 text-text-muted stroke-[1.5]" />
                <p className="text-sm font-medium text-text-secondary">No items added yet</p>
                <p className="text-xs text-text-muted leading-relaxed max-w-xs">
                  {isAdmin
                    ? "Add items on the side panel to prepare the auction list."
                    : "The host is preparing the catalog. Items added will appear here instantly."}
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {items.map((item) => (
                  <div
                    key={item._id}
                    className="border border-border/50 bg-surface-overlay/50 p-4 rounded-lg flex justify-between items-start gap-4 transition-all hover:border-accent/30"
                  >
                    <div className="space-y-1 overflow-hidden">
                      <h4 className="text-sm font-semibold text-text-primary truncate">
                        {item.name}
                      </h4>
                      {item.description ? (
                        <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 break-words">
                          {item.description}
                        </p>
                      ) : (
                        <p className="text-xs text-text-muted italic">No description provided</p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="text-xs text-text-muted block">Base Bid</span>
                      <span className="text-sm font-bold text-accent">
                        ₹{item.startingBid.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {}
          {isAdmin && (
            <div className="md:col-span-2 border border-border bg-surface-raised/40 p-6 rounded-xl space-y-4 shadow-lg">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2 border-b border-border/40 pb-3">
                <PlusCircle className="h-4 w-4 text-accent" />
                Add Auction Item
              </span>

              {}
              <form onSubmit={handleAddItem} className="space-y-4" noValidate>
                {itemError && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{itemError}</p>
                  </div>
                )}
                {itemSuccess && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-400">
                    <Check className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>Item added and synchronized successfully!</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="itemName" className="text-xs font-medium text-text-secondary">
                    Item Name
                  </label>
                  <input
                    id="itemName"
                    type="text"
                    maxLength={ITEM_NAME_MAX_LENGTH}
                    placeholder="e.g. MS Dhoni Signed Bat"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted transition-all outline-none"
                    disabled={itemLoading}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="itemBid" className="text-xs font-medium text-text-secondary">
                    Starting Bid (₹)
                  </label>
                  <input
                    id="itemBid"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 500"
                    value={itemBid}
                    onChange={(e) => setItemBid(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted transition-all outline-none"
                    disabled={itemLoading}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="itemDesc" className="text-xs font-medium text-text-secondary">
                      Description (Optional)
                    </label>
                    <span
                      className={`text-[10px] tabular-nums ${itemDesc.length >= DESCRIPTION_MAX_LENGTH ? "text-amber-400" : "text-text-muted"}`}
                    >
                      {itemDesc.length}/{DESCRIPTION_MAX_LENGTH}
                    </span>
                  </div>
                  <textarea
                    id="itemDesc"
                    placeholder="e.g. Match-worn and signed collectibles."
                    rows={3}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    value={itemDesc}
                    onChange={(e) => setItemDesc(e.target.value)}
                    className="w-full bg-surface-overlay border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted transition-all outline-none resize-none break-words"
                    disabled={itemLoading}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={itemLoading}
                  className="w-full text-xs py-2"
                  variant="primary"
                >
                  {itemLoading ? (
                    <>
                      <Clock className="h-3.5 w-3.5 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="h-3.5 w-3.5" />
                      Register Item
                    </>
                  )}
                </Button>
              </form>
            </div>
          )}
        </div>

        {}
        <div className="border border-border bg-surface-raised/35 p-6 rounded-xl space-y-4 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-2 border-b border-border/40 pb-3">
            <Users className="h-3.5 w-3.5 text-accent" />
            Lobby Bidders ({bidders.length})
          </span>

          {bidders.length === 0 && (
            <div className="py-8 text-center space-y-1">
              <p className="text-sm font-medium text-text-secondary">No bidders have joined yet</p>
              <p className="text-xs text-text-muted">
                Share the room code above and they will appear here instantly.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {bidders.map((p) => (
              <div
                key={p._id}
                className="flex items-center justify-between bg-surface-overlay/40 border border-border/50 p-3 rounded-lg"
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-overlay border border-border text-xs text-text-secondary font-medium">
                    {p.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {p.username}
                      {p.username === sessionUsername && (
                        <span className="ml-1 text-[10px] text-text-muted">(You)</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] tabular-nums text-text-muted">
                        ₹{(p.budget - p.spent).toLocaleString()} purse
                      </span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  {p.isConnected ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400 border border-green-500/20">
                      <span className="h-1 w-1 rounded-full bg-green-500" />
                      Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium text-text-muted border border-border">
                      <span className="h-1 w-1 rounded-full bg-text-muted/45" />
                      Offline
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
