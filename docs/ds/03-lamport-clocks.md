# Unit III: Lamport Logical Clocks

## DS Concepts Covered
- **Clock Synchronization** — Ordering events without shared physical clocks
- **Logical Clocks** — Abstract time based on event causality
- **Lamport's Algorithm** — The happened-before relation
- **Event Ordering** — Ensuring correct sequence in distributed systems

---

## The Problem: Event Ordering Across Servers

With 3 backend server instances, drawing events from different players arrive at different servers. Their wall clocks might not be synchronized.

### Example: The Eraser Problem
```
Time →

Server 1 (Player A draws a line):
    t=1000ms: draw_line_batch {stroke: "red line"}

Server 2 (Player B erases that line):  
    t=999ms: erase_stroke {strokeId: "red-line-1"}
```

Player B's erase arrives **1ms earlier** by wall clock, but it was **caused by** seeing Player A's line. Without logical ordering, a client might apply the erase before the line exists.

### Why Physical Clocks Don't Work
- Server clocks drift (NTP synchronization is ~10-100ms accuracy)
- Network latency varies (5ms to 200ms+)
- Two events at "the same time" on different servers have no natural ordering
- Clock skew can reverse the apparent order of causally related events

---

## Lamport's Solution: Logical Clocks

Leslie Lamport (1978) proposed that we don't need synchronized wall clocks. Instead, we only need to preserve the **happened-before** relation: if event A caused event B, then `clock(A) < clock(B)`.

### The Three Rules

1. **Internal Event**: Before processing an event, increment the clock
   ```
   clock = clock + 1
   ```

2. **Send Event**: Before sending a message, increment the clock and attach it
   ```
   clock = clock + 1
   message.timestamp = clock
   ```

3. **Receive Event**: When receiving a message, merge clocks
   ```
   clock = max(local_clock, received_timestamp) + 1
   ```

---

## Implementation in BrainBrush

### The Lamport Clock Module

```typescript
// backend/src/algorithms/lamportClock.ts

// TICK — increment for send events (atomic in Redis)
export const lamportTick = async (roomCode: string): Promise<number> => {
    // Redis INCR is atomic — safe even with concurrent access from 3 servers
    return await redis.incr(`lamport:${roomCode}`);
};

// RECEIVE — merge with remote timestamp (atomic Lua script)
export const lamportReceive = async (
    roomCode: string, 
    remoteTimestamp: number
): Promise<number> => {
    // Lua script runs atomically in Redis
    const luaScript = `
        local current = tonumber(redis.call('GET', KEYS[1]) or '0')
        local remote = tonumber(ARGV[1])
        local newClock = math.max(current, remote) + 1
        redis.call('SET', KEYS[1], tostring(newClock))
        return newClock
    `;
    return await redis.eval(luaScript, 1, `lamport:${roomCode}`, remoteTimestamp);
};
```

**Why a Lua Script?** The `max(local, remote) + 1` operation involves a READ and a WRITE. Without atomicity, two concurrent receives could read the same local clock and produce the same new value. Redis executes Lua scripts atomically, preventing this race condition.

### Stamping Drawing Events

```typescript
// backend/src/sockets/drawingSocket.ts

socket.on("draw_line_batch", async (data) => {
    // Increment Lamport clock for this SEND event
    const timestamp = await lamportTick(data.roomCode);
    
    // Attach the logical timestamp to every segment
    const stampedSegments = data.segments.map(s => ({
        ...s,
        lamportTimestamp: timestamp
    }));
    
    // Broadcast stamped segments to all players
    socket.to(data.roomCode).emit("draw_line_batch", stampedSegments);
});
```

---

## How It Works — Step by Step

### Scenario: Three Players on Three Servers

```
Server 1 (Player A)       Server 2 (Player B)       Server 3 (Player C)
Clock: 0                  Clock: 0                  Clock: 0

Player A draws:
  tick() → Clock: 1
  emit segments with
  lamport: 1
         ─────────────►
                          Receives A's drawing:
                          max(0, 1) + 1 = Clock: 2
                                    ─────────────►
                                                    Receives A's drawing:
                                                    max(0, 1) + 1 = Clock: 2

Player B draws:
                          tick() → Clock: 3
                          emit segments with
                          lamport: 3
         ◄─────────────
  Receives B's drawing:
  max(1, 3) + 1 = Clock: 4
                                    ─────────────►
                                                    Receives B's drawing:
                                                    max(2, 3) + 1 = Clock: 4

Player C draws:
                                                    tick() → Clock: 5
                                                    emit segments with
                                                    lamport: 5
```

### The Guarantee

No matter what order the events arrive at each server:
- Player A's drawing always has timestamp **1**
- Player B's drawing always has timestamp **3**
- Player C's drawing always has timestamp **5**

If a client receives them as [5, 1, 3] due to network reordering, it can sort by Lamport timestamp to get the correct order: [1, 3, 5].

---

## Why Not Vector Clocks?

| Feature | Lamport Clock | Vector Clock |
|---------|:----------:|:----------:|
| Space per event | O(1) — single integer | O(n) — one integer per server |
| Can detect causality | Partial | Full |
| Can detect concurrency | ❌ No | ✅ Yes |
| Complexity | Simple | Complex |

**Why Lamport is sufficient for BrainBrush:**
- Drawing events are naturally sequential per room (one drawer at a time)
- We only need **ordering**, not full causal analysis
- O(1) space per event is important when sending hundreds of segments per second
- The Redis `INCR` operation gives us a naturally monotonic, gap-free counter

---

## Key Distributed Systems Insights

1. **Physical clocks are unreliable** in distributed systems — Lamport clocks provide an alternative
2. **Happened-before is transitive**: if A → B and B → C, then A → C
3. **Concurrent events** (where neither happened before the other) get arbitrary but consistent ordering
4. **Redis INCR** provides the atomic counter we need without explicit locking
5. **Lua scripts in Redis** give us atomic read-modify-write operations

---

## Demo Steps

1. Start 3 backend instances via Docker Compose
2. Join a game with 2+ players
3. Start drawing — observe Lamport timestamps incrementing in server logs
4. Each `draw_line_batch` event carries a `lamportTimestamp` field
5. Show that even with network delays, events are correctly ordered
