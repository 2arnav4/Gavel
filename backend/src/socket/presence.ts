export type AttachResult = "first-socket" | "additional-socket";

export type DetachResult = "last-socket" | "remaining-sockets";

export type PresenceTracker = {
  attach(participantId: string, socketId: string): AttachResult;
  detach(participantId: string, socketId: string): DetachResult;
  socketCount(participantId: string): number;
  trackedParticipants(): number;
};

export function createPresenceTracker(): PresenceTracker {
  const sockets = new Map<string, Set<string>>();

  return {
    attach(participantId, socketId) {
      const existing = sockets.get(participantId);

      if (!existing) {
        sockets.set(participantId, new Set([socketId]));
        return "first-socket";
      }

      const wasEmpty = existing.size === 0;
      existing.add(socketId);
      return wasEmpty ? "first-socket" : "additional-socket";
    },

    detach(participantId, socketId) {
      const existing = sockets.get(participantId);
      if (!existing) return "last-socket";

      existing.delete(socketId);
      if (existing.size > 0) return "remaining-sockets";

      sockets.delete(participantId);
      return "last-socket";
    },

    socketCount(participantId) {
      return sockets.get(participantId)?.size ?? 0;
    },

    trackedParticipants() {
      return sockets.size;
    },
  };
}
