# Unit I: Architecture & Horizontal Scaling

## DS Concepts Covered
- **Distributed System Architecture** — Client-server with publish-subscribe
- **Middleware** — Socket.IO Redis Adapter as cross-server messaging layer
- **Scalability** — Horizontal scaling from 1 to N server instances
- **Design Issues** — Transparency, fault tolerance, consistency
- **Distributed Multimedia Systems** — Real-time canvas synchronization

---

## The Problem: Single-Server Bottleneck

BrainBrush v1 ran as a **single Node.js process**. This creates fundamental limits:

```
                 All 10,000 users
                       │
                       ▼
              ┌─────────────────┐
              │  Single Server  │  ← CPU saturated
              │  (1 process)    │  ← Memory full
              │  (1 event loop) │  ← Can't scale
              └─────────────────┘
```

**Why it breaks:**
- Node.js is single-threaded — one CPU core handles everything
- All game state stored in JavaScript `Map` objects (process memory)
- If the server crashes, ALL games crash
- Cannot add more servers because state isn't shared

---

## The Solution: Horizontal Scaling with Redis Adapter

### What is the Socket.IO Redis Adapter?

The Redis Adapter is **middleware** that sits between Socket.IO and Redis Pub/Sub. It intercepts every `io.to(room).emit()` call and publishes it to a Redis channel. All other server instances subscribe to that channel and re-emit the event to their local clients.

```
Player A (on Server 1) draws a line
    │
    ▼
Server 1: drawingSocket.ts receives "draw_line_batch"
    │
    ▼
Server 1: io.to(roomCode).emit("draw_line_batch", segments)
    │
    ▼ (Redis Adapter intercepts this)
    │
Server 1: PUBLISH to Redis channel "socket.io#/#draw_line_batch"
    │
    ├──► Server 2 (SUBSCRIBE) → re-emits to its local clients
    │
    └──► Server 3 (SUBSCRIBE) → re-emits to its local clients
    │
    ▼
Player B (on Server 2) and Player C (on Server 3) see the drawing
```

### Implementation in Code

**File: `backend/src/config/redis.ts`**
```typescript
// Two DEDICATED Redis connections for the adapter
// WHY? Redis Pub/Sub uses "subscriber mode" where a connection
// can ONLY listen for messages — it cannot run GET/SET commands.
const pubClient = new Redis(REDIS_URL);  // Publishes events
const subClient = new Redis(REDIS_URL);  // Subscribes to events
```

**File: `backend/src/server.ts`**
```typescript
import { createAdapter } from "@socket.io/redis-adapter";

// This single line transforms BrainBrush from a single-server
// app into a horizontally scalable distributed system
io.adapter(createAdapter(pubClient, subClient));
```

---

## Migrating Process-Local State to Redis

The biggest engineering challenge was moving all in-memory `Map` objects to Redis so that all server instances share the same state.

### Before (Broken with multiple servers)
```typescript
// Each server has its OWN copy of these Maps
const activeSessions = new Map<string, string>();  // userId → socketId
const activeDrawers  = new Map<string, string>();   // roomCode → userId
const temporaryNames = new Map<string, string>();   // userId → displayName
const activeTimers   = new Map<string, NodeJS.Timeout>();
```

### After (Shared across all servers via Redis)
```typescript
// All servers read/write from the SAME Redis store
await redis.hset("active:sessions", userId, socketId);
await redis.hset("active:drawers", roomCode, userId);
await redis.hset("player:names", data.id, validName);
await redis.set(`timer:${roomCode}:remaining`, duration);
```

### Why This Matters (Distributed Systems Perspective)

| DS Concept | How It Applies |
|-----------|---------------|
| **Location Transparency** | Players don't know (or care) which server they're connected to |
| **Migration Transparency** | State lives in Redis, not in any specific server's memory |
| **Replication Transparency** | The Redis Adapter replicates events to all servers automatically |
| **Consistency** | Redis provides strong consistency for reads/writes |

---

## Distributed Timer with Redis Locking

The timer system is the most complex distributed component. In a multi-server setup, we need to ensure **exactly one server** runs the timer for each room.

### The Problem
```
Server 1: setInterval(tick, 1000) for Room ABC
Server 2: setInterval(tick, 1000) for Room ABC  ← DUPLICATE!
Server 3: setInterval(tick, 1000) for Room ABC  ← TRIPLE!
```
Result: The game ends 3x faster than intended!

### The Solution: Distributed Lock (SET NX)
```typescript
// Only ONE server can acquire the lock (SET NX = "Set if Not eXists")
const acquired = await redis.set(
    `timer:${roomCode}:lock`,
    INSTANCE_ID,
    "PX", 2000,   // Lock auto-expires in 2 seconds
    "NX"           // Only set if key doesn't exist
);

// If we got the lock, we run the timer
// If not, another server already has it
```

This is a form of **mutual exclusion** — ensuring only one process accesses a critical section at a time.

---

## Nginx Load Balancer

Nginx distributes incoming connections across the 3 backend instances using **ip_hash** (sticky sessions).

```
Client IP: 192.168.1.50
    │
    ▼ hash(192.168.1.50) % 3 = 1
    │
    ▼ Always routes to backend-2
```

**Why sticky sessions?** WebSocket connections are stateful. The initial HTTP upgrade handshake must reach the same server that will handle the persistent WebSocket frames.

---

## Docker Compose — Multi-Instance Deployment

```yaml
# docker-compose.scaled.yml (simplified)
services:
  nginx:        # Reverse proxy + load balancer
  backend-1:    # Node.js instance 1 (INSTANCE_ID=backend-1)
  backend-2:    # Node.js instance 2 (INSTANCE_ID=backend-2)
  backend-3:    # Node.js instance 3 (INSTANCE_ID=backend-3)
  redis:        # Shared state store
  mongo:        # Persistent database
  frontend:     # React SPA
```

### Demo Steps
1. `docker compose -f docker-compose.scaled.yml up --build`
2. Open 3 browser tabs — each connects to a different backend (check `X-Instance-ID` header in DevTools)
3. Create a room in Tab 1, join from Tab 2 and Tab 3
4. Draw in Tab 1 — strokes appear in all tabs (cross-instance broadcast via Redis Adapter)
5. Check Docker logs: you'll see events handled by different instances
