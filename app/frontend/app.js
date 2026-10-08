// ============================================================================
// TripMate frontend — Splitwise-like, no accounts.
// All backend calls go through the nginx reverse proxy on the same origin.
// ============================================================================
const API = { trips: "/api/trips", expenses: "/api/expenses", photos: "/api/photos", payments: "/api/payments" };

const CURRENCY = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
const CATEGORY_ICON = {
  general: "🧾", food: "🍽️", transport: "🚕", accommodation: "🏨",
  entertainment: "🎉", shopping: "🛍️", groceries: "🛒", drinks: "🍹",
  tickets: "🎟️", fuel: "⛽", medical: "💊", other: "📦",
};

let trips = [];
let currentTrip = null;
let categories = ["general"];

// ---- tiny helpers ----------------------------------------------------------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const sym = (c) => CURRENCY[c] || c + " ";
const money = (n, c) => `${sym(c)}${Math.abs(Number(n)).toFixed(2)}`;
const initials = (name) => name.trim().slice(0, 2).toUpperCase();
const colorFor = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 45%)`;
};

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jsend(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2600);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- modals -----------------------------------------------------------------
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
$$("[data-close]").forEach((b) => (b.onclick = () => b.closest(".modal-overlay").hidden = true));
$$(".modal-overlay").forEach((o) => (o.onclick = (e) => { if (e.target === o) o.hidden = true; }));

// ============================================================================
// Trips list + overall balances
// ============================================================================
async function loadTrips() {
  trips = await jget(API.trips);
  const ul = $("#trip-list");
  ul.innerHTML = "";
  if (!trips.length) {
    ul.innerHTML = `<li class="muted small empty-trips">No trips yet.</li>`;
  }
  trips.forEach((t) => {
    const li = document.createElement("li");
    li.className = "trip-item" + (currentTrip && currentTrip.id === t.id ? " active" : "");
    const memberCount = (t.members || []).length;
    li.innerHTML = `
      <span class="trip-item-emoji">${escapeHtml(t.emoji || "🧳")}</span>
      <span class="trip-item-body">
        <span class="trip-item-name">${escapeHtml(t.name)}</span>
        <span class="muted small">${memberCount} ${memberCount === 1 ? "person" : "people"}${
          t.destination ? " · " + escapeHtml(t.destination) : ""
        }</span>
      </span>`;
    li.onclick = () => openTrip(t.id);
    ul.appendChild(li);
  });
  loadOverall();
}

async function loadOverall() {
  const rows = $("#overall-rows");
  try {
    const data = await jget("/api/balances");
    const entries = Object.entries(data.balances).filter(([, v]) => Math.abs(v) > 0.009);
    if (!entries.length) {
      rows.innerHTML = `<div class="muted small">You're all settled up 🎉</div>`;
      return;
    }
    // Show from the perspective of each named person: net owed / owing
    rows.innerHTML = entries
      .sort((a, b) => b[1] - a[1])
      .map(([name, v]) => {
        const owed = v > 0;
        return `<div class="overall-row">
          <span class="avatar sm" style="background:${colorFor(name)}">${escapeHtml(initials(name))}</span>
          <span class="overall-name">${escapeHtml(name)}</span>
          <span class="amt ${owed ? "pos" : "neg"}">${owed ? "gets back" : "owes"} ${Math.abs(v).toFixed(2)}</span>
        </div>`;
      })
      .join("");
  } catch (_) {
    rows.innerHTML = `<div class="muted small">Add expenses to see balances.</div>`;
  }
}

