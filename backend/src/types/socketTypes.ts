import { Socket } from 'socket.io';
import { GameState } from './gameTypes';

// ==========================================
// USER TYPES
// ==========================================
export interface AuthenticatedUser {
    id: string;
    email?: string;
    username?: string;
    name?: string;
}

export interface AuthenticatedSocket extends Socket {
    user?: AuthenticatedUser;
}

// ==========================================
// SOCKET EVENT PAYLOADS - ROOM OPERATIONS
// ==========================================
export interface RoomCreatedPayload {
    roomCode: string;
}

export interface PlayerListPayload {
    players: string[];
}

// ==========================================
// SOCKET EVENT PAYLOADS - GAME OPERATIONS
// ==========================================
export interface GameStartedPayload extends GameState {}

export interface WordChosenPayload {
    hiddenWord: string;
}

export interface ChooseWordPayload {
    roomCode: string;
    word: string;
}

export interface GuessWordPayload {
    roomCode: string;
    guess: string;
    username?: string;
}

export interface ChatMessagePayload {
    sender: string;
    text: string;
    type: 'normal' | 'success' | 'error';
}

export interface ScoreUpdatePayload {
    [userId: string]: number;
}

export interface CorrectGuessersUpdatePayload {
    guessers: string[];
}

export interface TurnUpdatedPayload extends GameState {}

export interface GameOverPayload {
    reason?: string;
}

// ==========================================
// SOCKET EVENT PAYLOADS - DRAWING OPERATIONS
// ==========================================
export interface CanvasSegment {
    id: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    lineWidth: number;
    lamportTimestamp?: number; // Logical clock for event ordering across distributed servers
}

export interface DrawLinePayload {
    roomCode: string;
    segment: CanvasSegment;
}

export interface EraseStrokePayload {
    roomCode: string;
    strokeId: string;
}

export interface ClearCanvasPayload {
    roomCode: string;
}

export interface SendCanvasSnapshotPayload {
    roomCode: string;
}

export interface CanvasSnapshotPayload {
    targetSocketId: string;
    segments: CanvasSegment[];
}

export interface ReceiveCanvasSnapshotPayload {
    segments: CanvasSegment[];
}

// ==========================================
// SOCKET EVENT PAYLOADS - NAME MANAGEMENT
// ==========================================
export interface RegisterNamePayload {
    id: string;
    username: string;
}

export interface NameDictUpdatePayload {
    [userId: string]: string;
}

// ==========================================
// SOCKET EVENT PAYLOADS - GAME SETTINGS
// ==========================================
export interface GameSettingsPayload {
  maxRounds: number;
  wordDifficulty: 'easy' | 'medium' | 'hard';
  wordCategory?: 'random' | 'animals' | 'food' | 'sports' | 'tech' | 'custom';
  customWords?: string[];
}

export interface StartGamePayload {
  roomCode: string;
  settings?: GameSettingsPayload; // Optional, uses defaults if not provided
}

// ==========================================
// ERROR RESPONSES
// ==========================================
export interface SocketErrorPayload {
    message: string;
    code?: string;
    details?: unknown;
}