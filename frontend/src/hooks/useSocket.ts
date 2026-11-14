import { useCallback, useEffect, useRef, useState } from "react";
import { connectSocket, isFatalSocketError } from "../services/socket";
import { useSessionStore } from "../stores/useSessionStore";
import { getRoomParticipants, type AuctionItem, type Bid, type Participant, type Room } from "../services/api";

const RESYNC_TIMEOUT_MS = 5_000;

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

function upsertParticipants(current: Participant[], incoming: Participant[]): Participant[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((participant) => [participant._id, participant]));
  for (const participant of incoming) {
    const existing = byId.get(participant._id);
    byId.set(participant._id, existing ? { ...existing, ...participant } : participant);
  }
  return [...byId.values()];
}

type PresenceChanged = {
  participantCount: number;
  onlineCount: number;
  joined: Participant[];
  left: string[];
};

function mergeItems(current: AuctionItem[], incoming: AuctionItem[]): AuctionItem[] {
  const byId = new Map(current.map((item) => [item._id, item]));
  for (const item of incoming) byId.set(item._id, item);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useSocket(roomCode: string) {
  const sessionToken = useSessionStore((state) => state.sessionToken);
  const hasSession = Boolean(roomCode && sessionToken);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rosterTotals, setRosterTotals] = useState<{ participantCount: number; onlineCount: number } | null>(null);
  const [participantsTruncated, setParticipantsTruncated] = useState(false);
  const [rosterCursor, setRosterCursor] = useState<string | null>(null);
  const [rosterExhausted, setRosterExhausted] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [activeItem, setActiveItem] = useState<AuctionItem | null>(null);
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [bids, setBids] = useState<Bid[]>([]);
  const [bidError, setBidError] = useState<{ code?: string; reason: string; minimumBid?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heldVersion = useRef<{ itemId: string | null; version: number | null }>({ itemId: null, version: null });
  const resyncPending = useRef(false);
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomCode || !sessionToken) return;

    const socket = connectSocket(roomCode, sessionToken);

    const settleResync = () => {
      resyncPending.current = false;
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
      resyncTimer.current = null;
    };
    const requestState = () => {
      resyncPending.current = true;
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
      resyncTimer.current = setTimeout(settleResync, RESYNC_TIMEOUT_MS);
      socket.emit("room:connect");
    };
    const resync = () => {
      if (!resyncPending.current) requestState();
    };
    const holdItem = (item: AuctionItem | null | undefined, version?: number) => {
      heldVersion.current = item
        ? { itemId: item._id, version: typeof version === "number" ? version : item.version ?? null }
        : { itemId: null, version: null };
    };
    const admit = (itemId: string | undefined, version: number | undefined): boolean => {
      if (!itemId || typeof version !== "number") return true;
      const held = heldVersion.current;
      if (held.itemId !== itemId) {
        resync();
        return false;
      }
      if (held.version !== null) {
        if (version <= held.version) return false;
        if (version > held.version + 1) {
          resync();
          return false;
        }
      }
      heldVersion.current = { itemId, version };
      return true;
    };

    const handleConnect = () => {
      setStatus("connected");
      setError(null);
      requestState();
    };
    const handleDisconnect = (reason: string) => {
      const willRetry = reason !== "io client disconnect" && reason !== "io server disconnect";
      setStatus(willRetry ? "reconnecting" : "disconnected");
    };
    const handleConnectError = (connectionError: Error) => {
      const message = connectionError.message || "Failed to connect to the realtime server.";

      if (isFatalSocketError(message)) {
        socket.disconnect();
        setStatus("disconnected");
        setError(message);
        return;
      }

      setStatus((current) => (current === "connecting" ? "connecting" : "reconnecting"));
    };
    const handleRoomState = (data: {
      room: Room;
      participants: Participant[];
      participantCount?: number;
      onlineCount?: number;
      participantsTruncated?: boolean;
      activeItem: AuctionItem | null;
      bids: Bid[];
      items: AuctionItem[];
      serverTime?: string;
    }) => {
      if (data.serverTime) setServerClockOffset(Date.parse(data.serverTime) - Date.now());
      settleResync();
      const held = heldVersion.current;
      const snapshotVersion = data.activeItem?.version;
      const snapshotIsStale = Boolean(data.activeItem)
        && held.itemId === data.activeItem?._id
        && held.version !== null
        && typeof snapshotVersion === "number"
        && snapshotVersion < held.version;
      if (snapshotIsStale) {
        setRoom((current) => current
          ? { ...data.room, endsAt: current.endsAt, isPaused: current.isPaused, pausedRemainingMs: current.pausedRemainingMs }
          : data.room);
      } else {
        holdItem(data.activeItem);
        setRoom(data.room);
      }
      setParticipants(data.participants);
      setParticipantsTruncated(Boolean(data.participantsTruncated));
      setRosterTotals(typeof data.participantCount === "number" && typeof data.onlineCount === "number"
        ? { participantCount: data.participantCount, onlineCount: data.onlineCount }
        : null);
      setRosterCursor(null);
      setRosterExhausted(!data.participantsTruncated);
      if (!snapshotIsStale) {
        setActiveItem(data.activeItem);
        setBids(data.bids);
      }
      setItems((current) => mergeItems(current, data.items));
    };
    const handleParticipantJoined = (data: { participant: Participant }) => {
      setParticipants((current) => {
        const wasOnline = current.some((participant) => participant._id === data.participant._id && participant.isConnected);
        const isNew = !current.some((participant) => participant._id === data.participant._id);
        if (!wasOnline) {
          setRosterTotals((totals) => totals
            ? {
                participantCount: totals.participantCount + (isNew ? 1 : 0),
                onlineCount: totals.onlineCount + 1,
              }
            : totals);
        }
        const exists = current.some((participant) => participant._id === data.participant._id);
        return exists
          ? current.map((participant) => participant._id === data.participant._id
            ? { ...participant, isConnected: true }
            : participant)
          : [...current, data.participant];
      });
    };
    const handleParticipantLeft = (data: { participant: Participant }) => {
      setParticipants((current) => {
        if (current.some((participant) => participant._id === data.participant._id && participant.isConnected)) {
          setRosterTotals((totals) => totals
            ? { ...totals, onlineCount: Math.max(0, totals.onlineCount - 1) }
            : totals);
        }
        return current.map((participant) => participant._id === data.participant._id
          ? { ...participant, isConnected: false }
          : participant);
      });
    };
    const handlePresenceChanged = (data: PresenceChanged) => {
      setRosterTotals({ participantCount: data.participantCount, onlineCount: data.onlineCount });
      const leftIds = new Set(data.left);
      setParticipants((current) => {
        const known = new Set(current.map((participant) => participant._id));
        const updates = data.joined.filter((participant) => known.has(participant._id) || current.length < 200);
        return upsertParticipants(current, updates.map((participant) => ({ ...participant, isConnected: true })))
          .map((participant) => leftIds.has(participant._id) ? { ...participant, isConnected: false } : participant);
      });
    };
    const handleServerError = () => {
      if (resyncPending.current) settleResync();
    };
    const handleItemAdded = (data: { item: AuctionItem }) => {
      setItems((current) => mergeItems(current, [data.item]));
    };
    const handleAuctionStarted = (data: { room: Room }) => setRoom(data.room);
    const handleItemActivated = (data: { item: AuctionItem; startedAt: string; endsAt: string; version?: number }) => {
      holdItem(data.item, data.version);
      setActiveItem(data.item);
      setServerClockOffset(Date.parse(data.startedAt) - Date.now());
      setBids([]);
      setBidError(null);
      setRoom((current) => current ? { ...current, status: "live", endsAt: data.endsAt } : current);
    };
    const handleBidAccepted = (data: { bid: Bid; item: AuctionItem; duplicate?: boolean; version?: number }) => {
      if (data.duplicate) {
        setBidError(null);
        return;
      }
      if (!admit(data.item?._id, data.version)) return;
      setActiveItem(data.item);
      setBids((current) => current.some((bid) => bid._id === data.bid._id) ? current : [data.bid, ...current]);
      setBidError(null);
      if (data.item.endsAt) {
        setRoom((current) => current ? { ...current, endsAt: data.item.endsAt } : current);
      }
    };
    const handleBidRejected = (data: { code?: string; reason: string; minimumBid?: number }) => setBidError(data);
    const handleAuctionPaused = (data: { itemId: string; remainingMs: number; version?: number }) => {
      if (!admit(data.itemId, data.version)) return;
      setActiveItem((current) => current ? { ...current, isPaused: true, endsAt: null } : current);
      setRoom((current) => current
        ? { ...current, isPaused: true, pausedRemainingMs: data.remainingMs, endsAt: null }
        : current);
    };
    const handleAuctionResumed = (data: { item: AuctionItem; endsAt: string; serverTime?: string; version?: number }) => {
      if (!admit(data.item?._id, data.version)) return;
      if (data.serverTime) setServerClockOffset(Date.parse(data.serverTime) - Date.now());
      setActiveItem(data.item);
      setRoom((current) => current
        ? { ...current, isPaused: false, pausedRemainingMs: null, endsAt: data.endsAt }
        : current);
      setBidError(null);
    };
    const handleItemEnded = (data: { item?: AuctionItem; winner?: Participant | null; version?: number }) => {
      if (!admit(data?.item?._id, data?.version)) return;
      if (data?.winner) {
        const winner = data.winner;
        setParticipants((current) => upsertParticipants(current, [winner]));
      }
      setActiveItem(null);
      setBids([]);
      setBidError(null);
    };
    const handleAuctionCompleted = (data: { room: Room }) => {
      setRoom(data.room);
      setActiveItem(null);
      setBids([]);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("room:state", handleRoomState);
    socket.on("participant:joined", handleParticipantJoined);
    socket.on("participant:left", handleParticipantLeft);
    socket.on("presence:changed", handlePresenceChanged);
    socket.on("error", handleServerError);
    socket.on("item:added", handleItemAdded);
    socket.on("auction:started", handleAuctionStarted);
    socket.on("item:activated", handleItemActivated);
    socket.on("bid:accepted", handleBidAccepted);
    socket.on("bid:rejected", handleBidRejected);
    socket.on("auction:paused", handleAuctionPaused);
    socket.on("auction:resumed", handleAuctionResumed);
    socket.on("item:ended", handleItemEnded);
    socket.on("auction:completed", handleAuctionCompleted);

    if (socket.connected) handleConnect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room:state", handleRoomState);
      socket.off("participant:joined", handleParticipantJoined);
      socket.off("participant:left", handleParticipantLeft);
      socket.off("presence:changed", handlePresenceChanged);
      socket.off("error", handleServerError);
      settleResync();
      socket.off("item:added", handleItemAdded);
      socket.off("auction:started", handleAuctionStarted);
      socket.off("item:activated", handleItemActivated);
      socket.off("bid:accepted", handleBidAccepted);
      socket.off("bid:rejected", handleBidRejected);
      socket.off("auction:paused", handleAuctionPaused);
      socket.off("auction:resumed", handleAuctionResumed);
      socket.off("item:ended", handleItemEnded);
      socket.off("auction:completed", handleAuctionCompleted);

    };
  }, [roomCode, sessionToken]);

  const loadMoreParticipants = useCallback(async () => {
    if (!roomCode || rosterLoading || rosterExhausted) return;
    setRosterLoading(true);
    try {
      const page = await getRoomParticipants(roomCode, rosterCursor);
      setParticipants((current) => {
        const live = new Map(current.map((participant) => [participant._id, participant.isConnected]));
        return upsertParticipants(current, page.participants.map((participant) =>
          live.has(participant._id) ? { ...participant, isConnected: live.get(participant._id)! } : participant));
      });
      setRosterCursor(page.nextCursor);
      setRosterExhausted(page.nextCursor === null);
    } finally {
      setRosterLoading(false);
    }
  }, [roomCode, rosterCursor, rosterExhausted, rosterLoading]);

  const participantCount = rosterTotals?.participantCount ?? participants.length;
  const onlineCount = rosterTotals?.onlineCount
    ?? participants.filter((participant) => participant.isConnected).length;

  return {
    status: hasSession ? status : "disconnected",
    room,
    participants,
    participantCount,
    onlineCount,
    participantsTruncated,
    hasMoreParticipants: participantsTruncated && !rosterExhausted,
    rosterLoading,
    loadMoreParticipants,
    items,
    activeItem,
    serverClockOffset,
    bids,
    bidError,
    setBidError,
    error: hasSession ? error : "Active session not found. Cannot connect to socket.",
  };
}