// ============================================================================
// Open a trip
// ============================================================================
async function openTrip(id) {
  currentTrip = await jget(`${API.trips}/${id}`);
  localStorage.setItem("tm:lastTrip", id);
  history.replaceState(null, "", `#${id}`);

  $("#empty-state").hidden = true;
  $("#trip-detail").hidden = false;

  $("#d-emoji").textContent = currentTrip.emoji || "🧳";
  $("#d-name").textContent = currentTrip.name;
  $("#d-sub").textContent = [currentTrip.destination, sym(currentTrip.currency) + currentTrip.currency]
    .filter(Boolean).join(" · ");

  renderMembers();
  switchTab("expenses");
  loadActivity();
  loadTrips(); // refresh active highlight + counts
}

function renderMembers() {
  const strip = $("#members-strip");
  const members = currentTrip.members || [];
  strip.innerHTML = members
    .map(
      (m) => `<span class="member-chip">
        <span class="avatar sm" style="background:${colorFor(m.name)}">${escapeHtml(initials(m.name))}</span>
        ${escapeHtml(m.name)}
        <span class="chip-x" data-mid="${m.id}" title="Remove">✕</span>
      </span>`
    )
    .join("") +
    `<button class="member-add" id="btn-add-member">＋ Add person</button>`;

  $("#btn-add-member").onclick = async () => {
    const name = prompt("Name of the person to add:");
    if (!name || !name.trim()) return;
    await jsend(`${API.trips}/${currentTrip.id}/members`, "POST", { name: name.trim() });
    currentTrip = await jget(`${API.trips}/${currentTrip.id}`);
    renderMembers();
    toast("Added " + name.trim());
  };
  strip.querySelectorAll(".chip-x").forEach((x) => {
    x.onclick = async () => {
      if (!confirm("Remove this person from the trip?")) return;
      await jsend(`${API.trips}/${currentTrip.id}/members/${x.dataset.mid}`, "DELETE");
      currentTrip = await jget(`${API.trips}/${currentTrip.id}`);
      renderMembers();
    };
  });
}

// ============================================================================
// Tabs
// ============================================================================
function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name === "balances") loadBalances();
  if (name === "photos") loadPhotos();
}
$$(".tab").forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));

// ============================================================================
// Activity feed (expenses + payments)
// ============================================================================
async function loadActivity() {
  const feed = $("#activity-feed");
  const items = await jget(`/api/activity/${currentTrip.id}`);
  const cur = currentTrip.currency;
  if (!items.length) {
    feed.innerHTML = `<div class="muted empty-feed">No expenses yet. Add the first one!</div>`;
    return;
  }
  feed.innerHTML = items
    .map((it) => (it.type === "payment" ? paymentRow(it, cur) : expenseRow(it, cur)))
    .join("");

  feed.querySelectorAll("[data-del-exp]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      await jsend(`${API.expenses}/item/${b.dataset.delExp}`, "DELETE");
      loadActivity(); loadOverall();
      toast("Expense deleted");
    };
  });
  feed.querySelectorAll("[data-del-pay]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      await jsend(`${API.payments}/item/${b.dataset.delPay}`, "DELETE");
      loadActivity(); loadOverall();
      toast("Payment removed");
    };
  });
}

function expenseRow(e, cur) {
  const icon = CATEGORY_ICON[e.category] || CATEGORY_ICON.general;
  const splitNote = e.split_type === "equal"
    ? `split equally among ${e.split_among.length}`
    : `${e.split_type} split`;
  return `<div class="feed-row">
    <span class="feed-icon">${icon}</span>
    <div class="feed-body">
      <div class="feed-top">
        <span class="feed-desc">${escapeHtml(e.description)}</span>
        <span class="feed-amt">${money(e.amount, cur)}</span>
      </div>
      <div class="muted small">
        <b>${escapeHtml(e.paid_by)}</b> paid · ${splitNote}
      </div>
    </div>
    <span class="feed-del" data-del-exp="${e.id}" title="Delete">🗑</span>
  </div>`;
}

