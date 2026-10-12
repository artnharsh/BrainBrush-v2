import redis from "../config/redis";
import GameHistory from "../models/GameHistory";
import User from "../models/User";
import { GameState } from "../types/gameTypes";
import { getRandomWords } from "../utils/wordGenerator";
import { getWordsByDifficultyAndCategory } from "../utils/wordLists";
import { getRoomSettings, GameSettingsConfig } from "./roomService";
import { invalidatePlayerCache } from "./playerService";

const Game_TTL = 3600; // 1 hour in seconds

export const startGame = async (roomCode: string, players: string[], settings?: GameSettingsConfig): Promise<GameState> => {
  if (!players || players.length === 0) throw new Error("Not enough players");

  // Fetch room settings from Redis (use provided settings or get from room)
  let gameSettings = settings;
  if (!gameSettings) {
    gameSettings = await getRoomSettings(roomCode);
  }

  // Get word list based on difficulty and category
  const wordSource = getWordsByDifficultyAndCategory(
    gameSettings.wordDifficulty,
    (gameSettings.wordCategory as any) || 'random',
    gameSettings.customWords
  );

  // Get 3 random words for drawer to choose from
  const wordChoices = getRandomWords(3, wordSource);

  const gameState: GameState = {
    roomCode,
    players, // Save the ordered list of players
    currentPlayerIndex: 0, // Start with the first player
    currentRound: 1,
    totalRounds: gameSettings.maxRounds || 1,
    drawer: players[0],
    word: "",
    wordChoices,
    timer: 60, // Fixed at 60 seconds
    scores: {},
    gameConfig: {
      wordDifficulty: gameSettings.wordDifficulty,
      wordSource, // Store the full word list for this game
      timerDuration: 60,
      maxRounds: gameSettings.maxRounds || 1
    }
  };

  players.forEach((p) => {
    gameState.scores[p] = 0;
  });

  await redis.set(
    `game:${roomCode}`,
    JSON.stringify(gameState)
  );
  await redis.set(`room:${roomCode}:word`, ""); // Flat key for O(1) guess checks

  const verify = await redis.get(`game:${roomCode}`);
  console.log(`[REDIS VERIFY] Did game save?`, verify ? "YES ✅" : "NO ❌");

  return gameState;
};

export const getGameState = async (roomCode: string): Promise<GameState> => {
  const gameStr = await redis.get(`game:${roomCode}`);
  if (!gameStr) throw new Error("Game not found");

  return JSON.parse(gameStr) as GameState;
};

// You might not need this anymore since nextTurn handles it, but keeping it for manual overrides!
export const updateDrawer = async (roomCode: string, drawer: string): Promise<GameState> => {
  const gameStr = await redis.get(`game:${roomCode}`);
  if (!gameStr) throw new Error("Game not found");

  const game: GameState = JSON.parse(gameStr);
  game.drawer = drawer;

  await redis.set(`game:${roomCode}`, JSON.stringify(game));
  return game;
};

export const updateWord = async (roomCode: string, word: string): Promise<GameState> => {
  const gameStr = await redis.get(`game:${roomCode}`);
  if (!gameStr) throw new Error("Game not found");

  const game: GameState = JSON.parse(gameStr);
  game.word = word;

  await redis.set(`game:${roomCode}`, JSON.stringify(game));
  await redis.set(`room:${roomCode}:word`, word); // Update flat key
  return game;
};

export const updateScores = async (
  roomCode: string,
  userId: string,
  score: number,
): Promise<GameState> => {
  const gameStr = await redis.get(`game:${roomCode}`);
  if (!gameStr) throw new Error("Game not found");

  const game: GameState = JSON.parse(gameStr);

  if (typeof game.scores[userId] !== "number") {
    game.scores[userId] = 0;
  }

  game.scores[userId] += score;

  await redis.set(`game:${roomCode}`, JSON.stringify(game));
  return game;
};

