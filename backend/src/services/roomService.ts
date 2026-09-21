import redis from "../config/redis";
import { assignPlayerPriority, removePlayerPriority, runBullyElection } from "../algorithms/bullyElection";

interface RoomCreationResult {
  roomCode: string;
  players: string[];
}

interface RoomInfo {
  players: string[];
  host?: string | null;
  electionPath?: string[]; // For demo: shows the election cascade
}

export interface GameSettingsConfig {
  maxRounds: number;
  wordDifficulty: 'easy' | 'medium' | 'hard';
  wordCategory?: 'random' | 'animals' | 'food' | 'sports' | 'tech' | 'custom';
  customWords?: string[];
}

const generateRoomCode = (): string => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const ROOM_TTL = 3600; // 1 hour in seconds

export const createRoomRedis = async (userId: string): Promise<RoomCreationResult> => {
  const roomCode = generateRoomCode();

  // Set the host and players
  await redis.set(`room:${roomCode}:host`, userId);
  await redis.sadd(`room:${roomCode}:players`, userId);

  // Assign priority for Bully Election (host gets highest priority = first joiner)
  await assignPlayerPriority(roomCode, userId);

  // Expire BOTH keys so nothing is left behind!
  await redis.expire(`room:${roomCode}:host`, ROOM_TTL);
  await redis.expire(`room:${roomCode}:players`, ROOM_TTL);

  // Return as an object so `const { roomCode } = await createRoom()` works
  return { roomCode, players: [userId] };
};

export const joinRoomRedis = async (roomCode: string, userId: string): Promise<RoomInfo> => {
  const exists = await redis.exists(`room:${roomCode}:players`);

  if (!exists) throw new Error("Room not found");

  await redis.sadd(`room:${roomCode}:players`, userId);

  // Assign priority for Bully Election (later joiners get lower priority)
  await assignPlayerPriority(roomCode, userId);

  const players = await redis.smembers(`room:${roomCode}:players`);
  const host = await redis.get(`room:${roomCode}:host`);

  // Return as an object to match the socket file expectation
  return { players, host };
};

export const leaveRoomRedis = async (roomCode: string, userId: string): Promise<RoomInfo> => {
  // Remove the user
  await redis.srem(`room:${roomCode}:players`, userId);

  // Remove their election priority
  await removePlayerPriority(roomCode, userId);

  const players = await redis.smembers(`room:${roomCode}:players`);

  // If room is empty, clean it up early
  if (players.length === 0) {
    await redis.del(`room:${roomCode}:players`);
    await redis.del(`room:${roomCode}:host`);
    return { players: [], host: null };
  }

  // The room is still alive. Did the Host just leave?
  const currentHost = await redis.get(`room:${roomCode}:host`);
  let electionPath: string[] | undefined;

  if (currentHost === userId) {
    // ==========================================
    // BULLY ELECTION — Host left, elect a new one!
    // ==========================================
    // Instead of arbitrarily picking players[0], we run
    // the Bully Algorithm to deterministically elect the
    // highest-priority remaining player as the new host.
    //
    // This is a core distributed systems concept:
    // When a coordinator fails, the remaining nodes must
    // agree on a new coordinator through an election protocol.
    // ==========================================
    try {
      const electionResult = await runBullyElection(roomCode);
      await redis.set(`room:${roomCode}:host`, electionResult.newHostId);
      electionPath = electionResult.electionPath;
      console.log(`[BULLY] Host transferred to ${electionResult.newHostId} for room ${roomCode}`);
    } catch (error) {
      // Fallback: if election fails, pick first available player
      const fallbackHost = players[0];
      await redis.set(`room:${roomCode}:host`, fallbackHost);
      console.log(`[BULLY] Election failed, fallback host: ${fallbackHost}`);
    }
  }

  const host = await redis.get(`room:${roomCode}:host`);
  return { players, host, electionPath };
};

export const getRoomRedis = async (roomCode: string): Promise<RoomCreationResult> => {
  const exists = await redis.exists(`room:${roomCode}:players`);
  if (!exists) throw new Error("Room not found");

  const players = await redis.smembers(`room:${roomCode}:players`);
  const host = await redis.get(`room:${roomCode}:host`);

  return { roomCode, players };
};

// ==========================================
// GAME SETTINGS STORAGE
// ==========================================

/**
 * Store game settings for a room
 * Settings are stored in Redis with same TTL as room
 */
export const setRoomSettings = async (
  roomCode: string,
  settings: GameSettingsConfig
): Promise<void> => {
  const settingsKey = `room:${roomCode}:settings`;

  // Validate settings
  if (settings.maxRounds < 1 || settings.maxRounds > 5) {
    throw new Error("maxRounds must be between 1 and 5");
  }

  // Store as JSON
  await redis.set(settingsKey, JSON.stringify(settings));

  // Apply TTL (same as room)
  await redis.expire(settingsKey, ROOM_TTL);
};

/**
 * Get game settings for a room
 * Returns default settings if none exist
 */
export const getRoomSettings = async (roomCode: string): Promise<GameSettingsConfig> => {
  const settingsKey = `room:${roomCode}:settings`;

  const settingsStr = await redis.get(settingsKey);

  if (!settingsStr) {
    // Return default settings
    return {
      maxRounds: 1,
      wordDifficulty: 'medium',
      wordCategory: 'random'
    };
  }

  return JSON.parse(settingsStr) as GameSettingsConfig;
};

/**
 * Update game settings for a room
 */
export const updateRoomSettings = async (
  roomCode: string,
  settings: Partial<GameSettingsConfig>
): Promise<GameSettingsConfig> => {
  const existing = await getRoomSettings(roomCode);

  const updated = {
    ...existing,
    ...settings
  };

  await setRoomSettings(roomCode, updated);

  return updated;
};

/**
 * Delete room settings when room is cleaned up
 */
export const deleteRoomSettings = async (roomCode: string): Promise<void> => {
  const settingsKey = `room:${roomCode}:settings`;
  await redis.del(settingsKey);
};