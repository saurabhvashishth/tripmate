const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join("/data", "expenses.db");

// ---- DB setup ----------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id           TEXT PRIMARY KEY,
    trip_id      TEXT NOT NULL,
    description  TEXT NOT NULL,
    amount       REAL NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'INR',
    category     TEXT NOT NULL DEFAULT 'general',
    paid_by      TEXT NOT NULL,
    split_type   TEXT NOT NULL DEFAULT 'equal',
    split_details TEXT NOT NULL DEFAULT '{}',
    split_among  TEXT NOT NULL,
    notes        TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id         TEXT PRIMARY KEY,
    trip_id    TEXT NOT NULL,
    from_member TEXT NOT NULL,
    to_member   TEXT NOT NULL,
    amount     REAL NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'INR',
    notes      TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
  CREATE INDEX IF NOT EXISTS idx_payments_trip ON payments(trip_id);
`);

// Migrate: add columns if upgrading from old schema
try { db.exec("ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR'"); } catch(_) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'general'"); } catch(_) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal'"); } catch(_) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN split_details TEXT NOT NULL DEFAULT '{}'"); } catch(_) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN notes TEXT"); } catch(_) {}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const round2 = (n) => Math.round(n * 100) / 100;

const CATEGORIES = [
  "general", "food", "transport", "accommodation", "entertainment",
  "shopping", "groceries", "drinks", "tickets", "fuel", "medical", "other"
];

// ---- App ---------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "expense-service" }));

// List categories
app.get("/api/expenses/categories", (_req, res) => res.json(CATEGORIES));

// Add expense
app.post("/api/expenses", (req, res) => {
  const { trip_id, description, amount, paid_by, split_among,
          category, split_type, split_details, notes, currency } = req.body || {};
  if (!trip_id || !description || amount == null || !paid_by) {
    return res.status(400).json({ error: "trip_id, description, amount, paid_by are required" });
  }
  const parties = Array.isArray(split_among) && split_among.length ? split_among : [paid_by];
  const sType = ["equal", "unequal", "percent"].includes(split_type) ? split_type : "equal";

  // Validate split_details for unequal / percent
  let sDetails = {};
  if (sType === "unequal" && split_details && typeof split_details === "object") {
    const sum = Object.values(split_details).reduce((a, b) => a + Number(b), 0);
    if (Math.abs(sum - Number(amount)) > 0.02) {
      return res.status(400).json({ error: "Unequal split amounts must sum to total" });
    }
    sDetails = split_details;
  } else if (sType === "percent" && split_details && typeof split_details === "object") {
    const sum = Object.values(split_details).reduce((a, b) => a + Number(b), 0);
    if (Math.abs(sum - 100) > 0.5) {
      return res.status(400).json({ error: "Percent splits must sum to 100" });
    }
    sDetails = split_details;
  }

  const id = uid();
  db.prepare(
    `INSERT INTO expenses (id, trip_id, description, amount, currency, category,
      paid_by, split_type, split_details, split_among, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, trip_id, description, Number(amount), currency || "INR",
        (category && CATEGORIES.includes(category)) ? category : "general",
        paid_by, sType, JSON.stringify(sDetails), JSON.stringify(parties),
        notes || null, new Date().toISOString());
  res.status(201).json(getExpense(id));
});

