# BrainBrush DS Mini Project — Walkthrough

## Summary

Implemented **6 phases** of distributed systems concepts across the BrainBrush v2 codebase, covering all 4 units of the DS syllabus plus all 6 lab assignments.

---

## Changes Made

### Phase 1: Horizontal Scaling (Unit I — Architecture, Middleware, Scalability)

| File | Change |
|------|--------|
| [redis.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/config/redis.ts) | Added `pubClient` + `subClient` for Socket.IO Redis Adapter |
| [env.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/config/env.ts) | Added `INSTANCE_ID` for distributed tracing |
| [server.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/server.ts) | Attached `@socket.io/redis-adapter` to Socket.IO |
| [index.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/sockets/index.ts) | Migrated `activeSessions` Map → Redis hash |
| [drawingSocket.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/sockets/drawingSocket.ts) | Migrated `activeDrawers` Map → Redis hash |
| [gameSocket.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/sockets/gameSocket.ts) | Migrated `temporaryNames` Map → Redis hash |
| [timer.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/utils/timer.ts) | Distributed timer with Redis locks (SET NX) |
| [app.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/app.ts) | Added `/health` endpoint + `X-Instance-ID` header |
| [docker-compose.scaled.yml](file:///home/xcaliber/Projects/BrainBrush-v2/docker-compose.scaled.yml) | 3 backend instances + Redis + Mongo + Nginx + Frontend |
| [nginx.conf](file:///home/xcaliber/Projects/BrainBrush-v2/nginx/nginx.conf) | WebSocket-aware reverse proxy with ip_hash sticky sessions |

### Phase 2: Bully Election Algorithm (Unit III — Election Algorithms)

| File | Change |
|------|--------|
| [bullyElection.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/algorithms/bullyElection.ts) | **NEW** — Full Bully Algorithm with Redis Sorted Set priorities |
| [roomService.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/services/roomService.ts) | Replaced `players[0]` with Bully Election on host disconnect |
| [roomSocket.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/sockets/roomSocket.ts) | Broadcasts election result + chat message to clients |

### Phase 3: Lamport Logical Clocks (Unit III — Clock Synchronization)

| File | Change |
|------|--------|
| [lamportClock.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/algorithms/lamportClock.ts) | **NEW** — Lamport clock with atomic Redis INCR + Lua script |
| [drawingSocket.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/sockets/drawingSocket.ts) | Stamps every `draw_line_batch` with Lamport timestamp |
| [socketTypes.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/types/socketTypes.ts) | Added `lamportTimestamp` to `CanvasSegment` interface |
| [scoringService.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/services/scoringService.ts) | Updated to use `getTimeLeftSync` from distributed timer |

### Phase 4: WebRTC Push-to-Talk Voice Chat (Unit II — P2P, WebRTC)

| File | Change |
|------|--------|
| [voiceSocket.ts](file:///home/xcaliber/Projects/BrainBrush-v2/backend/src/sockets/voiceSocket.ts) | **NEW** — WebRTC signaling server (SDP + ICE relay) |
| [useWebRTC.ts](file:///home/xcaliber/Projects/BrainBrush-v2/frontend/src/hooks/useWebRTC.ts) | **NEW** — React hook for P2P audio with push-to-talk |
| [VoiceChat.tsx](file:///home/xcaliber/Projects/BrainBrush-v2/frontend/src/components/VoiceChat.tsx) | **NEW** — Push-to-talk UI component |
| [GamePage.tsx](file:///home/xcaliber/Projects/BrainBrush-v2/frontend/src/pages/GamePage.tsx) | Integrated VoiceChat below ScoreBoard |

### Phase 5: Kubernetes Manifests (Unit IV — Container Orchestration)

| File | Change |
|------|--------|
| [backend.yaml](file:///home/xcaliber/Projects/BrainBrush-v2/k8s/backend.yaml) | **NEW** — 3-replica deployment + ClusterIP service |
| [frontend.yaml](file:///home/xcaliber/Projects/BrainBrush-v2/k8s/frontend.yaml) | **NEW** — 2-replica frontend deployment |
| [redis.yaml](file:///home/xcaliber/Projects/BrainBrush-v2/k8s/redis.yaml) | **NEW** — Redis deployment + PVC |
| [mongo.yaml](file:///home/xcaliber/Projects/BrainBrush-v2/k8s/mongo.yaml) | **NEW** — MongoDB deployment + PVC |
| [ingress.yaml](file:///home/xcaliber/Projects/BrainBrush-v2/k8s/ingress.yaml) | **NEW** — WebSocket-aware Ingress with sticky sessions |
| [hpa.yaml](file:///home/xcaliber/Projects/BrainBrush-v2/k8s/hpa.yaml) | **NEW** — Auto-scaling 3→10 pods on CPU > 70% |
| [secrets.yaml.template](file:///home/xcaliber/Projects/BrainBrush-v2/k8s/secrets.yaml.template) | **NEW** — Secrets template |

### Phase 6: Lab Scripts

| File | Change |
|------|--------|
| [deadlock.ts](file:///home/xcaliber/Projects/BrainBrush-v2/labs/deadlock-detection/deadlock.ts) | **NEW** — Wait-For Graph with DFS cycle detection ✅ |
| [wordcount.ts](file:///home/xcaliber/Projects/BrainBrush-v2/labs/hadoop-wordcount/wordcount.ts) | **NEW** — MapReduce word count on BrainBrush chat logs ✅ |

### Documentation (all in `docs/ds/`)

| File | Content |
|------|---------|
| [00-overview.md](file:///home/xcaliber/Projects/BrainBrush-v2/docs/ds/00-overview.md) | Master presentation document with architecture diagram |
| [01-architecture-and-scaling.md](file:///home/xcaliber/Projects/BrainBrush-v2/docs/ds/01-architecture-and-scaling.md) | Unit I: Redis Adapter, state migration, distributed timers, Nginx LB |
| [02-bully-election.md](file:///home/xcaliber/Projects/BrainBrush-v2/docs/ds/02-bully-election.md) | Unit III: Bully Algorithm with election scenarios |
| [03-lamport-clocks.md](file:///home/xcaliber/Projects/BrainBrush-v2/docs/ds/03-lamport-clocks.md) | Unit III: Lamport's happened-before relation |
| [04-webrtc-voice.md](file:///home/xcaliber/Projects/BrainBrush-v2/docs/ds/04-webrtc-voice.md) | Unit II: WebRTC P2P architecture, SDP, ICE |
| [05-kubernetes.md](file:///home/xcaliber/Projects/BrainBrush-v2/docs/ds/05-kubernetes.md) | Unit IV: K8s concepts, HPA, fault tolerance |

---

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compilation (`npx tsc --noEmit`) | ✅ Clean, no errors |
| Deadlock detection lab script | ✅ Runs, detects cycles correctly |
| MapReduce word count lab script | ✅ Runs, produces correct word frequencies |

---

## Remaining (Manual Testing)

These require running infrastructure (Docker/Redis/MongoDB):

1. **Docker Compose**: `docker compose -f docker-compose.scaled.yml up --build` → verify 3 instances sync
2. **Bully Election**: Create room → disconnect host → verify election cascade
3. **Voice Chat**: Join voice → hold to talk → verify P2P audio
4. **Kubernetes**: `kubectl apply -f k8s/` → verify pods, HPA, fault tolerance