function paymentRow(p, cur) {
  return `<div class="feed-row payment">
    <span class="feed-icon">💸</span>
    <div class="feed-body">
      <div class="feed-top">
        <span class="feed-desc"><b>${escapeHtml(p.from_member)}</b> paid <b>${escapeHtml(p.to_member)}</b></span>
        <span class="feed-amt pos">${money(p.amount, cur)}</span>
      </div>
      <div class="muted small">Settlement payment</div>
    </div>
    <span class="feed-del" data-del-pay="${p.id}" title="Remove">🗑</span>
  </div>`;
}

// ============================================================================
// Balances tab
// ============================================================================
async function loadBalances() {
  const s = await jget(`${API.expenses}/${currentTrip.id}/summary`);
  const cur = currentTrip.currency;

  // Balance bars
  const box = $("#balance-summary");
  const entries = Object.entries(s.balances);
  const max = Math.max(1, ...entries.map(([, v]) => Math.abs(v)));
  box.innerHTML =
    `<div class="total-line">Total trip spending: <b>${money(s.total, cur)}</b>
       <span class="muted small">· ${s.expense_count} expenses</span></div>` +
    (entries.length
      ? entries
          .sort((a, b) => b[1] - a[1])
          .map(([name, v]) => {
            const pct = (Math.abs(v) / max) * 100;
            const owed = v > 0;
            const settled = Math.abs(v) < 0.01;
            return `<div class="bal-row">
              <span class="avatar sm" style="background:${colorFor(name)}">${escapeHtml(initials(name))}</span>
              <span class="bal-name">${escapeHtml(name)}</span>
              <span class="bal-bar"><span class="bal-fill ${owed ? "pos" : "neg"}" style="width:${pct}%"></span></span>
              <span class="amt ${settled ? "muted" : owed ? "pos" : "neg"}">
                ${settled ? "settled" : (owed ? "+" : "−") + money(v, cur)}
              </span>
            </div>`;
          })
          .join("")
      : `<div class="muted">No balances yet.</div>`);

  // Settlements
  const set = $("#settlements");
  if (!s.settlements.length) {
    set.innerHTML = `<div class="all-settled">🎉 Everyone is settled up!</div>`;
  } else {
    set.innerHTML = s.settlements
      .map(
        (t) => `<div class="settle-row">
          <span class="avatar sm" style="background:${colorFor(t.from)}">${escapeHtml(initials(t.from))}</span>
          <span class="settle-text"><b>${escapeHtml(t.from)}</b> owes <b>${escapeHtml(t.to)}</b></span>
          <span class="settle-amt neg">${money(t.amount, cur)}</span>
          <button class="mini" data-sfrom="${escapeHtml(t.from)}" data-sto="${escapeHtml(t.to)}" data-samt="${t.amount}">Settle</button>
        </div>`
      )
      .join("");
    set.querySelectorAll(".mini").forEach((b) => {
      b.onclick = () => openSettle(b.dataset.sfrom, b.dataset.sto, b.dataset.samt);
    });
  }

  // Categories
  const cats = $("#categories");
  const catEntries = Object.entries(s.by_category || {}).sort((a, b) => b[1] - a[1]);
  cats.innerHTML = catEntries.length
    ? catEntries
        .map(
          ([cat, amt]) => `<div class="cat-row">
            <span class="feed-icon">${CATEGORY_ICON[cat] || CATEGORY_ICON.general}</span>
            <span class="cat-name">${escapeHtml(cat)}</span>
            <span class="amt">${money(amt, cur)}</span>
          </div>`
        )
        .join("")
    : `<div class="muted small">No spending logged.</div>`;
}

// ============================================================================
// New / edit trip
// ============================================================================
function openTripModal() {
  $("#trip-modal-title").textContent = "New trip";
  $("#trip-form").reset();
  $("#trip-emoji").value = "🧳";
  openModal("#trip-modal");
}
$("#btn-new-trip").onclick = openTripModal;
$("#btn-new-trip-2").onclick = openTripModal;

