import { Router } from "express";
import pool from "../config/db.js";

const router = Router();

// GET /health — the hosting platform calls this every few seconds.
// 200 = "send me traffic"; anything else = "something's wrong, don't send traffic / restart me".
router.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "ok", uptimeSeconds: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ status: "unavailable", database: "unreachable" });
  }
});

export default router;