// Replaced `nextRound` with `nextTurn` to handle the new logic natively
export const nextTurn = async (roomCode: string): Promise<{ game: GameState; isGameOver: boolean }> => {
  const gameStr = await redis.get(`game:${roomCode}`);
  if (!gameStr) throw new Error("Game not found");

  const game: GameState = JSON.parse(gameStr);

  // 1. Move to the next player
  game.currentPlayerIndex += 1;

  // 2. If everyone has drawn, reset to the first player and increment the round
  if (game.currentPlayerIndex >= game.players.length) {
    game.currentPlayerIndex = 0;
    game.currentRound += 1;
  }

  // 3. Check if the game is over
  const isGameOver = game.currentRound > game.totalRounds;

  // 4. If the game continues, set up the next drawer and reset turn variables
  if (!isGameOver) {
    game.drawer = game.players[game.currentPlayerIndex];
    game.word = "";
    // Use the word list from gameConfig to ensure consistency across turns
    game.wordChoices = getRandomWords(3, game.gameConfig.wordSource);
    game.timer = 60;
  }

  await redis.set(`game:${roomCode}`, JSON.stringify(game));
  if (!isGameOver) {
    await redis.set(`room:${roomCode}:word`, "");
    await redis.del(`room:${roomCode}:guessed`, `room:${roomCode}:canvas`); // Clear caches for new round
  }

  return { game, isGameOver };
};

export const handlePlayerLeave = async(roomCode: string, userId: string): Promise<{ shouldEndGame: boolean; wasDrawer: boolean; game?: GameState }> => {
  const gameStr = await redis.get(`game:${roomCode}`);

  // if game isn't started or already over then do nothing 
  if(!gameStr) return {shouldEndGame: false, wasDrawer: false};

  const game: GameState = JSON.parse(gameStr);
  const playerIndex = game.players.indexOf(userId);

  // if player is not in the array ignore it
  if(playerIndex === -1) return { shouldEndGame: false, wasDrawer: false};

  // 1. remove player from the game array
  game.players.splice(playerIndex, 1);

  //2. if less than 2 players, game can't continue
  if(game.players.length < 2) {
    await redis.del(
      `game:${roomCode}`,
      `room:${roomCode}:word`,
      `room:${roomCode}:guessed`,
      `room:${roomCode}:canvas`
    ); 
    return { shouldEndGame: true, wasDrawer: false};
  }

  // 3. if the person who left was the drawer 
  const wasDrawer = (game.drawer === userId);

  //shift index back 
  // if person who left was before the current drawer or was drawer
  // the array just shrank so pointer shift down by 1
  if(playerIndex <= game.currentPlayerIndex) {
    game.currentPlayerIndex -= 1;
  }

  await redis.set((`game:${roomCode}`), JSON.stringify(game));

  return { shouldEndGame: false, wasDrawer, game};
};

export const endGame = async(roomCode: string, finalGameState: GameState): Promise<{ winner: string; maxScore: number }> => {
  let winnerId = "";
  let maxScore = -1;

  // 1. Fetch all users from MongoDB to get their real names
  const users = await User.find({ _id: { $in: finalGameState.players } });
  
  // 2. Map IDs to Names
  const userMap: Record<string, string> = {};
  users.forEach(u => {
    userMap[u._id.toString()] = u.name || "Unknown Player"; 
  });

  const formattedScores = [];

  for(const playerId of finalGameState.players) {
    const score = finalGameState.scores[playerId] || 0;

    // 3. Assemble exactly what the schema and frontend expect
    formattedScores.push({ 
      player: userMap[playerId] || "Unknown", 
      playerId: playerId,                     
      score: score
    });

    if(score > maxScore) {
      maxScore = score;
      winnerId = playerId;
    }
  }

  try {
    const history = new GameHistory({
      roomCode: finalGameState.roomCode,
      players: finalGameState.players,
      scores: formattedScores,
      winner: userMap[winnerId] || "Unknown", 
      winnerId: winnerId,
      rounds: finalGameState.totalRounds
    });

    await history.save();
    console.log(`[MONGODB] Game history saved for room: ${roomCode}`);

  } catch (error) {
    console.error("Failed to save the game history to MongoDB: ", error);
  }

  await redis.del(
    `game:${roomCode}`,
    `room:${roomCode}:word`,
    `room:${roomCode}:guessed`,
    `room:${roomCode}:canvas`
  );

  // 🔄 CACHE INVALIDATION: Invalidate cached history & stats for all players
  // so their history page displays the latest match immediately
  for (const playerId of finalGameState.players) {
    await invalidatePlayerCache(playerId);
  }

  return { winner: userMap[winnerId] || "Unknown", maxScore };
};