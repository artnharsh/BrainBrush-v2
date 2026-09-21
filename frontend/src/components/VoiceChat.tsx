import { useWebRTC } from "../hooks/useWebRTC";
import { Mic, MicOff, PhoneCall, PhoneOff } from "lucide-react";
import { useGameStore } from "../store/useGameStore";

// ==========================================
// VOICE CHAT — Push-to-Talk UI Component
// ==========================================
// Provides a walkie-talkie style voice chat interface.
// Hold the mic button to talk, release to mute.
//
// Architecture:
//   - Uses WebRTC for P2P audio (no server relay)
//   - Socket.IO for signaling only (offers, answers, ICE)
//   - Audio flows directly between browsers
//
// DS Topics: P2P Communication, Stream-Oriented Communication
// ==========================================

export default function VoiceChat() {
  const { isInVoice, isTalking, voicePeers, joinVoice, leaveVoice, startTalking, stopTalking } = useWebRTC();
  const playerNames = useGameStore((state) => state.playerNames);

  return (
    <div className="flex flex-col gap-2">
      {/* Join/Leave Voice Button */}
      {!isInVoice ? (
        <button
          onClick={joinVoice}
          className="flex items-center justify-center gap-2 px-4 py-2.5 
                     bg-emerald-500 hover:bg-emerald-600 text-white 
                     rounded-xl font-bold text-sm transition-all duration-200
                     shadow-md hover:shadow-lg active:scale-95"
        >
          <PhoneCall size={16} />
          Join Voice
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Push-to-Talk Button */}
          <button
            onMouseDown={startTalking}
            onMouseUp={stopTalking}
            onMouseLeave={stopTalking}
            onTouchStart={startTalking}
            onTouchEnd={stopTalking}
            className={`flex items-center justify-center gap-2 px-4 py-3 
                       rounded-xl font-bold text-sm transition-all duration-150
                       select-none shadow-md active:scale-95
                       ${isTalking 
                         ? "bg-red-500 text-white shadow-red-300 scale-105 shadow-lg" 
                         : "bg-gray-700 text-gray-200 hover:bg-gray-600"
                       }`}
          >
            {isTalking ? (
              <>
                <Mic size={16} className="animate-pulse" />
                Speaking...
              </>
            ) : (
              <>
                <MicOff size={16} />
                Hold to Talk
              </>
            )}
          </button>

          {/* Voice Peers List */}
          {voicePeers.length > 0 && (
            <div className="text-xs text-gray-500 px-1">
              <span className="font-semibold">In voice:</span>{" "}
              {voicePeers.map((id) => playerNames[id] || `Guest-${id.slice(-4)}`).join(", ")}
            </div>
          )}

          {/* Leave Voice Button */}
          <button
            onClick={leaveVoice}
            className="flex items-center justify-center gap-2 px-3 py-1.5 
                       bg-red-100 hover:bg-red-200 text-red-600 
                       rounded-lg text-xs font-medium transition-all duration-200"
          >
            <PhoneOff size={12} />
            Leave Voice
          </button>
        </div>
      )}
    </div>
  );
}
