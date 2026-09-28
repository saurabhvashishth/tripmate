// All backend calls go through the nginx reverse proxy on the same origin.
const API = {
  trips: "/api/trips",
  expenses: "/api/expenses",
  photos: "/api/photos",
};

let currentTrip = null;

const $ = (sel) => document.querySelector(sel);
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

// ---- Trips -------------------------------------------------------------------
async function loadTrips() {
  const trips = await jget(API.trips);
  const ul = $("#trip-list");
  ul.innerHTML = "";
  trips.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(t.name)} <span class="muted">${escapeHtml(
      t.destination || ""
    )}</span></span><span class="del">✕</span>`;
    li.querySelector("span").onclick = () => openTrip(t);
    li.querySelector(".del").onclick = async (e) => {
      e.stopPropagation();
      await jsend(`${API.trips}/${t.id}`, "DELETE");
      loadTrips();
      if (currentTrip && currentTrip.id === t.id) $("#detail").hidden = true;
    };
    ul.appendChild(li);
  });
}

$("#trip-form").onsubmit = async (e) => {
  e.preventDefault();
  await jsend(API.trips, "POST", {
    name: $("#trip-name").value,
    destination: $("#trip-dest").value,
  });
  e.target.reset();
  loadTrips();
};

// ---- Trip detail -------------------------------------------------------------
async function openTrip(trip) {
  currentTrip = await jget(`${API.trips}/${trip.id}`);
  $("#detail").hidden = false;
  $("#detail-title").textContent = `${currentTrip.name} — ${currentTrip.destination || ""}`;
  renderMembers();
  loadExpenses();
  loadPhotos();
  $("#summary").innerHTML = "";
}

function renderMembers() {
  const ul = $("#member-list");
  ul.innerHTML = "";
  const sel = $("#exp-payer");
  sel.innerHTML = "";
  (currentTrip.members || []).forEach((m) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(m.name)} <span class="muted">${escapeHtml(
      m.email || ""
    )}</span></span>`;
    ul.appendChild(li);
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
}

$("#member-form").onsubmit = async (e) => {
  e.preventDefault();
  await jsend(`${API.trips}/${currentTrip.id}/members`, "POST", {
    name: $("#member-name").value,
    email: $("#member-email").value,
  });
  e.target.reset();
  currentTrip = await jget(`${API.trips}/${currentTrip.id}`);
  renderMembers();
};

// ---- Expenses ----------------------------------------------------------------
async function loadExpenses() {
  const items = await jget(`${API.expenses}/${currentTrip.id}`);
  const ul = $("#expense-list");
  ul.innerHTML = "";
  items.forEach((x) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(x.description)} — <b>${x.amount}</b>
      <span class="muted">paid by ${escapeHtml(x.paid_by)}</span></span>
      <span class="del">✕</span>`;
    li.querySelector(".del").onclick = async () => {
      await jsend(`${API.expenses}/item/${x.id}`, "DELETE");
      loadExpenses();
    };
    ul.appendChild(li);
  });
}

$("#expense-form").onsubmit = async (e) => {
  e.preventDefault();
  const members = (currentTrip.members || []).map((m) => m.name);
  await jsend(API.expenses, "POST", {
    trip_id: currentTrip.id,
    description: $("#exp-desc").value,
    amount: parseFloat($("#exp-amount").value),
    paid_by: $("#exp-payer").value,
    split_among: members,
  });
  e.target.reset();
  loadExpenses();
};

$("#btn-summary").onclick = async () => {
  const s = await jget(`${API.expenses}/${currentTrip.id}/summary`);
  const box = $("#summary");
  const settlements = s.settlements.length
    ? s.settlements
        .map(
          (t) =>
            `<div class="settlement">${escapeHtml(t.from)} pays ${escapeHtml(
              t.to
            )} <b>${t.amount}</b></div>`
        )
        .join("")
    : `<div class="muted">All settled up.</div>`;
  box.innerHTML = `<p class="muted">Total: <b>${s.total}</b> across ${s.expense_count} expenses</p>${settlements}`;
};

// ---- Photos ------------------------------------------------------------------
async function loadPhotos() {
  const items = await jget(`${API.photos}/${currentTrip.id}`);
  const grid = $("#photo-grid");
  grid.innerHTML = "";
  items.forEach((p) => {
    const img = document.createElement("img");
    img.src = p.url;
    img.title = p.key;
    grid.appendChild(img);
  });
}

$("#photo-form").onsubmit = async (e) => {
  e.preventDefault();
  const file = $("#photo-file").files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("photo", file);
  fd.append("caption", $("#photo-caption").value);
  const r = await fetch(`${API.photos}/${currentTrip.id}`, { method: "POST", body: fd });
  if (!r.ok) return alert("Upload failed");
  e.target.reset();
  loadPhotos();
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

loadTrips();
