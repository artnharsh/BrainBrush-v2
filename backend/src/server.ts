import http from "http";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import app from "./app";
import connectDB from "./config/db";
import redis, { pubClient, subClient } from "./config/redis";
import { initSocket } from "./sockets";
import { ALLOWED_ORIGINS, INSTANCE_ID } from "./config/env";

dotenv.config();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// 🔒 FIX: Socket.IO uses the same CORS whitelist as Express.
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
});

// ==========================================
// SOCKET.IO REDIS ADAPTER (Horizontal Scaling)
// ==========================================
// This adapter enables multiple Node.js instances to broadcast
// Socket.IO events to each other through Redis Pub/Sub.
//
// Without this adapter:
//   Player A on Server 1 draws → only Server 1's clients see it.
//   Player B on Server 2 sees nothing.
//
// With this adapter:
//   Player A on Server 1 draws → Server 1 publishes to Redis →
//   Server 2 subscribes and receives → Server 2 pushes to Player B.
//
// This is the KEY middleware that makes BrainBrush a true
// distributed system across multiple server instances.
// ==========================================
io.adapter(createAdapter(pubClient, subClient));
console.log(`[${INSTANCE_ID}] Socket.IO Redis Adapter attached ✅`);

initSocket(io);

const startServer = async () => {
  await connectDB();

  server.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] Server running on port ${PORT}`);
  });
};

startServer();
