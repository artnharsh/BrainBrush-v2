import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/useGameStore";
import axiosClient from "../api/axiosClient"; 
import { Trophy, Users, Star, Hash, Calendar, ChevronDown, Gamepad2, AlertCircle, RefreshCcw, ArrowLeft } from "lucide-react";

interface GameRecord {
  id: string;
  roomCode: string;
  winner: string;
  winnerAvatar?: string;
  playerCount: number;
  yourScore: number;
  rounds: number;
  playedAt: string;
  position: number;
  scores: Array<{
    player: string;
    playerId: string;
    score: number;
  }>;
}

interface PlayerStats {
  totalGames: number;
  wins: number;
  winRate: string;
  avgScore: string;
  totalScore: number;
}

export default function PlayerHistoryPage() {
  const navigate = useNavigate();
  const user = useGameStore((state) => state.user);
  const isAuthenticated = useGameStore((state) => state.isAuthenticated);
  const [history, setHistory] = useState<GameRecord[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [statsRes, historyRes] = await Promise.all([
        axiosClient.get("/player/stats"),
        axiosClient.get("/player/history?limit=50")
      ]);

      setStats(statsRes.data.data);
      setHistory(historyRes.data.data);
    } catch (err: any) {
      console.error("History fetch error:", err);
      setError(err.response?.data?.message || "Failed to load history. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setError("Please log in to view your history");
      setLoading(false);
      return;
    }

    fetchHistory();
  }, [isAuthenticated, user]);

  const getRankStyle = (position: number) => {
    if (position === 1) return "bg-[#FFD700] border-[#B8860B] text-black shadow-[4px_4px_0px_#B8860B]";
    if (position === 2) return "bg-[#C0C0C0] border-[#707070] text-black shadow-[4px_4px_0px_#707070]";
    if (position === 3) return "bg-[#CD7F32] border-[#8B4513] text-black shadow-[4px_4px_0px_#8B4513]";
    return "bg-white border-black shadow-[4px_4px_0px_rgba(0,0,0,1)]";
  };

  if (loading) return (
    <div className="min-h-screen bg-sky-100 flex flex-col items-center justify-center font-black italic uppercase text-4xl gap-4">
      <div className="animate-bounce">Loading History...</div>
      <div className="h-4 w-64 bg-black border-2 border-black rounded-none p-1">
        <div className="h-full bg-yellow-400 animate-[loading_1.5s_infinite]" style={{ width: '40%' }}></div>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#F0F0F0] flex items-center justify-center p-6">
      <div className="bg-white border-8 border-black p-10 shadow-[12px_12px_0px_#FF4444] max-w-lg w-full">
        <div className="flex items-center gap-4 mb-4 text-[#FF4444]">
          <AlertCircle size={48} strokeWidth={3} />
          <h2 className="text-4xl font-black uppercase italic italic tracking-tighter">System Error</h2>
        </div>
        <p className="text-xl font-bold mb-8 border-l-4 border-black pl-4">{error}</p>
        <button 
          onClick={() => fetchHistory()}
          className="w-full bg-black text-white px-8 py-4 font-black uppercase italic text-xl flex items-center justify-center gap-3 hover:bg-yellow-400 hover:text-black transition-all active:translate-y-1 active:shadow-none shadow-[4px_4px_0px_rgba(0,0,0,0.3)]"
        >
          <RefreshCcw size={24} /> Try Again
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F0F0F0] p-6 font-sans text-black">
      <div className="max-w-5xl mx-auto">

        {/* Action Bar (Back to Lobby & Refresh) */}
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={() => navigate("/lobby")}
            className="bg-white border-4 border-black px-4 py-2 font-black uppercase text-sm flex items-center gap-2 shadow-[4px_4px_0px_#000] hover:bg-yellow-300 transition-all active:translate-y-1 active:shadow-none cursor-pointer"
          >
            <ArrowLeft size={18} strokeWidth={3} /> Back to Lobby
          </button>

          <button
            onClick={() => fetchHistory()}
            className="bg-yellow-400 border-4 border-black px-4 py-2 font-black uppercase text-sm flex items-center gap-2 shadow-[4px_4px_0px_#000] hover:bg-yellow-300 transition-all active:translate-y-1 active:shadow-none cursor-pointer"
          >
            <RefreshCcw size={18} strokeWidth={3} /> Refresh Records
          </button>
        </div>
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Gamepad2 size={32} strokeWidth={3} />
              <span className="font-black italic text-xl uppercase tracking-tighter bg-black text-white px-2">Player Log</span>
            </div>
            <h1 className="text-7xl font-black uppercase tracking-tighter leading-none italic">
              Legacy <span className="text-yellow-400 drop-shadow-[4px_4px_0px_#000]">Records</span>
            </h1>
          </div>
          <div className="bg-white border-4 border-black p-4 rotate-2 shadow-[6px_6px_0px_#000]">
            <p className="font-black uppercase text-[10px] text-gray-500 mb-1">Active Profile</p>
            <p className="text-2xl font-black italic leading-none">{user?.username}</p>
          </div>
        </header>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-12">
            {[
              { label: "Games", val: stats.totalGames, icon: <Hash size={18}/>, color: "bg-blue-400" },
              { label: "Victories", val: stats.wins, icon: <Trophy size={18}/>, color: "bg-green-400" },
              { label: "Win Rate", val: `${stats.winRate}%`, icon: <Star size={18}/>, color: "bg-yellow-400" },
              { label: "Avg Score", val: Math.round(Number(stats.avgScore)), icon: <Users size={18}/>, color: "bg-purple-400" },
              { label: "Total pts", val: stats.totalScore, icon: <Trophy size={18}/>, color: "bg-pink-400" },
            ].map((s, i) => (
              <div key={i} className={`${s.color} border-4 border-black p-4 shadow-[4px_4px_0px_#000] flex flex-col justify-between h-32 hover:-translate-y-1 transition-transform`}>
                <div className="flex justify-between items-start">
                    <span className="bg-white p-1 border-2 border-black rounded-none">{s.icon}</span>
                    <span className="font-black text-4xl italic leading-none">{s.val}</span>
                </div>
                <span className="font-black uppercase italic text-[10px] tracking-widest">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* History List */}
        <div className="space-y-6">
          <h2 className="text-2xl font-black uppercase italic inline-block bg-black text-white px-4 py-1 skew-x-[-10deg]">Recent Timeline</h2>
          
          {history.length === 0 ? (
            <div className="bg-white border-4 border-black p-12 text-center shadow-[10px_10px_0px_#000]">
                <p className="text-3xl font-black italic uppercase">No Data Found</p>
                <p className="font-bold text-gray-600 mt-2 uppercase text-sm">Start a match to populate your legacy.</p>
            </div>
          ) : (
            history.map((game) => (
              <div key={game.id} className="group">
                <div 
                  onClick={() => setExpandedGameId(expandedGameId === game.id ? null : game.id)}
                  className={`${getRankStyle(game.position)} border-4 border-black p-5 flex flex-wrap items-center justify-between cursor-pointer transition-all hover:translate-x-2 relative z-10 active:translate-y-1 active:shadow-none`}
                >
                  <div className="flex items-center gap-6">
                    <div className="text-5xl font-black italic tracking-tighter opacity-30 select-none">#{game.position}</div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="bg-black text-white text-[10px] font-black px-2 py-0.5 rounded-none uppercase">Room: {game.roomCode}</span>
                            <span className="flex items-center gap-1 text-[11px] font-black text-gray-700 uppercase tracking-tight"><Calendar size={12}/> {game.playedAt}</span>
                        </div>
                        <div className="text-3xl font-black italic uppercase leading-none tracking-tight">
                            Scored <span className="text-white drop-shadow-[2px_2px_0px_#000]">{game.yourScore}</span> points
                        </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    <div className="hidden md:block text-right border-l-2 border-black/20 pl-6">
                        <p className="text-[10px] font-black uppercase text-gray-500">Winner</p>
                        <p className="font-black italic text-lg leading-tight uppercase">{game.winner}</p>
                    </div>
                    <ChevronDown className={`transition-transform duration-300 ${expandedGameId === game.id ? 'rotate-180' : ''}`} strokeWidth={4}/>
                  </div>
                </div>

                {/* Expanded Details Section */}
                {expandedGameId === game.id && (
                  <div className="bg-white border-4 border-black p-6 -mt-1 mx-4 shadow-[8px_8px_0px_#000] animate-in slide-in-from-top-4 duration-300 relative z-0">
                    <div className="grid md:grid-cols-2 gap-8">
                        <div>
                            <h4 className="font-black uppercase italic mb-4 border-b-4 border-black inline-block text-sm">Final Scoreboard</h4>
                            <div className="space-y-2">
                                {game.scores.map((s, idx) => (
                                    <div key={idx} className={`flex justify-between items-center p-2 border-2 ${s.playerId === user?.id ? 'bg-yellow-200 border-black shadow-[2px_2px_0px_#000]' : 'border-black/10 text-gray-500'}`}>
                                        <span className="font-black italic text-sm">#{idx + 1} {s.player} {s.playerId === user?.id && '(YOU)'}</span>
                                        <span className="font-black text-lg">{s.score}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-gray-100 p-4 border-4 border-black border-dashed">
                             <h4 className="font-black uppercase italic mb-2 text-sm">Match Analysis</h4>
                             <div className="space-y-2 font-black uppercase text-xs italic">
                                <div className="flex justify-between"><span>Rounds</span> <span>{game.rounds}</span></div>
                                <div className="flex justify-between"><span>Players</span> <span>{game.playerCount}</span></div>
                                <div className="flex justify-between border-t-2 border-black pt-2">
                                    <span>Difficulty</span> 
                                    <span className={game.playerCount > 4 ? 'text-red-600' : 'text-blue-600'}>
                                        {game.playerCount > 4 ? 'HARDCORE' : 'STANDARD'}
                                    </span>
                                </div>
                             </div>
                        </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}