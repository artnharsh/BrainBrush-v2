import { Server } from "socket.io";
import { AuthenticatedSocket, SocketErrorPayload, StartGamePayload } from "../types/socketTypes";
import { createRoomRedis, joinRoomRedis, leaveRoomRedis, getRoomSettings, setRoomSettings } from "../services/roomService";
import { startGame, nextTurn, handlePlayerLeave, endGame } from "../services/gameService";
import redis from "../config/redis";
import { setActiveDrawer, deleteActiveDrawer } from "./drawingSocket";
import { INSTANCE_ID } from "../config/env";

export const roomSocket = (io: Server, socket: AuthenticatedSocket): void => {

  // CREATE ROOM - host creates a new game room
  socket.on("create_room", async (): Promise<void> => {
    try {
      const userId = socket.user?.id;
      if (!userId) {
        const error: SocketErrorPayload = { message: "User not authenticated" };
        socket.emit("error", error);
        return;
      }
      const { roomCode, players } = await createRoomRedis(userId);
      socket.join(roomCode);
      socket.emit("room_created", { roomCode });
      io.to(roomCode).emit("player_list", { players, hostId: userId });
      console.log(`[${INSTANCE_ID}] Room ${roomCode} created by ${userId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to create room";
      console.error(`[roomSocket] Error creating room:`, error);
      socket.emit("error", { message: errorMessage });
    }
  });

  // JOIN ROOM - player joins an existing room
  socket.on("join_room", async (roomCode: string): Promise<void> => {
    try {
      const userId = socket.user?.id;
      if (!userId) {
        const error: SocketErrorPayload = { message: "User not authenticated" };
        socket.emit("error", error);
        return;
      }

      const room = await joinRoomRedis(roomCode, userId);
      socket.join(roomCode);
      io.to(roomCode).emit("player_list", { players: room.players, hostId: room.host });
      console.log(`[${INSTANCE_ID}] User ${userId} joined room ${roomCode}`);

      // THE RECONNECT FIX: Is there an active game?
      const gameStr = await redis.get(`game:${roomCode}`);
      if (gameStr) {
        const activeGame = JSON.parse(gameStr);

        // Send reconnecting user the current game state
        socket.emit("game_started", activeGame);

        // Send the current hidden word
        if (activeGame.word) {
          const hiddenWord = activeGame.word.replace(/[a-zA-Z]/g, "_ ");
          socket.emit("word_chosen", { hiddenWord: hiddenWord.trim() });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to join room";
      console.error(`[roomSocket] Error joining room:`, error);
      socket.emit("error", { message: errorMessage });
    }
  });

  // LEAVE ROOM - player leaves the room
  socket.on("leave_room", async (roomCode: string): Promise<void> => {
    try {
      const userId = socket.user?.id;
      if (!userId) {
        const error: SocketErrorPayload = { message: "User not authenticated" };
        socket.emit("error", error);
        return;
      }
      const room = await leaveRoomRedis(roomCode, userId);
      socket.leave(roomCode);
      if (room?.players) {
        io.to(roomCode).emit("player_list", { players: room.players, hostId: room.host });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to leave room";
      console.error(`[roomSocket] Error leaving room:`, error);
      socket.emit("error", { message: errorMessage });
    }
  });

  // START GAME - host starts the game with optional settings
  socket.on("start_game", async (payload: StartGamePayload | string): Promise<void> => {
    try {
      // Handle backward compatibility: if payload is just a string, it's the roomCode
      let roomCode: string;
      let settings: any;

      if (typeof payload === 'string') {
        // Old format: just roomCode
        roomCode = payload;
      } else {
        // New format: { roomCode, settings }
        roomCode = (payload as StartGamePayload).roomCode;
        settings = (payload as StartGamePayload).settings;
      }

      // Get the current players from Redis
      const players = await redis.smembers(`room:${roomCode}:players`);

      // Safety check: need at least 2 players
      if (players.length < 2) {
        const error: SocketErrorPayload = { message: "Need at least 2 players to start the game!" };
        socket.emit("error", error);
        return;
      }

      // If settings provided, validate and store them
      if (settings) {
        if (settings.maxRounds < 1 || settings.maxRounds > 5) {
          const error: SocketErrorPayload = { message: "maxRounds must be between 1 and 5" };
          socket.emit("error", error);
          return;
        }

        if (settings.wordCategory === 'custom') {
          if (!settings.customWords || settings.customWords.length < 3) {
            const error: SocketErrorPayload = { message: "At least 3 custom words required" };
            socket.emit("error", error);
            return;
          }
        }

        // Store settings in Redis
        await setRoomSettings(roomCode, settings);
      }

      // Initialize the game state in Redis with settings
      const gameState = await startGame(roomCode, players, settings);

      // Set the active drawer in Redis (distributed)
      await setActiveDrawer(roomCode, gameState.drawer);

      // Broadcast the starting state to everyone
      io.to(roomCode).emit("game_started", gameState);
      console.log(`[${INSTANCE_ID}] Game started in room ${roomCode}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start game";
      console.error(`[roomSocket] Error starting game:`, error);
      socket.emit("error", { message: errorMessage });
    }
  });

  // NEXT TURN - move to the next player's turn
  socket.on("next_turn", async (roomCode: string): Promise<void> => {
    try {
      const { game, isGameOver } = await nextTurn(roomCode);

      if (isGameOver) {
        await deleteActiveDrawer(roomCode);
        const { winner, maxScore } = await endGame(roomCode, game);
        io.to(roomCode).emit("game_over", {
          reason: `Game Over! 🏆 The winner is ${winner} with ${maxScore} points!`,
          game
        });
      } else {
        await setActiveDrawer(roomCode, game.drawer);
        io.to(roomCode).emit("turn_updated", game);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to advance turn";
      console.error(`[roomSocket] Error advancing turn:`, error);
      socket.emit("error", { message: errorMessage });
    }
  });

  // HANDLE DISCONNECTS - cleanup when player leaves
  socket.on("disconnecting", async (): Promise<void> => {
    try {
      const userId = socket.user?.id;
      if (!userId) return;

      for (const roomCode of socket.rooms) {
        if (roomCode !== socket.id) {

          // Remove from the lobby (may trigger Bully Election if host left)
          const room = await leaveRoomRedis(roomCode, userId);
          if (room?.players) {
            io.to(roomCode).emit("player_list", { players: room.players, hostId: room.host });

            // If a Bully Election occurred, broadcast the result for demo/UI
            if (room.electionPath) {
              io.to(roomCode).emit("election_result", {
                newHostId: room.host,
                electionPath: room.electionPath
              });
              io.to(roomCode).emit("chat_message", {
                sender: "System",
                text: `🗳️ Bully Election: ${room.host} elected as new host`,
                type: "success"
              });
            }
          }

          // Handle game logic if a game is running
          const { shouldEndGame, wasDrawer } = await handlePlayerLeave(roomCode, userId);

          if (shouldEndGame) {
            // Not enough players left, end the game
            io.to(roomCode).emit("game_over", { reason: "Not enough players to continue." });
          } else if (wasDrawer) {
            // The drawer left, skip to next turn
            await deleteActiveDrawer(roomCode);
            const { game, isGameOver } = await nextTurn(roomCode);
            if (isGameOver) {
              const { winner, maxScore } = await endGame(roomCode, game);
              io.to(roomCode).emit("game_over", {
                reason: `Game Over! 🏆 The winner is ${winner} with ${maxScore} points!`,
                game
              });
            } else {
              await setActiveDrawer(roomCode, game.drawer);
              io.to(roomCode).emit("turn_updated", game);
              io.to(roomCode).emit("chat_message", {
                sender: "System",
                text: "The drawer left! Skipping to the next turn.",
                type: "normal"
              });
            }
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`Error cleaning up after socket disconnect: ${errorMessage}`);
    }
  });
};
