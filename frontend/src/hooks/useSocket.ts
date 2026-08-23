import { useEffect, useState } from "react";
import { connectSocket } from "../services/socket";
import { useSessionStore } from "../stores/useSessionStore";
import type { AuctionItem, Bid, Participant, Room } from "../services/api";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

function mergeItems(current: AuctionItem[], incoming: AuctionItem[]): AuctionItem[] {
  const byId = new Map(current.map((item) => [item._id, item]));
  for (const item of incoming) byId.set(item._id, item);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Manages one room-scoped socket and applies server-authoritative state updates. */
export function useSocket(roomCode: string) {
  const sessionToken = useSessionStore((state) => state.sessionToken);
  const hasSession = Boolean(roomCode && sessionToken);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [activeItem, setActiveItem] = useState<AuctionItem | null>(null);
  // serverTime minus the local clock at the moment a server message arrived.
  // Deadlines are absolute server timestamps, so counting down against an
  // uncorrected local clock would drift by however wrong that clock is.
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [bids, setBids] = useState<Bid[]>([]);
  const [bidError, setBidError] = useState<{ reason: string; minimumBid: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomCode || !sessionToken) return;

    const socket = connectSocket(roomCode, sessionToken);

    const handleConnect = () => {
      setStatus("connected");
      setError(null);
      socket.emit("room:connect");
    };
    const handleDisconnect = () => setStatus("disconnected");
    const handleConnectError = (connectionError: Error) => {
      setStatus("disconnected");
      setError(connectionError.message || "Failed to connect to the realtime server.");
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
      setRoom(data.room);
      setParticipants(data.participants);
      setActiveItem(data.activeItem);
      setBids(data.bids);
      // Merge rather than replace: a concurrent item:added event can never be lost.
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
    const handleItemActivated = (data: { item: AuctionItem; startedAt: string; endsAt: string }) => {
      setActiveItem(data.item);
      // startedAt is the server's clock at activation, so it re-measures the
      // offset on every item without needing a separate round trip.
      setServerClockOffset(Date.parse(data.startedAt) - Date.now());
      setBids([]);
      setBidError(null);
      setRoom((current) => current ? { ...current, status: "live", endsAt: data.endsAt } : current);
    };
    const handleBidAccepted = (data: { bid: Bid; item: AuctionItem }) => {
      setActiveItem(data.item);
      setBids((current) => current.some((bid) => bid._id === data.bid._id) ? current : [data.bid, ...current]);
      setBidError(null);
      if (data.item.endsAt) {
        setRoom((current) => current ? { ...current, endsAt: data.item.endsAt } : current);
      }
    };
    const handleBidRejected = (data: { reason: string; minimumBid: number }) => setBidError(data);
    const handleAuctionPaused = (data: { itemId: string; remainingMs: number }) => {
      // Clearing endsAt is what freezes the countdown: the client renders the
      // stored remainder instead of counting down to an absolute deadline.
      setActiveItem((current) => current ? { ...current, isPaused: true, endsAt: null } : current);
      setRoom((current) => current
        ? { ...current, isPaused: true, pausedRemainingMs: data.remainingMs, endsAt: null }
        : current);
    };
    const handleAuctionResumed = (data: { item: AuctionItem; endsAt: string; serverTime?: string }) => {
      if (data.serverTime) setServerClockOffset(Date.parse(data.serverTime) - Date.now());
      setActiveItem(data.item);
      setRoom((current) => current
        ? { ...current, isPaused: false, pausedRemainingMs: null, endsAt: data.endsAt }
        : current);
      setBidError(null);
    };
    const handleItemEnded = (data: { winner?: Participant | null }) => {
      // The winner's purse changed as part of the sale, so patch it here rather
      // than waiting for the next full state sync.
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

      // Deliberately not disconnecting. Moving from the lobby to the auction
      // unmounts this hook and immediately remounts it for the same room, and a
      // teardown in between makes every other client watch that participant go
      // offline and back online. connectSocket only replaces the socket when the
      // room or participant actually changes, and the Leave Room handlers
      // disconnect explicitly.
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
