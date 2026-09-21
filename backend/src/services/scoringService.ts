// backend/src/services/scoringService.ts
import redis from "../config/redis";
import { getGameState } from "./gameService"
import { getTimeLeftSync } from "../utils/timer";
import { GameState } from "../types/gameTypes";

interface GuessResult {
    isCorrect: boolean;
    message?: string;
    alreadyGuessed?: boolean;
    game?: GameState;
    allGuessed?: boolean;
    correctGuessersArray?: string[];
}

export const processGuess = async(roomCode: string, userId: string, guess: string): Promise<GuessResult> => {
    // 1. FAST PATH: Fetch only the flat word key first!
    const word = await redis.get(`room:${roomCode}:word`);
    
    // If no word is picked yet, ignore
    if(!word) {
        return { isCorrect: false };
    }

    // If guess is wrong, exit early (O(1) fast path)
    const isMatch = guess.trim().toLowerCase() === word.toLowerCase();
    if (!isMatch) {
        return { isCorrect: false };
    }

    // 2. SLOW PATH: ONLY if correct, we fetch the heavy GameState JSON to update scores
    const game = await getGameState(roomCode);

    // drawer is not allowed to guess the word
    if(game.drawer === userId) {
        return { isCorrect: false, message: "Drawer cannot guess!" };
    }

    // SPAM PREVENTION: Have they already guessed it? (Using Redis SET)
    const hasGuessed = await redis.sismember(`room:${roomCode}:guessed`, userId);
    if (hasGuessed) {
        return { isCorrect: false, alreadyGuessed: true };
    }

    // THE MATH: Calculate points based on speed
    // Using the synchronous cached value from the distributed timer
    const timeLeft = getTimeLeftSync(roomCode);
    const points = Math.floor((timeLeft / 60) * 500) || 10; // At least 10 pts

    game.scores[userId] = (game.scores[userId] || 0) + points;
    game.scores[game.drawer] = (game.scores[game.drawer] || 0) + 50;

    await redis.set(`game:${roomCode}`, JSON.stringify(game));

    // UPDATE REDIS: Mark user as having guessed correctly
    await redis.sadd(`room:${roomCode}:guessed`, userId);
    const roomGuessersList = await redis.smembers(`room:${roomCode}:guessed`);

    // FAST FORWARD CHECK: Did everyone except the drawer guess it?
    const allGuessed = roomGuessersList.length >= game.players.length - 1;

    return {
        isCorrect: true,
        game,
        allGuessed,
        correctGuessersArray: roomGuessersList
    };
};