$("#trip-form").onsubmit = async (e) => {
  e.preventDefault();
  const members = $("#trip-members").value
    .split(",").map((s) => s.trim()).filter(Boolean);
  const trip = await jsend(API.trips, "POST", {
    name: $("#trip-name").value.trim(),
    destination: $("#trip-dest").value.trim(),
    currency: $("#trip-currency").value,
    emoji: $("#trip-emoji").value.trim() || "🧳",
    members,
  });
  closeModal("#trip-modal");
  await loadTrips();
  openTrip(trip.id);
  toast("Trip created");
};

$("#btn-del-trip").onclick = async () => {
  if (!currentTrip) return;
  if (!confirm(`Delete "${currentTrip.name}"? This removes its expenses too.`)) return;
  await jsend(`${API.trips}/${currentTrip.id}`, "DELETE");
  currentTrip = null;
  $("#trip-detail").hidden = true;
  $("#empty-state").hidden = false;
  localStorage.removeItem("tm:lastTrip");
  loadTrips();
  toast("Trip deleted");
};

$("#btn-share").onclick = async () => {
  const url = location.origin + "/#" + currentTrip.id;
  try {
    await navigator.clipboard.writeText(url);
    toast("Trip link copied");
  } catch (_) {
    prompt("Copy this link:", url);
  }
};

// ============================================================================
// Add expense (with split editor)
// ============================================================================
async function loadCategories() {
  try { categories = await jget(`${API.expenses}/categories`); } catch (_) {}
  $("#exp-category").innerHTML = categories
    .map((c) => `<option value="${c}">${CATEGORY_ICON[c] || "🧾"} ${c}</option>`)
    .join("");
}

$("#btn-add-expense").onclick = () => {
  if (!currentTrip || !(currentTrip.members || []).length) {
    toast("Add at least one person first");
    return;
  }
  $("#expense-form").reset();
  const members = currentTrip.members.map((m) => m.name);
  $("#exp-payer").innerHTML = members.map((n) => `<option>${escapeHtml(n)}</option>`).join("");
  $("#exp-split-type").value = "equal";
  renderSplitEditor();
  openModal("#expense-modal");
};

$("#exp-split-type").onchange = renderSplitEditor;
$("#exp-amount").oninput = () => {
  if ($("#exp-split-type").value !== "equal") renderSplitEditor(true);
};

function renderSplitEditor(keepValues) {
  const type = $("#exp-split-type").value;
  const ed = $("#split-editor");
  const members = currentTrip.members.map((m) => m.name);

  if (type === "equal") {
    ed.innerHTML = `<div class="muted small">Split equally among all ${members.length} members.</div>`;
    return;
  }
  const prev = {};
  if (keepValues) ed.querySelectorAll("input").forEach((i) => (prev[i.dataset.name] = i.value));

  const label = type === "percent" ? "%" : sym(currentTrip.currency);
  ed.innerHTML =
    `<div class="muted small split-hint">${
      type === "percent" ? "Percentages must total 100." : "Amounts must total the expense."
    }</div>` +
    members
      .map(
        (n) => `<div class="split-line">
          <span class="avatar sm" style="background:${colorFor(n)}">${escapeHtml(initials(n))}</span>
          <span class="split-name">${escapeHtml(n)}</span>
          <span class="split-input"><span class="split-prefix">${label}</span>
            <input type="number" step="0.01" min="0" data-name="${escapeHtml(n)}" value="${prev[n] || ""}" />
          </span>
        </div>`
      )
      .join("") +
    `<div class="split-total" id="split-total"></div>`;

  ed.querySelectorAll("input").forEach((i) => (i.oninput = updateSplitTotal));
  updateSplitTotal();
}

function updateSplitTotal() {
  const type = $("#exp-split-type").value;
  const total = $("#split-total");
  if (!total) return;
  const sum = Array.from($("#split-editor").querySelectorAll("input"))
    .reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
  const target = type === "percent" ? 100 : parseFloat($("#exp-amount").value) || 0;
  const ok = Math.abs(sum - target) < 0.02;
  total.innerHTML = `<span class="${ok ? "pos" : "neg"}">${sum.toFixed(2)} / ${target.toFixed(2)}${
    type === "percent" ? "%" : ""
  }</span>`;
}

