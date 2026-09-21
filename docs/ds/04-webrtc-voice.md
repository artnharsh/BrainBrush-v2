# Unit II: WebRTC Push-to-Talk Voice Chat

## DS Concepts Covered
- **Stream-Oriented Communication** — Continuous audio data streams
- **Peer-to-Peer (P2P) Messaging** — Direct browser-to-browser communication
- **WebRTC** — Web Real-Time Communication protocol
- **Signaling** — Out-of-band coordination for connection setup
- **NAT Traversal** — Discovering public network paths through firewalls

---

## Architecture: Why P2P?

In a traditional client-server model, voice would flow through our backend:
```
Player A ──audio──► Server ──audio──► Player B
                      │
              🔴 Server bottleneck!
              🔴 Double latency!
              🔴 Bandwidth cost!
```

With WebRTC, audio flows **directly between browsers**:
```
Player A ◄────── WebRTC P2P Audio ──────► Player B
                (direct, no server relay)
                
Server only handles: Signaling (who wants to talk to whom)
```

This is a **decentralized** communication pattern — the server is only needed for the initial handshake, not for the ongoing data transfer. This is a fundamental distributed systems concept.

---

## How WebRTC Connection Establishment Works

### Phase 1: Signaling (via Socket.IO)

Signaling is the process of exchanging connection metadata before the P2P link is established. Our Socket.IO server acts as the signaling server.

```
Player A                    Server (Signaling)              Player B
    │                            │                              │
    │── voice_join ─────────────►│                              │
    │                            │◄──────────── voice_join ─────│
    │                            │                              │
    │── SDP Offer ──────────────►│── forward offer ────────────►│
    │                            │                              │
    │                            │◄──────────── SDP Answer ─────│
    │◄── forward answer ─────── │                              │
    │                            │                              │
    │── ICE Candidate ──────────►│── forward ICE ──────────────►│
    │                            │◄──────────── ICE Candidate ──│
    │◄── forward ICE ────────── │                              │
    │                            │                              │
    │◄════════════ P2P Audio Connection Established ═══════════►│
    │                            │                              │
    │        (Server is no longer needed for audio!)            │
```

### Phase 2: SDP (Session Description Protocol)

SDP is a text format describing media capabilities:
- What audio codecs are supported (Opus, G.711, etc.)
- What IP addresses and ports to use
- Security parameters (DTLS fingerprint)

**Offer** (Player A creates):
```
v=0
o=- 4758291834 2 IN IP4 127.0.0.1
s=-
t=0 0
m=audio 9 UDP/TLS/RTP/SAVPF 111
a=rtpmap:111 opus/48000/2  ← Using Opus codec
a=ice-ufrag:abcd           ← ICE credentials
a=fingerprint:sha-256 XX:XX:XX  ← DTLS security
```

**Answer** (Player B responds with compatible parameters)

### Phase 3: ICE (Interactive Connectivity Establishment)

ICE solves the NAT traversal problem. Most browsers are behind firewalls/NATs, so they don't have public IP addresses.

```
Player A's browser                           Player B's browser
Private IP: 192.168.1.50                     Private IP: 10.0.0.25
    │                                             │
    │── STUN request ──► Google STUN Server        │
    │◄── "Your public IP is 203.0.113.50" ────── │
    │                                             │
    │── ICE Candidate: 203.0.113.50:54321 ──────►│
    │◄── ICE Candidate: 198.51.100.25:12345 ────│
    │                                             │
    │◄═══════════ Direct P2P Connection ═════════►│
```

**STUN Server**: A public server that tells you your external IP (NAT discovery). We use Google's free STUN servers.

---

## Implementation Details

### Backend: Signaling Server

The signaling server is minimal — it only relays messages between peers:

```typescript
// backend/src/sockets/voiceSocket.ts

// Relay SDP Offer from initiator to target
socket.on("voice_offer", (data) => {
    io.to(data.targetSocketId).emit("voice_offer", {
        fromSocketId: socket.id,
        offer: data.offer
    });
});

// Relay SDP Answer from target back to initiator
socket.on("voice_answer", (data) => {
    io.to(data.targetSocketId).emit("voice_answer", {
        fromSocketId: socket.id,
        answer: data.answer
    });
});

// Relay ICE Candidates between peers
socket.on("voice_ice_candidate", (data) => {
    io.to(data.targetSocketId).emit("voice_ice_candidate", {
        fromSocketId: socket.id,
        candidate: data.candidate
    });
});
```

### Frontend: WebRTC Hook

```typescript
// frontend/src/hooks/useWebRTC.ts

const createPeerConnection = (remoteSocketId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }  // NAT traversal
        ]
    });
    
    // When we discover a network path, send it to the peer
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("voice_ice_candidate", {
                targetSocketId: remoteSocketId,
                candidate: event.candidate
            });
        }
    };
    
    // When remote audio arrives, play it
    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
    };
    
    // Add our microphone track
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    return pc;
};
```

### Push-to-Talk Mechanism

```typescript
// Microphone is muted by default
stream.getAudioTracks().forEach(track => {
    track.enabled = false;  // Muted
});

// Hold button → enable mic
const startTalking = () => {
    stream.getAudioTracks().forEach(track => {
        track.enabled = true;  // Unmuted
    });
};

// Release button → mute mic
const stopTalking = () => {
    stream.getAudioTracks().forEach(track => {
        track.enabled = false;  // Muted again
    });
};
```

---

## Mesh Topology

For rooms with N players in voice, we use a **mesh topology** where every peer connects to every other peer:

```
4 Players = 6 connections (N*(N-1)/2)

    A ◄──────► B
    │ ╲      ╱ │
    │  ╲    ╱  │
    │   ╲  ╱   │
    │    ╲╱    │
    │    ╱╲    │
    │   ╱  ╲   │
    │  ╱    ╲  │
    │ ╱      ╲ │
    C ◄──────► D
```

**Why mesh?** BrainBrush rooms have 2-8 players. For small groups, mesh is simpler than SFU (Selective Forwarding Unit) and has the lowest latency since audio goes directly between peers.

**Limitation:** For rooms with 10+ players, mesh becomes expensive (45 connections for 10 players). An SFU architecture would be needed, but that's beyond our scope.

---

## Key Distributed Systems Insights

| DS Concept | How WebRTC Demonstrates It |
|-----------|--------------------------|
| **Decentralization** | Audio data bypasses the server entirely |
| **Signaling vs Data Plane** | Control messages (SDP, ICE) go through server; data (audio) goes P2P |
| **NAT Traversal** | STUN discovers public IPs; ICE finds the best network path |
| **Fault Tolerance** | If the signaling server crashes after connection, voice continues working |
| **Peer Discovery** | Socket.IO tells peers about each other; WebRTC connects them |

---

## Demo Steps

1. Start a BrainBrush game with 2+ players
2. Click "Join Voice" on both players' screens
3. Player A holds the "Hold to Talk" button and speaks
4. Player B hears the audio in real-time
5. Open `chrome://webrtc-internals` in Chrome DevTools:
   - See the RTCPeerConnection details
   - Observe ICE candidates being exchanged
   - Confirm audio tracks are active
   - Verify that audio flows P2P (not through the server)
