# BrainBrush — Distributed Systems Mini Project

## Project Overview

**BrainBrush** is a real-time, multiplayer online drawing and guessing game — think Pictionary, but over the internet with WebSockets. One player draws a word, and the rest race to guess it.

What makes this a **Distributed Systems** project is that the entire architecture is designed to run across **multiple server instances simultaneously**, with players transparently distributed across these servers. The system handles real-time state synchronization, leader election, logical clock ordering, and peer-to-peer communication — all core DS concepts implemented in a production application.

---

## Architecture Diagram

```
                        ┌──────────────┐
                        │   Clients    │
                        │  (Browsers)  │
                        └──────┬───────┘
                               │
                    ┌──────────▼──────────┐
                    │   Nginx Load        │
                    │   Balancer          │
                    │   (Reverse Proxy)   │
                    └──┬──────┬──────┬───┘
                       │      │      │
              ┌────────▼──┐ ┌─▼────────┐ ┌──▼────────┐
              │ Backend-1 │ │ Backend-2 │ │ Backend-3 │
              │ Node.js   │ │ Node.js   │ │ Node.js   │
              │ Socket.IO │ │ Socket.IO │ │ Socket.IO │
              └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
                    │             │              │
                    └──────┬──────┘──────────────┘
                           │
                    ┌──────▼──────┐
                    │    Redis    │────── Pub/Sub (Socket.IO Adapter)
                    │  (In-Memory)│────── Game State, Timers, Locks
                    └─────────────┘
                           │
                    ┌──────▼──────┐
                    │   MongoDB   │────── Users, Game History
                    │ (Persistent)│
                    └─────────────┘
```

---

## Syllabus Mapping

| Unit | DS Topic | BrainBrush Implementation | Document |
|------|----------|--------------------------|----------|
| **I** | Architecture, Middleware, Scalability | Redis Adapter, Nginx LB, 3-instance horizontal scaling | [01-architecture-and-scaling.md](./01-architecture-and-scaling.md) |
| **II** | Stream-Oriented Comm, P2P, WebRTC | Push-to-talk voice chat with WebRTC peer connections | [04-webrtc-voice.md](./04-webrtc-voice.md) |
| **III** | Election Algorithms | Bully Algorithm for host re-election | [02-bully-election.md](./02-bully-election.md) |
| **III** | Logical Clocks | Lamport timestamps on drawing events | [03-lamport-clocks.md](./03-lamport-clocks.md) |
| **IV** | Kubernetes, Container Orchestration | K8s manifests with HPA auto-scaling | [05-kubernetes.md](./05-kubernetes.md) |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + Vite + Zustand | Fast SPA with minimal re-renders |
| Backend | Node.js + Express + Socket.IO | HTTP APIs + real-time WebSocket engine |
| In-Memory Store | Redis | Game state, pub/sub, distributed locks, timers |
| Persistent Store | MongoDB | User profiles, game history |
| Load Balancer | Nginx | Reverse proxy with sticky sessions |
| Containerization | Docker + Docker Compose | Multi-instance local deployment |
| Orchestration | Kubernetes | Production-grade auto-scaling |

---

## How to Run

### Single Instance (Development)
```bash
cd backend && npm run dev
cd frontend && npm run dev
```

### Multi-Instance (Distributed Demo)
```bash
docker compose -f docker-compose.scaled.yml up --build
```
This starts: 3 backend instances + Redis + MongoDB + Nginx LB + Frontend

### Kubernetes
```bash
kubectl apply -f k8s/
kubectl get pods -w   # Watch pods come up
kubectl get hpa -w    # Watch auto-scaling
```

---

## Lab Assignment Coverage

| Lab # | Assignment | Implementation |
|-------|-----------|----------------|
| 1 | Client-Server Socket | Socket.IO WebSocket communication (existing) |
| 2 | Bully/Ring Election | Bully Algorithm for host election |
| 3 | Deadlock Detection | Wait-For Graph with DFS (`labs/deadlock-detection/`) |
| 4 | Clock Synchronization | Lamport Logical Clocks on drawing events |
| 5 | Hadoop Word Count | MapReduce simulation on chat logs (`labs/hadoop-wordcount/`) |
| 6 | Mini Project | BrainBrush with Docker + Kubernetes |