$("#expense-form").onsubmit = async (e) => {
  e.preventDefault();
  const type = $("#exp-split-type").value;
  const members = currentTrip.members.map((m) => m.name);
  const amount = parseFloat($("#exp-amount").value);

  const payload = {
    trip_id: currentTrip.id,
    description: $("#exp-desc").value.trim(),
    amount,
    currency: currentTrip.currency,
    category: $("#exp-category").value,
    paid_by: $("#exp-payer").value,
    split_type: type,
    split_among: members,
  };

  if (type !== "equal") {
    const details = {};
    $("#split-editor").querySelectorAll("input").forEach((i) => {
      const v = parseFloat(i.value) || 0;
      if (v > 0) details[i.dataset.name] = v;
    });
    payload.split_among = Object.keys(details);
    payload.split_details = details;
    if (!payload.split_among.length) return toast("Enter at least one split value");
  }

  try {
    await jsend(API.expenses, "POST", payload);
    closeModal("#expense-modal");
    loadActivity(); loadOverall();
    toast("Expense added");
  } catch (err) {
    toast(String(err.message || err).slice(0, 120));
  }
};

// ============================================================================
// Settle up
// ============================================================================
function openSettle(from, to, amount) {
  const members = currentTrip.members.map((m) => m.name);
  const opts = members.map((n) => `<option>${escapeHtml(n)}</option>`).join("");
  $("#settle-from").innerHTML = opts;
  $("#settle-to").innerHTML = opts;
  if (from) $("#settle-from").value = from;
  if (to) $("#settle-to").value = to;
  if (amount) $("#settle-amount").value = Number(amount).toFixed(2);
  openModal("#settle-modal");
}

$("#settle-form").onsubmit = async (e) => {
  e.preventDefault();
  const from = $("#settle-from").value;
  const to = $("#settle-to").value;
  if (from === to) return toast("Pick two different people");
  await jsend(API.payments, "POST", {
    trip_id: currentTrip.id,
    from_member: from,
    to_member: to,
    amount: parseFloat($("#settle-amount").value),
    currency: currentTrip.currency,
  });
  closeModal("#settle-modal");
  loadBalances(); loadActivity(); loadOverall();
  toast("Payment recorded");
};

// ============================================================================
// Photos
// ============================================================================
async function loadPhotos() {
  const grid = $("#photo-grid");
  try {
    const items = await jget(`${API.photos}/${currentTrip.id}`);
    grid.innerHTML = items.length
      ? items.map((p) => `<a href="${p.url}" target="_blank" rel="noopener">
          <img src="${p.url}" alt="trip photo" loading="lazy" /></a>`).join("")
      : `<div class="muted small">No photos yet. Upload your first trip memory!</div>`;
  } catch (_) {
    grid.innerHTML = `<div class="muted small">Photos unavailable.</div>`;
  }
}

$("#photo-form").onsubmit = async (e) => {
  e.preventDefault();
  const file = $("#photo-file").files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("photo", file);
  fd.append("caption", $("#photo-caption").value);
  const r = await fetch(`${API.photos}/${currentTrip.id}`, { method: "POST", body: fd });
  if (!r.ok) return toast("Upload failed");
  e.target.reset();
  loadPhotos();
  toast("Photo uploaded");
};

$("#btn-add-expense");

// ============================================================================
// Boot
// ============================================================================
(async function init() {
  await loadCategories();
  await loadTrips();
  const fromHash = location.hash.slice(1);
  const last = fromHash || localStorage.getItem("tm:lastTrip");
  if (last && trips.some((t) => t.id === last)) {
    openTrip(last);
  }
})();
