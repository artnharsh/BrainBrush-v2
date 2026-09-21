// backend/src/sockets/gameSocket.ts
import { Server } from "socket.io";
import { AuthenticatedSocket, RegisterNamePayload, ChooseWordPayload, GuessWordPayload, CanvasSnapshotPayload, SendCanvasSnapshotPayload } from "../types/socketTypes";
import { processGuess } from "../services/scoringService";
import { updateWord, nextTurn, endGame } from "../services/gameService";
import { startRoundTimer, clearRoundTimer } from "../utils/timer";
import { setActiveDrawer, deleteActiveDrawer } from "./drawingSocket";
import redis from "../config/redis";

// ==========================================
// TEMPORARY NAMES — MIGRATED TO REDIS
// ==========================================
// Old: in-memory Map<string, string> (userId → displayName)
//   → BREAKS: If Player A registers their name on Server 1,
//     Server 2 doesn't know about it. Chat messages show
//     "Guest-xxxx" instead of the real name.
//
// New: Redis Hash "player:names"
//   → All servers read from the same name registry.
//   → register_name writes once, readable from any instance.
// ==========================================
const NAMES_KEY = "player:names";

export const gameSocket = (io: Server, socket: AuthenticatedSocket): void => {

    // Register/update player name when they connect
    socket.on("register_name", async (data: RegisterNamePayload): Promise<void> => {
        try {
            // Fallback to "Guest" if username is missing or default
            const validName = data.username && data.username !== "Player" ? data.username : `Guest-${data.id.slice(-4)}`;
            await redis.hset(NAMES_KEY, data.id, validName);

            // Send the FULL name dictionary to the new user
            const allNames = await redis.hgetall(NAMES_KEY);
            socket.emit("name_dict_update", allNames);

            // Broadcast only the single new name to everyone else (O(1) payload)
            socket.broadcast.emit("player_name_updated", { id: data.id, name: validName });
        } catch (error) {
            console.error(`[gameSocket] Error registering name:`, error);
        }
    });

    // Drawer selects a word
    socket.on("choose_word", async (data: ChooseWordPayload): Promise<void> => {
        try {
            const userId = socket.user?.id;
            if (!userId) return;

            // save the actual word in redis using gameService
            await updateWord(data.roomCode, data.word);

            // convert the word to blank to show guessers
            const hiddenWord = data.word.replace(/[a-zA-Z]/g, "_ ");

            // tell everyone the game is on and how long the word is!
            io.to(data.roomCode).emit("word_chosen", { hiddenWord: hiddenWord.trim() });

            startRoundTimer(io, data.roomCode, 60);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[gameSocket] Error choosing word:`, error);
            socket.emit("error", { message: `Error choosing word: ${errorMessage}` });
        }
    });

    // Player submits a guess
    socket.on("guess_word", async (data: GuessWordPayload): Promise<void> => {
        try {
            const userId = socket.user?.id;
            if (!userId) return;

            // Fetch name from Redis instead of in-memory Map
            const senderName = await redis.hget(NAMES_KEY, userId) || `Guest-${userId.slice(-4)}`;

            const result = await processGuess(data.roomCode, userId, data.guess);

            if (result.alreadyGuessed) return; // Prevent spam

            if (result.isCorrect) {
                // hides the actual guess and display message
                io.to(data.roomCode).emit("chat_message", {
                    sender: "System",
                    text: `${senderName} guessed the word!`,
                    type: "success"
                });

                if (result.game) {
                    io.to(data.roomCode).emit("score_update", result.game.scores);
                    io.to(data.roomCode).emit("correct_guessers_update", { guessers: result.correctGuessersArray });
                }

                // FAST FORWARD: Skip the rest of the timer if all guessed!
                if (result.allGuessed) {
                    io.to(data.roomCode).emit("chat_message", {
                        sender: "System",
                        text: "Everyone guessed the word!",
                        type: "success"
                    });

                    clearRoundTimer(data.roomCode);

                    const { game, isGameOver } = await nextTurn(data.roomCode);
                    if (isGameOver) {
                        await deleteActiveDrawer(data.roomCode);
                        const { winner, maxScore } = await endGame(data.roomCode, game);
                        io.to(data.roomCode).emit("game_over", {
                            reason: `Game Over! 🏆 The winner is ${winner} with ${maxScore} points!`,
                            game
                        });
                    } else {
                        await setActiveDrawer(data.roomCode, game.drawer);
                        io.to(data.roomCode).emit("turn_updated", game);
                    }
                }
            } else {
                io.to(data.roomCode).emit("chat_message", {
                    sender: senderName,
                    text: data.guess,
                    type: "normal"
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[gameSocket] Error processing guess:`, error);
            socket.emit("error", { message: `Error processing guess: ${errorMessage}` });
        }
    });

    // New player asks for the current canvas state
    socket.on("request_canvas_sync", (data: SendCanvasSnapshotPayload): void => {
        socket.to(data.roomCode).emit("send_canvas_snapshot", { targetSocketId: socket.id });
    });

    // Drawer replies with the canvas state, forward to new player
    socket.on("deliver_canvas_snapshot", (data: CanvasSnapshotPayload): void => {
        io.to(data.targetSocketId).emit("receive_canvas_snapshot", { segments: data.segments });
    });

    // Clean up temporary names on disconnect
    socket.on("disconnect", async () => {
        const userId = socket.user?.id;
        if (userId) {
            // Note: We don't delete from Redis on disconnect because
            // the player might reconnect. Names auto-expire with room cleanup.
            // This is a deliberate choice — stale names in Redis are harmless
            // (they're just strings) and save a roundtrip on reconnect.
        }
    });
};