import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/useGameStore";
import { useSocket } from "../hooks/useSocket"; 

import GameHeader from "../components/GameHeader";
import CanvasBoard from "../components/CanvasBoard";
import ChatBox from "../components/ChatBox";
import ScoreBoard from "../components/ScoreBoard"; 
import Podium from "../components/Podium";
import VoiceChat from "../components/VoiceChat";

export default function GamePage() {
  useSocket(); 
  const navigate = useNavigate();
  const gameStatus = useGameStore((state) => state.gameStatus);

  useEffect(() => {
    if (gameStatus !== 'playing' && gameStatus !== 'podium') {
      navigate('/lobby', { replace: true });
    }
  }, [gameStatus, navigate]);

  return (
    // 🚨 FIX 1: Let the page scroll! Removed all overflow hiding. Added pb-10 for bottom padding.
    <div className="min-h-screen relative flex flex-col items-center p-2 md:p-6 bg-sky-100 font-sans pb-10">
      
      {/* Doodle Background Layer */}
      <div 
        className="absolute inset-0 z-0 opacity-15 pointer-events-none"
        style={{ 
            backgroundImage: "url('/doodle-pattern.png')", 
            backgroundSize: "400px",
            backgroundRepeat: "repeat" 
        }}
      />

      <div className="relative z-10 w-full max-w-[1500px] flex flex-col gap-4">
        
        <GameHeader />
        
        {gameStatus === 'podium' ? (
          <Podium />
        ) : (
          /* 🚨 FIX 2: Switched to Flexbox with HARDCODED widths for the sidebars.
             On desktop (lg), it forms a massive 750px tall row.
             On mobile, it stacks gracefully. 
          */
          <div className="flex flex-col lg:flex-row gap-4 w-full h-auto lg:h-[750px]">
            
            {/* Column 1: Leaderboard + Voice Chat (LOCKED to 280px wide on desktop) */}
            <div className="lg:w-[280px] lg:shrink-0 flex flex-col gap-3">
               <div className="h-[350px] lg:flex-1">
                 <ScoreBoard />
               </div>
               {/* Voice Chat — Push-to-Talk (WebRTC P2P) */}
               <VoiceChat />
            </div>
            
            {/* Column 2: Canvas (Fills all remaining space in the middle) */}
            <div className="flex-1 min-w-0 h-[500px] lg:h-full">
              <CanvasBoard />
            </div>
            
            {/* Column 3: Chat (LOCKED to 320px wide on desktop) */}
            <div className="lg:w-[320px] lg:shrink-0 h-[450px] lg:h-full">
              <ChatBox />
            </div>

          </div>
        )}
      </div>
    </div>
  );
}