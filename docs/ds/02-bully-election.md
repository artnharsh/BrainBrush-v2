# Unit III: Bully Election Algorithm

## DS Concepts Covered
- **Election Algorithms** — Coordinator selection in distributed systems
- **Fault Tolerance** — Automatic recovery when a coordinator fails
- **Process Coordination** — Agreement among distributed nodes

---

## The Problem: Who Becomes Host?

In BrainBrush, one player is the **host** (coordinator) who controls game settings and can start the game. When the host disconnects, the system must elect a new host from the remaining players.

### Before (Broken Approach)
```typescript
// roomService.ts — Old code
const players = await redis.smembers(`room:${roomCode}:players`);
const newHost = players[0];  // ← RANDOM! Redis SMEMBERS is UNORDERED
```

**Why this is wrong:**
- `SMEMBERS` returns an **unordered set** — `players[0]` is unpredictable
- Different servers might pick different "first" players (inconsistency)
- No formal agreement protocol — just arbitrary assignment
- This is NOT an election — it's random dice rolling

---

## The Bully Algorithm

The Bully Algorithm (Garcia-Molina, 1982) is a classical distributed election algorithm where the process with the **highest priority** always wins.

### How It Works

1. **Priority Assignment**: Each player gets a priority when they join (earlier joiners = higher priority)
2. **Detection**: When the host disconnects, the detecting node starts an election
3. **Challenge**: The initiator sends ELECTION to all higher-priority players
4. **Response**: If a higher-priority player is alive, it responds ALIVE and takes over
5. **Declaration**: If no higher-priority player responds → the initiator declares itself COORDINATOR
6. **Announcement**: The new coordinator broadcasts COORDINATOR to all players

### Why "Bully"?
The highest-priority process always **bullies** its way to becoming the coordinator, even if a lower-priority process started the election.

---

## Implementation in BrainBrush

### Step 1: Priority Assignment (Redis Sorted Set)

When a player joins a room, they get a priority based on their join timestamp. Earlier joiners have higher priority.

```typescript
// backend/src/algorithms/bullyElection.ts

export const assignPlayerPriority = async (
    roomCode: string, 
    userId: string
): Promise<void> => {
    const joinTimestamp = Date.now();
    // Redis ZADD stores (score, member) pairs
    // Lower timestamp = joined earlier = higher priority
    await redis.zadd(`room:${roomCode}:priority`, joinTimestamp, userId);
};
```

**Redis Sorted Set State:**
```
room:ABC123:priority
  Player-A: 1695000001000  (joined first  → highest priority)
  Player-B: 1695000005000  (joined second → medium priority)
  Player-C: 1695000010000  (joined third  → lowest priority)
  Player-D: 1695000015000  (joined last   → lowest priority)
```

### Step 2: Election Trigger (Host Disconnects)

When a player disconnects and they were the host, the Bully Election is triggered:

```typescript
// backend/src/services/roomService.ts

if (currentHost === userId) {
    // Host left! Run the Bully Election
    const electionResult = await runBullyElection(roomCode);
    await redis.set(`room:${roomCode}:host`, electionResult.newHostId);
}
```

### Step 3: The Election Algorithm

```typescript
export const runBullyElection = async (roomCode: string): Promise<ElectionResult> => {
    const electionPath: string[] = [];
    
    // Get all players ordered by priority
    const playersByPriority = await getPlayersByPriority(roomCode);
    
    // Find higher-priority candidates
    const higherPriorityCandidates = playersByPriority.slice(0, initiatorIndex);
    
    // Check if any higher-priority player is still connected
    const currentPlayers = await redis.smembers(`room:${roomCode}:players`);
    
    for (const candidate of higherPriorityCandidates) {
        if (currentPlayers.has(candidate)) {
            // This candidate is ALIVE — they "bully" the initiator
            electionPath.push(`${candidate} responds ALIVE — takes over`);
            return { newHostId: candidate, electionPath };
        }
    }
    
    // No higher-priority player alive → initiator wins
    return { newHostId: initiator, electionPath };
};
```

---

## Election Scenarios

### Scenario 1: Normal Election
```
Players: A(priority=1) B(priority=2) C(priority=3) D(priority=4)
Host: A

A disconnects!

Election starts:
  1. Server detects A left
  2. Check higher-priority candidates: none (A was highest)
  3. Next candidate: B (priority=2)
  4. B is still connected → B becomes COORDINATOR

Result: B is the new host ✅
Election Path: ["A left", "B responds ALIVE", "🏆 COORDINATOR: B"]
```

### Scenario 2: Cascade Election
```
Players: A(1) B(2) C(3) D(4)
A AND B disconnect simultaneously!

Election starts:
  1. Check B: OFFLINE — skipped
  2. Check C: ALIVE — C becomes COORDINATOR

Result: C is the new host ✅
Election Path: ["A left", "B is OFFLINE", "C responds ALIVE", "🏆 COORDINATOR: C"]
```

### Scenario 3: Last Player Standing
```
Players: A(1) B(2) C(3)
A, B, and C disconnect, only D remains.

Election starts:
  1. Check A: OFFLINE
  2. Check B: OFFLINE
  3. Check C: OFFLINE
  4. D is the only one left → D wins by default

Result: D is the new host ✅
```

---

## Client-Side Feedback

When an election occurs, the result is broadcast to all remaining players:

```typescript
// roomSocket.ts
io.to(roomCode).emit("election_result", {
    newHostId: room.host,
    electionPath: room.electionPath  // For demo visualization
});

io.to(roomCode).emit("chat_message", {
    sender: "System",
    text: `🗳️ Bully Election: ${room.host} elected as new host`,
    type: "success"
});
```

---

## Demo Steps

1. Open 4 browser tabs and join the same room
2. Player A (first joiner) is the host — note the "Host" badge
3. Close Player A's tab (simulate disconnect)
4. Watch the chat: `"🗳️ Bully Election: Player B elected as new host"`
5. Player B now has the "Host" badge
6. Close Player B's tab — Player C becomes host via Bully Election
7. The election cascade is logged in the server console

---

## Comparison with Other Election Algorithms

| Algorithm | Approach | BrainBrush Fit |
|-----------|---------|---------------|
| **Bully** | Highest priority wins | ✅ Used — simple, deterministic |
| **Ring** | Token passed in a logical ring | ❌ Overkill for 4-8 player rooms |
| **Raft** | Leader election with log consensus | ❌ Designed for server clusters, not game rooms |
| **Paxos** | Consensus with majority agreement | ❌ Way too complex for this use case |

The Bully Algorithm is ideal for BrainBrush because:
- Small groups (2-8 players) — O(n) is fast enough
- Clear priority metric (join order)
- Immediate, deterministic result
- No split-brain problem (Redis as single source of truth)
