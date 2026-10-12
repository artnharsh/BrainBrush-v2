import express, { Request, Response } from "express";
import { getPlayerGameHistory, getPlayerStats } from "../services/playerService";
import { protect } from "../middlewares/authMiddleware";

const router = express.Router();

/**
 * GET /api/player/history
 * Fetch player's game history
 * Query params: limit (default 20)
 */
router.get("/history", protect as any, async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const limit = parseInt(req.query.limit || "20");

    const history = await getPlayerGameHistory(userId, limit);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json({ success: true, data: history });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch history";
    res.status(500).json({ success: false, message: msg });
  }
});

/**
 * GET /api/player/stats
 * Fetch player's game statistics
 */
router.get("/stats", protect as any, async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const stats = await getPlayerStats(userId);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json({ success: true, data: stats });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch stats";
    res.status(500).json({ success: false, message: msg });
  }
});

export default router;
