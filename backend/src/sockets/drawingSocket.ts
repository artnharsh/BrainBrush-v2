import { Server } from "socket.io";
import { AuthenticatedSocket, EraseStrokePayload, ClearCanvasPayload, CanvasSnapshotPayload, CanvasSegment } from "../types/socketTypes";
import redis from "../config/redis";
import { INSTANCE_ID } from "../config/env";
import { lamportTick } from "../algorithms/lamportClock";

// ==========================================
// ACTIVE DRAWERS — MIGRATED TO REDIS
// ==========================================
// Old: in-memory Map<string, string> (roomCode → userId)
//   → BREAKS: Server 2 doesn't know who the drawer is if the
//     game was started on Server 1.
//
// New: Redis Hash "active:drawers"
//   → All servers share the same drawer permission state.
//   → Authorization check works correctly across instances.
// ==========================================
const DRAWERS_KEY = "active:drawers";

// Helper functions to replace the old Map API
export const setActiveDrawer = async (roomCode: string, userId: string): Promise<void> => {
    await redis.hset(DRAWERS_KEY, roomCode, userId);
};

export const getActiveDrawer = async (roomCode: string): Promise<string | null> => {
    return redis.hget(DRAWERS_KEY, roomCode);
};

export const deleteActiveDrawer = async (roomCode: string): Promise<void> => {
    await redis.hdel(DRAWERS_KEY, roomCode);
};

export const drawingSocket = (io: Server, socket: AuthenticatedSocket): void => {

    // Relay draw line batch from drawer to all other players
    socket.on("draw_line_batch", async (data: { roomCode: string, segments: CanvasSegment[] }): Promise<void> => {
        try {
            if (!data.roomCode) return;

            // Authorization: Only the current drawer can broadcast drawing events
            const currentDrawer = await getActiveDrawer(data.roomCode);
            if (currentDrawer !== socket.user?.id) return;

            // ==========================================
            // LAMPORT CLOCK — Stamp drawing events
            // ==========================================
            // Each batch of drawing segments gets a Lamport timestamp.
            // This ensures correct causal ordering across servers:
            //   If Player A on Server 1 draws before Player B on Server 2,
            //   the Lamport timestamp guarantees clock(A) < clock(B)
            //   even if the wall clocks are out of sync.
            const timestamp = await lamportTick(data.roomCode);
            const stampedSegments = data.segments.map(s => ({
                ...s,
                lamportTimestamp: timestamp
            }));

            socket.to(data.roomCode).emit("draw_line_batch", stampedSegments);

            // SERVER SIDE CACHE: Save to Redis for late joiners!
            if (data.segments && data.segments.length > 0) {
                const serializedSegments = data.segments.map(s => JSON.stringify(s));
                await redis.rpush(`room:${data.roomCode}:canvas`, ...serializedSegments);
                await redis.expire(`room:${data.roomCode}:canvas`, 3600);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[drawingSocket] Error drawing batch:`, error);
            socket.emit("error", { message: `Error drawing: ${errorMessage}` });
        }
    });

    // Relay erase stroke command from drawer to all other players
    socket.on("erase_stroke", async (data: EraseStrokePayload): Promise<void> => {
        try {
            if (!data.roomCode) return;

            const currentDrawer = await getActiveDrawer(data.roomCode);
            if (currentDrawer !== socket.user?.id) return;

            socket.to(data.roomCode).emit("erase_stroke", data.strokeId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[drawingSocket] Error erasing:`, error);
            socket.emit("error", { message: `Error erasing: ${errorMessage}` });
        }
    });

    // Clear entire canvas from drawer
    socket.on("clear_canvas", async (roomCode: string): Promise<void> => {
        try {
            if (!roomCode) return;

            const currentDrawer = await getActiveDrawer(roomCode);
            if (currentDrawer !== socket.user?.id) return;

            socket.to(roomCode).emit("clear_canvas", {});
            await redis.del(`room:${roomCode}:canvas`); // Wipe the cache
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[drawingSocket] Error clearing canvas:`, error);
            socket.emit("error", { message: `Error clearing canvas: ${errorMessage}` });
        }
    });

    // New player requests current canvas state
    socket.on("request_canvas_sync", async (roomCode: string): Promise<void> => {
        try {
            const canvasData = await redis.lrange(`room:${roomCode}:canvas`, 0, -1);
            if (canvasData && canvasData.length > 0) {
                const segments = canvasData.map(s => JSON.parse(s));
                socket.emit("receive_canvas_snapshot", { segments });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[drawingSocket] Error syncing canvas:`, error);
            socket.emit("error", { message: `Error syncing canvas: ${errorMessage}` });
        }
    });

    // Drawer delivers canvas snapshot to new player
    socket.on("deliver_canvas_snapshot", (data: CanvasSnapshotPayload): void => {
        try {
            io.to(data.targetSocketId).emit("receive_canvas_snapshot", { segments: data.segments });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[drawingSocket] Error delivering canvas:`, error);
            socket.emit("error", { message: `Error delivering canvas: ${errorMessage}` });
        }
    });
};