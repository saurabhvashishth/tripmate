const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join("/data", "expenses.db");

// ---- DB setup ----------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id          TEXT PRIMARY KEY,
    trip_id     TEXT NOT NULL,
    description TEXT NOT NULL,
    amount      REAL NOT NULL,
    paid_by     TEXT NOT NULL,          -- member name who paid
    split_among TEXT NOT NULL,          -- JSON array of member names
    created_at  TEXT NOT NULL
  );
`);

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const round2 = (n) => Math.round(n * 100) / 100;

// ---- App ---------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "expense-service" }));

// Add expense
app.post("/api/expenses", (req, res) => {
  const { trip_id, description, amount, paid_by, split_among } = req.body || {};
  if (!trip_id || !description || amount == null || !paid_by) {
    return res.status(400).json({ error: "trip_id, description, amount, paid_by are required" });
  }
  const parties = Array.isArray(split_among) && split_among.length ? split_among : [paid_by];
  const id = uid();
  db.prepare(
    `INSERT INTO expenses (id, trip_id, description, amount, paid_by, split_among, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, trip_id, description, Number(amount), paid_by, JSON.stringify(parties), new Date().toISOString());
  res.status(201).json(getExpense(id));
});

// List expenses for a trip
app.get("/api/expenses/:tripId", (req, res) => {
  res.json(expensesOf(req.params.tripId));
});

// Delete expense
app.delete("/api/expenses/item/:id", (req, res) => {
  const info = db.prepare("DELETE FROM expenses WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "expense not found" });
  res.status(204).end();
});

// Split summary + settlement suggestions for a trip
app.get("/api/expenses/:tripId/summary", (req, res) => {
  const expenses = expensesOf(req.params.tripId);

  // net balance per member: positive = owed money, negative = owes money
  const balances = {};
  const bump = (name, delta) => {
    balances[name] = round2((balances[name] || 0) + delta);
  };

  let total = 0;
  for (const e of expenses) {
    total += e.amount;
    const parties = e.split_among;
    const share = e.amount / parties.length;
    bump(e.paid_by, e.amount); // payer fronted the cash
    for (const p of parties) bump(p, -share); // each party owes their share
  }

  // greedy settlement: who pays whom
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0.009)
    .map(([name, v]) => ({ name, amount: v }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -0.009)
    .map(([name, v]) => ({ name, amount: -v }))
    .sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = round2(Math.min(debtors[i].amount, creditors[j].amount));
    if (pay > 0) {
      settlements.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
    }
    debtors[i].amount = round2(debtors[i].amount - pay);
    creditors[j].amount = round2(creditors[j].amount - pay);
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  res.json({
    trip_id: req.params.tripId,
    total: round2(total),
    expense_count: expenses.length,
    balances,
    settlements,
  });
});

// ---- helpers -----------------------------------------------------------------
function rowToExpense(row) {
  return { ...row, split_among: JSON.parse(row.split_among) };
}
function expensesOf(tripId) {
  return db
    .prepare("SELECT * FROM expenses WHERE trip_id = ? ORDER BY created_at DESC")
    .all(tripId)
    .map(rowToExpense);
}
function getExpense(id) {
  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
  return row ? rowToExpense(row) : null;
}

app.listen(PORT, () => console.log(`expense-service listening on ${PORT}`));
