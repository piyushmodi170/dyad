import express from "express";
import cors from "cors";
import { Pool } from "pg";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dyad_state (
      id TEXT PRIMARY KEY DEFAULT 'main',
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("[api-server] Database table ready");
}

app.get("/api/state", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT data FROM dyad_state WHERE id = 'main'",
    );
    res.json(result.rows[0]?.data ?? null);
  } catch (err) {
    console.error("[api-server] GET /api/state error:", err);
    res.status(500).json(null);
  }
});

app.post("/api/state", async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO dyad_state (id, data, updated_at)
       VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(req.body)],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[api-server] POST /api/state error:", err);
    res.status(500).json({ ok: false });
  }
});

initDb()
  .then(() => {
    const port = 3001;
    app.listen(port, "0.0.0.0", () =>
      console.log(`[api-server] listening on :${port}`),
    );
  })
  .catch((err) => {
    console.error("[api-server] failed to init db:", err);
    process.exit(1);
  });
