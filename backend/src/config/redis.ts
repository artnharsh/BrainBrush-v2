import Redis from "ioredis";
import { REDIS_URL } from "./env";

// ==========================================
// PRIMARY REDIS CLIENT
// Used for all application-level reads/writes
// (game state, room data, canvas, timers, etc.)
// ==========================================
const redis = new Redis(REDIS_URL);

redis.on("connect", () => {
    console.log("Redis Connected (Primary)");
});

redis.on("error", (err) => {
    console.error("Redis Connection Error: ", err);
});

// ==========================================
// PUB/SUB CLIENTS FOR SOCKET.IO REDIS ADAPTER
// The adapter requires TWO dedicated Redis connections:
//   - pubClient: publishes socket events to Redis channels
//   - subClient: subscribes to Redis channels for cross-server events
//
// WHY SEPARATE CLIENTS?
// Redis Pub/Sub uses a special "subscriber mode" where a connection
// can ONLY listen for messages. It cannot run GET/SET commands.
// So we need dedicated connections that won't conflict with
// our normal application queries.
// ==========================================
const pubClient = new Redis(REDIS_URL);
const subClient = new Redis(REDIS_URL);

pubClient.on("connect", () => {
    console.log("Redis Pub Client Connected (for Socket.IO Adapter)");
});

subClient.on("connect", () => {
    console.log("Redis Sub Client Connected (for Socket.IO Adapter)");
});

pubClient.on("error", (err) => {
    console.error("Redis Pub Client Error: ", err);
});

subClient.on("error", (err) => {
    console.error("Redis Sub Client Error: ", err);
});

export { pubClient, subClient };
export default redis;