import { Server } from "socket.io";
import { AuthenticatedSocket } from "../types/socketTypes";
import { INSTANCE_ID } from "../config/env";

// ==========================================
// VOICE CHAT — WebRTC SIGNALING SERVER
// ==========================================
// This socket handler acts as the signaling server for WebRTC.
// Audio data flows DIRECTLY between players (peer-to-peer),
// NOT through our server. We only relay the initial handshake:
//   1. SDP Offers/Answers (session descriptions)
//   2. ICE Candidates (network path discovery)
//
// Architecture:
//   Player A ──Socket.IO──► Server (signaling) ◄──Socket.IO── Player B
//       │                                                │
//       └──────── WebRTC P2P Audio (direct) ────────────┘
//
// DS Topics: Stream-Oriented Communication, P2P Messaging, WebRTC
// ==========================================

export const voiceSocket = (io: Server, socket: AuthenticatedSocket): void => {

    // Player joins voice channel in their room
    socket.on("voice_join", async (roomCode: string): Promise<void> => {
        try {
            const userId = socket.user?.id;
            if (!userId) return;

            // Track this user as a voice participant
            await import("../config/redis").then(async ({ default: redis }) => {
                await redis.sadd(`room:${roomCode}:voice`, userId);
            });

            // Notify others in the room that a new voice peer joined
            socket.to(roomCode).emit("voice_peer_joined", {
                userId,
                socketId: socket.id
            });

            // Send the new peer the list of existing voice participants
            const redis = (await import("../config/redis")).default;
            const voiceMembers = await redis.smembers(`room:${roomCode}:voice`);
            socket.emit("voice_peers_list", {
                peers: voiceMembers.filter(id => id !== userId)
            });

            console.log(`[${INSTANCE_ID}] ${userId} joined voice in room ${roomCode}`);
        } catch (error) {
            console.error(`[voiceSocket] Error joining voice:`, error);
        }
    });

    // Player leaves voice channel
    socket.on("voice_leave", async (roomCode: string): Promise<void> => {
        try {
            const userId = socket.user?.id;
            if (!userId) return;

            const redis = (await import("../config/redis")).default;
            await redis.srem(`room:${roomCode}:voice`, userId);

            socket.to(roomCode).emit("voice_peer_left", {
                userId,
                socketId: socket.id
            });

            console.log(`[${INSTANCE_ID}] ${userId} left voice in room ${roomCode}`);
        } catch (error) {
            console.error(`[voiceSocket] Error leaving voice:`, error);
        }
    });

    // ==========================================
    // WebRTC SIGNALING — SDP Offer/Answer Exchange
    // ==========================================
    // When Player A wants to connect to Player B:
    //   1. A creates an RTCPeerConnection and generates an SDP Offer
    //   2. A sends the offer to B via the signaling server (this handler)
    //   3. B receives the offer, creates its own RTCPeerConnection,
    //      and generates an SDP Answer
    //   4. B sends the answer back to A via the signaling server
    //   5. Both sides exchange ICE candidates for NAT traversal
    //   6. Direct P2P audio connection established ✅
    // ==========================================

    // Relay WebRTC offer from initiator to target peer
    socket.on("voice_offer", (data: { targetSocketId: string; offer: RTCSessionDescriptionInit }): void => {
        io.to(data.targetSocketId).emit("voice_offer", {
            fromSocketId: socket.id,
            fromUserId: socket.user?.id,
            offer: data.offer
        });
    });

    // Relay WebRTC answer from target back to initiator
    socket.on("voice_answer", (data: { targetSocketId: string; answer: RTCSessionDescriptionInit }): void => {
        io.to(data.targetSocketId).emit("voice_answer", {
            fromSocketId: socket.id,
            fromUserId: socket.user?.id,
            answer: data.answer
        });
    });

    // Relay ICE candidates between peers for NAT traversal
    socket.on("voice_ice_candidate", (data: { targetSocketId: string; candidate: RTCIceCandidateInit }): void => {
        io.to(data.targetSocketId).emit("voice_ice_candidate", {
            fromSocketId: socket.id,
            candidate: data.candidate
        });
    });

    // Clean up voice state on disconnect
    socket.on("disconnecting", async (): Promise<void> => {
        try {
            const userId = socket.user?.id;
            if (!userId) return;

            const redis = (await import("../config/redis")).default;

            for (const roomCode of socket.rooms) {
                if (roomCode !== socket.id) {
                    // Remove from voice participants
                    const wasMember = await redis.srem(`room:${roomCode}:voice`, userId);
                    if (wasMember) {
                        socket.to(roomCode).emit("voice_peer_left", {
                            userId,
                            socketId: socket.id
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`[voiceSocket] Error on disconnect:`, error);
        }
    });
};
