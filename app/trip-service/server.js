const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join("/data", "trips.db");

// ---- DB setup ----------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    destination TEXT,
    start_date  TEXT,
    end_date    TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS members (
    id       TEXT PRIMARY KEY,
    trip_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    email    TEXT,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
  );
`);

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---- App ---------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "trip-service" }));

// Create trip
app.post("/api/trips", (req, res) => {
  const { name, destination, start_date, end_date } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = uid();
  db.prepare(
    `INSERT INTO trips (id, name, destination, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, destination || null, start_date || null, end_date || null, new Date().toISOString());
  res.status(201).json(getTrip(id));
});

// List trips
app.get("/api/trips", (_req, res) => {
  const rows = db.prepare("SELECT * FROM trips ORDER BY created_at DESC").all();
  res.json(rows.map((t) => ({ ...t, members: membersOf(t.id) })));
});

// Get one trip
app.get("/api/trips/:id", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  res.json(trip);
});

// Delete trip
app.delete("/api/trips/:id", (req, res) => {
  const info = db.prepare("DELETE FROM trips WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "trip not found" });
  res.status(204).end();
});

// Add member
app.post("/api/trips/:id/members", (req, res) => {
  const trip = db.prepare("SELECT id FROM trips WHERE id = ?").get(req.params.id);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  const { name, email } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = uid();
  db.prepare("INSERT INTO members (id, trip_id, name, email) VALUES (?, ?, ?, ?)").run(
    id,
    req.params.id,
    name,
    email || null
  );
  res.status(201).json({ id, trip_id: req.params.id, name, email: email || null });
});

// List members
app.get("/api/trips/:id/members", (req, res) => {
  res.json(membersOf(req.params.id));
});

// ---- helpers -----------------------------------------------------------------
function membersOf(tripId) {
  return db.prepare("SELECT * FROM members WHERE trip_id = ?").all(tripId);
}
function getTrip(id) {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(id);
  if (!trip) return null;
  return { ...trip, members: membersOf(id) };
}

app.listen(PORT, () => console.log(`trip-service listening on ${PORT}`));