// Update expense
app.patch("/api/expenses/item/:id", (req, res) => {
  const existing = getExpense(req.params.id);
  if (!existing) return res.status(404).json({ error: "expense not found" });
  const { description, amount, category, notes } = req.body || {};
  if (description) db.prepare("UPDATE expenses SET description = ? WHERE id = ?").run(description, req.params.id);
  if (amount != null) db.prepare("UPDATE expenses SET amount = ? WHERE id = ?").run(Number(amount), req.params.id);
  if (category) db.prepare("UPDATE expenses SET category = ? WHERE id = ?").run(category, req.params.id);
  if (notes !== undefined) db.prepare("UPDATE expenses SET notes = ? WHERE id = ?").run(notes, req.params.id);
  res.json(getExpense(req.params.id));
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

// ---- Payments (record settlements) ------------------------------------------
app.post("/api/payments", (req, res) => {
  const { trip_id, from_member, to_member, amount, notes, currency } = req.body || {};
  if (!trip_id || !from_member || !to_member || amount == null) {
    return res.status(400).json({ error: "trip_id, from_member, to_member, amount required" });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO payments (id, trip_id, from_member, to_member, amount, currency, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, trip_id, from_member, to_member, Number(amount), currency || "INR", notes || null, new Date().toISOString());
  res.status(201).json({ id, trip_id, from_member, to_member, amount: Number(amount), currency: currency || "INR", notes, created_at: new Date().toISOString() });
});

app.get("/api/payments/:tripId", (req, res) => {
  res.json(db.prepare("SELECT * FROM payments WHERE trip_id = ? ORDER BY created_at DESC").all(req.params.tripId));
});

app.delete("/api/payments/item/:id", (req, res) => {
  const info = db.prepare("DELETE FROM payments WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "payment not found" });
  res.status(204).end();
});

// ---- Split summary + settlement suggestions for a trip ----------------------
app.get("/api/expenses/:tripId/summary", (req, res) => {
  res.json(computeSummary(req.params.tripId));
});

// ---- Cross-trip balances (Splitwise-style "overall you owe / are owed") ------
app.get("/api/balances", (req, res) => {
  // Aggregate across ALL trips
  const allTrips = [...new Set([
    ...db.prepare("SELECT DISTINCT trip_id FROM expenses").all().map(r => r.trip_id),
    ...db.prepare("SELECT DISTINCT trip_id FROM payments").all().map(r => r.trip_id),
  ])];
  const globalBalances = {};
  const bump = (name, delta) => {
    globalBalances[name] = round2((globalBalances[name] || 0) + delta);
  };

  for (const tripId of allTrips) {
    const summary = computeSummary(tripId);
    for (const [name, val] of Object.entries(summary.balances)) {
      bump(name, val);
    }
  }

  // Simplify global debts
  const settlements = simplifyDebts(globalBalances);

  res.json({ balances: globalBalances, settlements });
});

// ---- Per-trip activity feed (expenses + payments merged chronologically) -----
app.get("/api/activity/:tripId", (req, res) => {
  const expenses = expensesOf(req.params.tripId).map(e => ({ ...e, type: "expense" }));
  const payments = db.prepare("SELECT * FROM payments WHERE trip_id = ? ORDER BY created_at DESC")
    .all(req.params.tripId)
    .map(p => ({ ...p, type: "payment" }));
  const all = [...expenses, ...payments].sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
  res.json(all);
});

// ---- helpers -----------------------------------------------------------------
function computeShares(expense) {
  const amt = expense.amount;
  const parties = expense.split_among;
  const sType = expense.split_type || "equal";
  const sDetails = expense.split_details || {};
  const shares = {};

  if (sType === "unequal") {
    for (const p of parties) shares[p] = Number(sDetails[p]) || 0;
  } else if (sType === "percent") {
    for (const p of parties) shares[p] = round2(amt * (Number(sDetails[p]) || 0) / 100);
  } else {
    // equal
    const share = amt / parties.length;
    for (const p of parties) shares[p] = share;
  }
  return shares;
}

function computeSummary(tripId) {
  const expenses = expensesOf(tripId);
  const payments = db.prepare("SELECT * FROM payments WHERE trip_id = ?").all(tripId);

  const balances = {};
  const bump = (name, delta) => {
    balances[name] = round2((balances[name] || 0) + delta);
  };

  let total = 0;
  const byCategory = {};
  for (const e of expenses) {
    total += e.amount;
    byCategory[e.category] = round2((byCategory[e.category] || 0) + e.amount);
    bump(e.paid_by, e.amount);
    const shares = computeShares(e);
    for (const [p, share] of Object.entries(shares)) bump(p, -share);
  }

  // Apply recorded settlements
  for (const p of payments) {
    bump(p.from_member, p.amount);   // payer reduces their debt
    bump(p.to_member, -p.amount);    // receiver reduces their credit
  }

  const settlements = simplifyDebts(balances);

  return {
    trip_id: tripId,
    total: round2(total),
    expense_count: expenses.length,
    payment_count: payments.length,
    by_category: byCategory,
    balances,
    settlements,
  };
}

function simplifyDebts(balances) {
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0.009)
    .map(([name, v]) => ({ name, amount: v }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -0.009)
    .map(([name, v]) => ({ name, amount: -v }))
    .sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = round2(Math.min(debtors[i].amount, creditors[j].amount));
    if (pay > 0) settlements.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
    debtors[i].amount = round2(debtors[i].amount - pay);
    creditors[j].amount = round2(creditors[j].amount - pay);
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }
  return settlements;
}

function rowToExpense(row) {
  return {
    ...row,
    split_among: JSON.parse(row.split_among),
    split_details: JSON.parse(row.split_details || "{}"),
  };
}
function expensesOf(tripId) {
  return db.prepare("SELECT * FROM expenses WHERE trip_id = ? ORDER BY created_at DESC")
    .all(tripId).map(rowToExpense);
}
function getExpense(id) {
  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
  return row ? rowToExpense(row) : null;
}

app.listen(PORT, () => console.log(`expense-service listening on ${PORT}`));
