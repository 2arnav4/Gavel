import { useEffect, useRef, useState } from "react";
import { connectSocket, isFatalSocketError } from "../services/socket";
import { useSessionStore } from "../stores/useSessionStore";
import type { AuctionItem, Bid, Participant, Room } from "../services/api";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

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
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [activeItem, setActiveItem] = useState<AuctionItem | null>(null);
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [bids, setBids] = useState<Bid[]>([]);
  const [bidError, setBidError] = useState<{ code?: string; reason: string; minimumBid?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heldVersion = useRef<{ itemId: string | null; version: number | null }>({ itemId: null, version: null });
  const resyncPending = useRef(false);

  useEffect(() => {
    if (!roomCode || !sessionToken) return;

    const socket = connectSocket(roomCode, sessionToken);

    const requestState = () => {
      resyncPending.current = true;
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
      activeItem: AuctionItem | null;
      bids: Bid[];
      items: AuctionItem[];
      serverTime?: string;
    }) => {
      if (data.serverTime) setServerClockOffset(Date.parse(data.serverTime) - Date.now());
      resyncPending.current = false;
      holdItem(data.activeItem);
      setRoom(data.room);
      setParticipants(data.participants);
      setActiveItem(data.activeItem);
      setBids(data.bids);
      setItems((current) => mergeItems(current, data.items));
    };
    const handleParticipantJoined = (data: { participant: Participant }) => {
      setParticipants((current) => {
        const exists = current.some((participant) => participant._id === data.participant._id);
        return exists
          ? current.map((participant) => participant._id === data.participant._id
            ? { ...participant, isConnected: true }
            : participant)
          : [...current, data.participant];
      });
    };
    const handleParticipantLeft = (data: { participant: Participant }) => {
      setParticipants((current) => current.map((participant) => participant._id === data.participant._id
        ? { ...participant, isConnected: false }
        : participant));
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
        setParticipants((current) => current.map((participant) =>
          participant._id === data.winner!._id
            ? { ...participant, spent: data.winner!.spent }
            : participant));
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

  return {
    status: hasSession ? status : "disconnected",
    room,
    participants,
    items,
    activeItem,
    serverClockOffset,
    bids,
    bidError,
    setBidError,
    error: hasSession ? error : "Active session not found. Cannot connect to socket.",
  };
}
