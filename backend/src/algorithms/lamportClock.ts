import redis from "../config/redis";

// ==========================================
// LAMPORT LOGICAL CLOCK
// ==========================================
// Lamport's Algorithm provides a way to ORDER events in a
// distributed system where nodes don't share a physical clock.
//
// THE PROBLEM:
// In BrainBrush with 3 server instances, Player A draws a line
// on Server 1, and Player B draws a line on Server 2. Their
// wall clocks might differ. Without logical ordering, strokes
// can appear in the wrong order, or an eraser might be applied
// before the line it's erasing arrives.
//
// THE SOLUTION — Lamport's Happened-Before Relation:
// Each event gets a logical timestamp following these rules:
//   1. INTERNAL EVENT: clock = clock + 1
//   2. SEND EVENT:     clock = clock + 1, attach clock to message
//   3. RECEIVE EVENT:  clock = max(local_clock, received_clock) + 1
//
// This guarantees:
//   If event A "happened before" event B, then clock(A) < clock(B)
//
// REDIS KEY:
//   lamport:{roomCode}  → current logical clock value for the room
//
// DS Topics: Clock Synchronization, Logical Clocks, Lamport's
//            Algorithm, Happened-Before Relation, Event Ordering
// ==========================================

/**
 * Increment the Lamport clock for an internal or send event.
 * Returns the new timestamp to attach to the outgoing message.
 *
 * Rule: clock = clock + 1
 *
 * This is called when a server PROCESSES a drawing event
 * (either from a local client or before broadcasting).
 */
export const lamportTick = async (roomCode: string): Promise<number> => {
    // INCR is atomic in Redis — safe even with concurrent access
    const newTimestamp = await redis.incr(`lamport:${roomCode}`);
    return newTimestamp;
};

/**
 * Update the Lamport clock on receiving a message with a remote timestamp.
 * Returns the new local timestamp after merging.
 *
 * Rule: clock = max(local_clock, received_clock) + 1
 *
 * This is called when a server RECEIVES a drawing event that
 * was timestamped by another server instance.
 */
export const lamportReceive = async (roomCode: string, remoteTimestamp: number): Promise<number> => {
    // We need to atomically: read local, compute max, set new value
    // Using a Lua script for atomicity (Redis executes Lua scripts atomically)
    const luaScript = `
        local current = tonumber(redis.call('GET', KEYS[1]) or '0')
        local remote = tonumber(ARGV[1])
        local newClock = math.max(current, remote) + 1
        redis.call('SET', KEYS[1], tostring(newClock))
        return newClock
    `;

    const result = await redis.eval(luaScript, 1, `lamport:${roomCode}`, remoteTimestamp.toString());
    return result as number;
};

/**
 * Get the current Lamport clock value for a room.
 * Useful for debugging and the demo UI.
 */
export const getLamportClock = async (roomCode: string): Promise<number> => {
    const val = await redis.get(`lamport:${roomCode}`);
    return val ? parseInt(val, 10) : 0;
};

/**
 * Reset the Lamport clock for a room (called on game end/room cleanup).
 */
export const resetLamportClock = async (roomCode: string): Promise<void> => {
    await redis.del(`lamport:${roomCode}`);
};
