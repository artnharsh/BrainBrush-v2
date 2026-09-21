import { Server } from "socket.io";
import { nextTurn, endGame } from "../services/gameService";
import { setActiveDrawer, deleteActiveDrawer } from "../sockets/drawingSocket";
import redis from "../config/redis";
import { INSTANCE_ID } from "../config/env";

// ==========================================
// DISTRIBUTED TIMER SYSTEM
// ==========================================
// Old: in-memory setInterval + Map<string, NodeJS.Timeout>
//   → BREAKS: If the timer is running on Server 1 and Server 1
//     crashes, the timer stops. No other server picks it up.
//   → BREAKS: With 3 servers, all 3 would start timers for the
//     same room, causing triple game-over events.
//
// New: Hybrid approach using Redis + local setInterval
//   → Redis stores the canonical time remaining for each room
//   → A distributed lock (SET NX) ensures only ONE server runs
//     the timer tick for each room at any given time
//   → If the lock-holder crashes, the lock auto-expires and
//     another server takes over
//
// REDIS KEYS:
//   timer:{roomCode}:remaining  → seconds left (integer)
//   timer:{roomCode}:lock       → which instance owns the tick (auto-expires)
// ==========================================

// Local reference to intervals so we can clear them on this instance
const localTimers = new Map<string, NodeJS.Timeout>();

const LOCK_TTL_MS = 2000; // Lock expires after 2 seconds (re-acquired each tick)

export const getTimeLeft = async (roomCode: string): Promise<number> => {
    const val = await redis.get(`timer:${roomCode}:remaining`);
    return val ? parseInt(val, 10) : 0;
};

// Synchronous version for scoring (called within same tick)
// Falls back to Redis but uses a cached value if available
let timeCache = new Map<string, number>();

export const getTimeLeftSync = (roomCode: string): number => {
    return timeCache.get(roomCode) || 0;
};

export const startRoundTimer = async (io: Server, roomCode: string, duration: number = 60): Promise<void> => {
    // Clear any existing timer on this instance
    clearRoundTimer(roomCode);

    // Set the canonical time in Redis
    await redis.set(`timer:${roomCode}:remaining`, duration.toString());

    // Try to acquire the timer lock for this room
    const acquired = await redis.set(
        `timer:${roomCode}:lock`,
        INSTANCE_ID,
        "PX", LOCK_TTL_MS,
        "NX"
    );

    if (!acquired) {
        // Another server already owns this timer — that's fine
        console.log(`[${INSTANCE_ID}] Timer for ${roomCode} owned by another instance`);
        return;
    }

    console.log(`[${INSTANCE_ID}] Timer started for room ${roomCode} (${duration}s)`);

    const timerId = setInterval(async () => {
        try {
            // Re-acquire the lock each tick (extends ownership)
            const stillOwner = await redis.set(
                `timer:${roomCode}:lock`,
                INSTANCE_ID,
                "PX", LOCK_TTL_MS,
                "XX" // Only set if key already exists (we already own it)
            );

            if (!stillOwner) {
                // Another instance took over (maybe we lagged) — stop our local timer
                console.log(`[${INSTANCE_ID}] Lost timer lock for ${roomCode}, stopping local timer`);
                clearLocalTimer(roomCode);
                return;
            }

            // Decrement time in Redis
            const timeLeft = await redis.decr(`timer:${roomCode}:remaining`);
            timeCache.set(roomCode, timeLeft);

            // Broadcast timer update to all players (across all instances via Redis Adapter)
            io.to(roomCode).emit("timer_update", timeLeft);

            if (timeLeft <= 0) {
                clearRoundTimer(roomCode);

                try {
                    const { game, isGameOver } = await nextTurn(roomCode);

                    if (isGameOver) {
                        await deleteActiveDrawer(roomCode);

                        const { winner, maxScore } = await endGame(roomCode, game);
                        io.to(roomCode).emit("game_over", {
                            reason: `Game Over! 🏆 The winner is ${winner} with ${maxScore} points!`,
                            game: game
                        });
                    } else {
                        await setActiveDrawer(roomCode, game.drawer);

                        io.to(roomCode).emit("turn_updated", game);
                    }
                } catch (error) {
                    console.error("Timer failed to trigger next turn: ", error);
                }
            }
        } catch (error) {
            console.error(`[${INSTANCE_ID}] Timer tick error for ${roomCode}:`, error);
        }
    }, 1000);

    localTimers.set(roomCode, timerId);
};

const clearLocalTimer = (roomCode: string): void => {
    const timerId = localTimers.get(roomCode);
    if (timerId) {
        clearInterval(timerId);
        localTimers.delete(roomCode);
    }
    timeCache.delete(roomCode);
};

export const clearRoundTimer = (roomCode: string): void => {
    clearLocalTimer(roomCode);

    // Clean up Redis keys (fire-and-forget, no await needed)
    redis.del(`timer:${roomCode}:remaining`, `timer:${roomCode}:lock`).catch(() => {});
};