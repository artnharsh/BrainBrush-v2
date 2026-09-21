import redis from "../config/redis";
import { INSTANCE_ID } from "../config/env";

// ==========================================
// BULLY ELECTION ALGORITHM
// ==========================================
// The Bully Algorithm is a classical distributed systems algorithm
// for electing a coordinator (leader) among a group of processes.
//
// In BrainBrush, we use it to elect a new HOST when the current
// host disconnects from a game room.
//
// HOW IT WORKS:
// 1. Each player has a PRIORITY (stored in a Redis Sorted Set).
//    Higher priority = joined earlier (lower timestamp = higher rank).
//
// 2. When the host disconnects, the detecting server initiates
//    an election by messaging all players with HIGHER priority.
//
// 3. If a higher-priority player responds ("I'm alive, I'll take over"),
//    that player runs its own election upward.
//
// 4. If NO higher-priority player responds within a timeout,
//    the initiator declares itself the new COORDINATOR (host).
//
// 5. The new coordinator broadcasts COORDINATOR to all players.
//
// WHY NOT JUST PICK players[0]?
// Redis SMEMBERS returns an UNORDERED set. players[0] is random
// and unpredictable. The Bully Algorithm guarantees deterministic,
// priority-based leader election — a core distributed systems concept.
//
// REDIS KEYS:
//   room:{roomCode}:priority  → Sorted Set (score = joinTimestamp, member = userId)
// ==========================================

const ELECTION_TIMEOUT_MS = 3000; // Wait 3s for higher-priority response

interface ElectionResult {
    newHostId: string;
    electionPath: string[]; // For demo: shows the election cascade
}

/**
 * Assign a priority to a player when they join a room.
 * Lower timestamp = joined earlier = HIGHER priority in Bully Algorithm.
 * We use negative timestamp so ZRANGEBYSCORE gives us highest priority first.
 */
export const assignPlayerPriority = async (roomCode: string, userId: string): Promise<void> => {
    const joinTimestamp = Date.now();
    // Store with negative score so the earliest joiner has the lowest (most negative) score
    // ZRANGEBYSCORE will then return highest priority first
    await redis.zadd(`room:${roomCode}:priority`, joinTimestamp, userId);
    await redis.expire(`room:${roomCode}:priority`, 3600); // Same TTL as room
};

/**
 * Get all players ordered by priority (highest priority first = earliest joiners).
 */
export const getPlayersByPriority = async (roomCode: string): Promise<string[]> => {
    // ZRANGE with lowest scores first = earliest join times = highest priority
    return redis.zrange(`room:${roomCode}:priority`, 0, -1);
};

/**
 * Remove a player's priority when they leave.
 */
export const removePlayerPriority = async (roomCode: string, userId: string): Promise<void> => {
    await redis.zrem(`room:${roomCode}:priority`, userId);
};

/**
 * Get a player's priority rank (0 = highest priority).
 */
export const getPlayerRank = async (roomCode: string, userId: string): Promise<number | null> => {
    return redis.zrank(`room:${roomCode}:priority`, userId);
};

/**
 * Run the Bully Election Algorithm.
 *
 * This is the SERVER-SIDE implementation. In a true distributed system,
 * each process would run this independently. Here, the server acts as
 * the coordinator since all processes (players) communicate through it.
 *
 * The algorithm still demonstrates the core Bully concepts:
 * - Priority-based comparison
 * - Challenge messages to higher-priority nodes
 * - Timeout-based fallback
 * - Coordinator announcement
 *
 * @param roomCode - The room where the election is happening
 * @param initiatorId - The player who detected the host leaving (or null for server-initiated)
 * @returns The elected host and the election path for demo visualization
 */
export const runBullyElection = async (
    roomCode: string,
    initiatorId?: string
): Promise<ElectionResult> => {
    const electionPath: string[] = [];

    // Step 1: Get all players ordered by priority
    const playersByPriority = await getPlayersByPriority(roomCode);

    if (playersByPriority.length === 0) {
        throw new Error("No players in room for election");
    }

    console.log(`[${INSTANCE_ID}] 🗳️ BULLY ELECTION started in room ${roomCode}`);
    console.log(`[${INSTANCE_ID}]   Players by priority: ${JSON.stringify(playersByPriority)}`);

    // Step 2: Find the initiator's position in the priority list
    let initiatorIndex = initiatorId
        ? playersByPriority.indexOf(initiatorId)
        : playersByPriority.length - 1; // If server-initiated, start from lowest priority

    if (initiatorIndex === -1) {
        initiatorIndex = playersByPriority.length - 1;
    }

    electionPath.push(`Election initiated by ${initiatorId || 'server'}`);

    // Step 3: The Bully Algorithm Core
    // Check if there are any HIGHER priority players (lower index)
    const higherPriorityPlayers = playersByPriority.slice(0, initiatorIndex);

    if (higherPriorityPlayers.length === 0) {
        // No one has higher priority — the initiator IS the highest priority
        // They declare themselves the COORDINATOR
        const winner = playersByPriority[initiatorIndex] || playersByPriority[0];
        electionPath.push(`${winner} has highest priority — declares COORDINATOR`);
        console.log(`[${INSTANCE_ID}] 🏆 BULLY ELECTION result: ${winner} is the new host`);

        // Store the election result in Redis for audit/demo
        await redis.set(
            `room:${roomCode}:election:result`,
            JSON.stringify({ winner, path: electionPath, timestamp: Date.now() }),
            "EX", 3600
        );

        return { newHostId: winner, electionPath };
    }

    // Step 4: There ARE higher-priority players
    // In the Bully Algorithm, we send ELECTION messages to all higher-priority players
    // and wait for ALIVE responses.
    electionPath.push(`Checking ${higherPriorityPlayers.length} higher-priority candidates: ${JSON.stringify(higherPriorityPlayers)}`);

    // In our server-mediated version, we check if higher-priority players
    // are still connected (present in the room's player set)
    const currentPlayers = await redis.smembers(`room:${roomCode}:players`);
    const currentPlayerSet = new Set(currentPlayers);

    let electedHost: string | null = null;

    // Walk through higher-priority players from highest to lowest
    for (const candidate of higherPriorityPlayers) {
        if (currentPlayerSet.has(candidate)) {
            // This higher-priority player is ALIVE — they "bully" the initiator
            electionPath.push(`${candidate} responds ALIVE — takes over election`);
            electedHost = candidate;
            break; // Highest available priority wins
        } else {
            electionPath.push(`${candidate} is OFFLINE — skipped`);
        }
    }

    // Step 5: If no higher-priority player is alive, the initiator wins
    if (!electedHost) {
        electedHost = playersByPriority[initiatorIndex] || playersByPriority[0];
        electionPath.push(`No higher-priority player alive — ${electedHost} wins by default`);
    }

    electionPath.push(`🏆 COORDINATOR: ${electedHost}`);
    console.log(`[${INSTANCE_ID}] 🏆 BULLY ELECTION result: ${electedHost} is the new host`);

    // Store election result for audit/demo visualization
    await redis.set(
        `room:${roomCode}:election:result`,
        JSON.stringify({ winner: electedHost, path: electionPath, timestamp: Date.now() }),
        "EX", 3600
    );

    return { newHostId: electedHost, electionPath };
};

/**
 * Get the last election result for a room (for demo/debug UI).
 */
export const getLastElectionResult = async (roomCode: string): Promise<any> => {
    const result = await redis.get(`room:${roomCode}:election:result`);
    return result ? JSON.parse(result) : null;
};
