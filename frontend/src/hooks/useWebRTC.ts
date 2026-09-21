import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../socketClient";
import { useGameStore } from "../store/useGameStore";

// ==========================================
// WebRTC PUSH-TO-TALK HOOK
// ==========================================
// Manages peer-to-peer audio connections using WebRTC.
// The server only relays signaling data (SDP offers/answers
// and ICE candidates). Audio flows DIRECTLY between browsers.
//
// DS Topics: P2P Communication, Stream-Oriented Communication,
//            WebRTC, NAT Traversal, Signaling
// ==========================================

// Free STUN servers for NAT traversal (discovers public IP)
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

interface PeerConnection {
  userId: string;
  socketId: string;
  connection: RTCPeerConnection;
  audioElement?: HTMLAudioElement;
}

interface UseWebRTCReturn {
  isInVoice: boolean;
  isTalking: boolean;
  voicePeers: string[];
  joinVoice: () => Promise<void>;
  leaveVoice: () => void;
  startTalking: () => void;
  stopTalking: () => void;
}

export const useWebRTC = (): UseWebRTCReturn => {
  const [isInVoice, setIsInVoice] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [voicePeers, setVoicePeers] = useState<string[]>([]);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const roomCode = useGameStore((state) => state.roomCode);

  // ==========================================
  // CREATE PEER CONNECTION
  // ==========================================
  // Creates an RTCPeerConnection to a specific remote peer.
  // This is the core WebRTC API that handles:
  //   - ICE candidate gathering (NAT traversal)
  //   - DTLS encryption (secure audio)
  //   - Audio codec negotiation
  const createPeerConnection = useCallback((remoteSocketId: string, remoteUserId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // When we discover a network path (ICE candidate), send it to the remote peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("voice_ice_candidate", {
          targetSocketId: remoteSocketId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // When the remote peer's audio track arrives, play it
    pc.ontrack = (event) => {
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;

      const peer = peersRef.current.get(remoteSocketId);
      if (peer) {
        peer.audioElement = audio;
      }
    };

    // Add our local audio track (muted by default for push-to-talk)
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    peersRef.current.set(remoteSocketId, {
      userId: remoteUserId,
      socketId: remoteSocketId,
      connection: pc,
    });

    return pc;
  }, []);

  // ==========================================
  // JOIN VOICE CHANNEL
  // ==========================================
  const joinVoice = useCallback(async () => {
    if (!roomCode) return;

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;

      // Mute by default (push-to-talk)
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });

      setIsInVoice(true);
      socket.emit("voice_join", roomCode);
    } catch (err) {
      console.error("Failed to access microphone:", err);
    }
  }, [roomCode]);

  // ==========================================
  // LEAVE VOICE CHANNEL
  // ==========================================
  const leaveVoice = useCallback(() => {
    if (!roomCode) return;

    // Stop all local tracks
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    // Close all peer connections
    peersRef.current.forEach((peer) => {
      peer.connection.close();
      peer.audioElement?.pause();
    });
    peersRef.current.clear();

    setIsInVoice(false);
    setIsTalking(false);
    setVoicePeers([]);
    socket.emit("voice_leave", roomCode);
  }, [roomCode]);

  // ==========================================
  // PUSH-TO-TALK CONTROLS
  // ==========================================
  const startTalking = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      setIsTalking(true);
    }
  }, []);

  const stopTalking = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      setIsTalking(false);
    }
  }, []);

  // ==========================================
  // SIGNALING EVENT HANDLERS
  // ==========================================
  useEffect(() => {
    if (!isInVoice) return;

    // When the server tells us about existing voice peers
    const onPeersList = async (data: { peers: string[] }) => {
      setVoicePeers(data.peers);
    };

    // When a new peer joins voice — WE initiate the connection (offer)
    const onPeerJoined = async (data: { userId: string; socketId: string }) => {
      setVoicePeers((prev) => [...prev, data.userId]);

      const pc = createPeerConnection(data.socketId, data.userId);

      // Create and send SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("voice_offer", {
        targetSocketId: data.socketId,
        offer: pc.localDescription,
      });
    };

    // When we receive an SDP Offer — create answer
    const onOffer = async (data: { fromSocketId: string; fromUserId: string; offer: RTCSessionDescriptionInit }) => {
      const pc = createPeerConnection(data.fromSocketId, data.fromUserId);

      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("voice_answer", {
        targetSocketId: data.fromSocketId,
        answer: pc.localDescription,
      });
    };

    // When we receive an SDP Answer
    const onAnswer = async (data: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => {
      const peer = peersRef.current.get(data.fromSocketId);
      if (peer) {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    };

    // When we receive an ICE Candidate
    const onIceCandidate = async (data: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      const peer = peersRef.current.get(data.fromSocketId);
      if (peer) {
        await peer.connection.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    };

    // When a peer leaves voice
    const onPeerLeft = (data: { userId: string; socketId: string }) => {
      const peer = peersRef.current.get(data.socketId);
      if (peer) {
        peer.connection.close();
        peer.audioElement?.pause();
        peersRef.current.delete(data.socketId);
      }
      setVoicePeers((prev) => prev.filter((id) => id !== data.userId));
    };

    socket.on("voice_peers_list", onPeersList);
    socket.on("voice_peer_joined", onPeerJoined);
    socket.on("voice_offer", onOffer);
    socket.on("voice_answer", onAnswer);
    socket.on("voice_ice_candidate", onIceCandidate);
    socket.on("voice_peer_left", onPeerLeft);

    return () => {
      socket.off("voice_peers_list", onPeersList);
      socket.off("voice_peer_joined", onPeerJoined);
      socket.off("voice_offer", onOffer);
      socket.off("voice_answer", onAnswer);
      socket.off("voice_ice_candidate", onIceCandidate);
      socket.off("voice_peer_left", onPeerLeft);
    };
  }, [isInVoice, createPeerConnection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      leaveVoice();
    };
  }, [leaveVoice]);

  return {
    isInVoice,
    isTalking,
    voicePeers,
    joinVoice,
    leaveVoice,
    startTalking,
    stopTalking,
  };
};
