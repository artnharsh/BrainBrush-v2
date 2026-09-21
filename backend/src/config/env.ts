import dotenv from "dotenv";

dotenv.config();

export const PORT = process.env.PORT || 5000;
export const MONGO_URI = process.env.MONGO_URI as string;
export const REDIS_URL = process.env.REDIS_URL as string;

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID as string;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET as string;

export const JWT_SECRET = process.env.JWT_SECRET as string;

// 🔒 FIX: Allowed origins for CORS. Comma-separated in .env
// Example: ALLOWED_ORIGINS=http://localhost:5173,https://brainbrush.com
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:80")
  .split(",")
  .map((origin) => origin.trim());

// ==========================================
// INSTANCE IDENTITY (for Distributed Systems)
// Each server instance gets a unique ID so we can trace
// which instance handles which request in a multi-server setup.
// Set via INSTANCE_ID env var or auto-generated from PID + random.
// ==========================================
export const INSTANCE_ID = process.env.INSTANCE_ID || `node-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;