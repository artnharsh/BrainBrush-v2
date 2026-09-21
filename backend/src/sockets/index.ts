import { Server } from "socket.io";
import jwt, { JwtPayload } from "jsonwebtoken";
import { JWT_SECRET, INSTANCE_ID } from "../config/env";
import { AuthenticatedSocket, AuthenticatedUser } from "../types/socketTypes";
import { roomSocket } from "./roomSocket";
import { drawingSocket } from "./drawingSocket";
import { gameSocket } from "./gameSocket";
import { voiceSocket } from "./voiceSocket";
import redis from "../config/redis";

interface TokenPayload extends JwtPayload {
  id: string;
  email?: string;
  username?: string;
  name?: string;
}

// ==========================================
// REDIS KEY SCHEME FOR ACTIVE SESSIONS
// ==========================================
// Old: in-memory Map<string, string> (userId → socketId)
//   → BREAKS with multiple servers: Server 2 doesn't know
//     about sessions tracked on Server 1.
//
// New: Redis Hash "active:sessions"
//   → ALL servers read/write from the same Redis store.
//   → Duplicate session detection works across instances.
// ==========================================
const SESSIONS_KEY = "active:sessions";

export const initSocket = (io: Server): void => {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      // Allow Artillery to bypass auth with a special token
      if (token === "LOAD_TEST_TOKEN") {
        socket.user = {
          id: `loadtest-${socket.id}`,
          username: "Load Tester"
        };
        return next();
      }

      const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;

      const user: AuthenticatedUser = {
        id: decoded.id,
        email: decoded.email,
        username: decoded.username,
        name: decoded.name
      };

      socket.user = user;

      next();
    } catch (error) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", async (socket: AuthenticatedSocket) => {
    const userId = socket.user?.id;
    console.log(`[${INSTANCE_ID}] User connected: ${userId} (socket: ${socket.id})`);

    // ==========================================
    // DISTRIBUTED DUPLICATE SESSION DETECTION
    // ==========================================
    // Check Redis for an existing session for this userId.
    // If found, disconnect the old socket (even if it's on a different server).
    if (userId) {
      const oldSocketId = await redis.hget(SESSIONS_KEY, userId);

      if (oldSocketId) {
        // Try to find the old socket on THIS instance
        const oldSocket = io.sockets.sockets.get(oldSocketId);

        if (oldSocket) {
          // The old socket is on THIS server — disconnect it directly
          oldSocket.emit("session_conflict", {
            message: "Your account was logged in from another device. You have been disconnected."
          });
          oldSocket.disconnect(true);
        } else {
          // The old socket is on ANOTHER server instance.
          // Use Socket.IO's Redis Adapter to send a disconnect command
          // across the cluster via the server-side "remote disconnect" API.
          const remoteSocket = await io.in(oldSocketId).fetchSockets();
          for (const rs of remoteSocket) {
            rs.emit("session_conflict", {
              message: "Your account was logged in from another device. You have been disconnected."
            });
            rs.disconnect(true);
          }
        }
      }

      // Register this socket as the active session in Redis
      await redis.hset(SESSIONS_KEY, userId, socket.id);
    }

    roomSocket(io, socket);
    drawingSocket(io, socket);
    gameSocket(io, socket);
    voiceSocket(io, socket);

    socket.on("disconnect", async () => {
      console.log(`[${INSTANCE_ID}] User disconnected: ${userId}`);
      // Only remove from Redis if THIS socket is still the active one
      // (prevents a race where the new socket registers, then the old one disconnects)
      if (userId) {
        const currentSocketId = await redis.hget(SESSIONS_KEY, userId);
        if (currentSocketId === socket.id) {
          await redis.hdel(SESSIONS_KEY, userId);
        }
      }
    });
  });
};
