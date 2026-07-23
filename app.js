/* =====================================================================
   IL FANTAPROF — app.js
   ---------------------------------------------------------------------
   PRIMA DI USARE L'APP:
   1) Crea un progetto gratuito su https://console.firebase.google.com
   2) Attiva "Realtime Database" (modalità test o con le regole in fondo
      a questo file, in un commento).
   3) Copia la configurazione del tuo progetto qui sotto in
      `firebaseConfig`, al posto dei valori segnaposto.
   4) Apri index.html: al primissimo avvio (database vuoto) l'app ti
      chiederà di creare l'account amministratore. Da lì potrai
      aggiungere il listino professori e gli account degli studenti dal
      Pannello Admin.

   L'app NON tocca mai i dati salvati nel database quando modifichi
   grafica o codice: tutto lo stato di gioco vive solo su Firebase.
===================================================================== */

const firebaseConfig = {
  apiKey: "INSERISCI_LA_TUA_API_KEY",
  authDomain: "INSERISCI_IL_TUO_PROGETTO.firebaseapp.com",
  databaseURL: "https://INSERISCI_IL_TUO_PROGETTO-default-rtdb.firebaseio.com",
  projectId: "INSERISCI_IL_TUO_PROGETTO",
  storageBucket: "INSERISCI_IL_TUO_PROGETTO.appspot.com",
  messagingSenderId: "INSERISCI_ID",
  appId: "INSERISCI_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* ---------------------------------------------------------------------
   STATO LOCALE (rispecchia il database in tempo reale)
--------------------------------------------------------------------- */
const state = {
  students: {},     // { studentId: {username,password,name,teamName,photoUrl,isAdmin,roster:[],captainId,rosterLocked,lastCaptainChange} }
  professors: {},    // { profId: {name,subject,price,points} }
  events: {},        // { eventId: {profId,profName,points,description,timestamp} }
  settings: { marketOverrideOpen: false },
  currentUserId: null,
  ready: { students: false, professors: false, events: false, settings: false }
};

/* ---------------------------------------------------------------------
   UTILITY
--------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const DEFAULT_AVATAR = "https://api.dicebear.com/7.x/thumbs/svg?seed=";

function fallbackAvatar(seed) {
  return DEFAULT_AVATAR + encodeURIComponent(seed || "fantaprof");
}

function showScreen(id) {
  ["loginScreen", "setupScreen", "appShell", "adminShell"].forEach((s) => {
    $("#" + s).classList.toggle("hidden", s !== id);
  });
}

function studentTotalPoints(student) {
  if (!student || !student.roster) return 0;
  let total = 0;
  student.roster.forEach((profId) => {
    const prof = state.professors[profId];
    if (!prof) return;
    const pts = prof.points || 0;
    total += profId === student.captainId ? pts * 2 : pts;
  });
  return total;
}

function isFirstDayOfMonth() {
  return new Date().getDate() === 1;
}

function captainWindowOpen() {
  return isFirstDayOfMonth() || !!state.settings.marketOverrideOpen;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------------------------------------------------------------------
   LISTENERS FIREBASE — tengono lo stato locale sincronizzato
--------------------------------------------------------------------- */
db.ref("students").on("value", (snap) => {
  state.students = snap.val() || {};
  state.ready.students = true;
  onDataChanged();
});
db.ref("professors").on("value", (snap) => {
  state.professors = snap.val() || {};
  state.ready.professors = true;
  onDataChanged();
});
db.ref("events").on("value", (snap) => {
  state.events = snap.val() || {};
  state.ready.events = true;
  onDataChanged();
});
db.ref("settings").on("value", (snap) => {
  state.settings = snap.val() || { marketOverrideOpen: false };
  state.ready.settings = true;
  onDataChanged();
});

let bootDone = false;
function onDataChanged() {
  if (!Object.values(state.ready).every(Boolean)) return;

  if (!bootDone) {
    bootDone = true;
    boot();
  } else {
    // ri-renderizza le viste correnti se già loggati
    if (state.currentUserId) {
      renderAll();
    }
  }
}

function boot() {
  const hasStudents = Object.keys(state.students).length > 0;
  if (!hasStudents) {
    showScreen("setupScreen");
    return;
  }
  const savedId = sessionStorage.getItem("fantaprof_uid");
  if (savedId && state.students[savedId]) {
    state.currentUserId = savedId;
    enterApp();
  } else {
    showScreen("loginScreen");
  }
}

/* ---------------------------------------------------------------------
   SETUP INIZIALE (creazione primo account admin)
--------------------------------------------------------------------- */
$("#setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#setupUsername").value.trim();
  const password = $("#setupPassword").value;
  const errEl = $("#setupError");
  errEl.classList.add("hidden");

  if (!username || !password) return;

  try {
    const newRef = db.ref("students").push();
    await newRef.set({
      username, password,
      name: "Amministratore",
      teamName: "Staff",
      photoUrl: "",
      isAdmin: true,
      roster: [],
      captainId: null,
      rosterLocked: false,
      lastCaptainChange: 0
    });
    await db.ref("settings").set({ marketOverrideOpen: false });
    state.currentUserId = newRef.key;
    sessionStorage.setItem("fantaprof_uid", newRef.key);
  } catch (err) {
    errEl.textContent = "Errore durante la creazione: " + err.message;
    errEl.classList.remove("hidden");
  }
});

/* ---------------------------------------------------------------------
   LOGIN / LOGOUT
--------------------------------------------------------------------- */
$("#loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const username = $("#loginUsername").value.trim();
  const password = $("#loginPassword").value;
  const errEl = $("#loginError");
  errEl.classList.add("hidden");

  const entry = Object.entries(state.students).find(
    ([, s]) => s.username === username && s.password === password
  );

  if (!entry) {
    errEl.textContent = "Nome utente o password non corretti.";
    errEl.classList.remove("hidden");
    return;
  }

  state.currentUserId = entry[0];
  sessionStorage.setItem("fantaprof_uid", entry[0]);
  enterApp();
});

function logout() {
  state.currentUserId = null;
  sessionStorage.removeItem("fantaprof_uid");
  $("#loginForm").reset();
  showScreen("loginScreen");
}
$("#btnLogout").addEventListener("click", logout);
$("#btnAdminLogout").addEventListener("click", logout);

function enterApp() {
  const me = state.students[state.currentUserId];
  if (!me) { showScreen("loginScreen"); return; }
  $("#btnAdminPanel").classList.toggle("hidden", !me.isAdmin);
  showScreen("appShell");
  renderAll();
}

$("#btnAdminPanel").addEventListener("click", () => { showScreen("adminShell"); renderAdmin(); });
$("#btnBackToApp").addEventListener("click", () => { showScreen("appShell"); renderAll(); });

/* ---------------------------------------------------------------------
   TAB NAVIGATION (studente)
--------------------------------------------------------------------- */
$$(".tabbar [data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tabbar [data-tab]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $$("#appShell .tab-panel").forEach((p) => p.classList.remove("active"));
    $("#tab-" + btn.dataset.tab).classList.add("active");
  });
});

/* TAB NAVIGATION (admin) */
$$(".tabbar [data-admintab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tabbar [data-admintab]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $$("#adminShell .tab-panel").forEach((p) => p.classList.remove("active"));
    $("#admin-" + btn.dataset.admintab).classList.add("active");
  });
});

/* =====================================================================
   RENDER — VISTA STUDENTE
===================================================================== */
function renderAll() {
  const me = state.students[state.currentUserId];
  if (!me) return;

  renderTopbar(me);
  renderNewsBanner();

  if (me.rosterLocked) {
    $("#rosterLockedView").classList.remove("hidden");
    $("#rosterBuilderView").classList.add("hidden");
    renderLockedRoster(me);
  } else {
    $("#rosterLockedView").classList.add("hidden");
    $("#rosterBuilderView").classList.remove("hidden");
    renderRosterBuilder(me);
  }

  renderStudentRanking();
  renderProfRanking();
}

function renderTopbar(me) {
  $("#topbarAvatar").src = me.photoUrl || fallbackAvatar(me.username);
  $("#topbarTeamName").textContent = me.teamName || "—";
  $("#topbarStudentName").textContent = me.name || "—";
}

function renderNewsBanner() {
  const list = Object.entries(state.events).sort((a, b) => b[1].timestamp - a[1].timestamp);
  const banner = $("#newsBanner");
  if (!list.length) { banner.classList.add("hidden"); return; }
  const [, latest] = list[0];
  const sign = latest.points > 0 ? "+" : "";
  $("#newsText").textContent = `OGGI: Prof. ${latest.profName} ${sign}${latest.points} (${latest.description})`;
  banner.classList.remove("hidden");
}

function renderLockedRoster(me) {
  $("#myAvatarBig").src = me.photoUrl || fallbackAvatar(me.username);
  $("#myTeamName").textContent = me.teamName || "—";
  $("#myStudentName").textContent = me.name || "—";
  $("#myTotalPoints").textContent = studentTotalPoints(me);

  const bannerEl = $("#captainWindowBanner");
  const open = captainWindowOpen();
  bannerEl.className = "captain-banner " + (open ? "open" : "closed");
  bannerEl.textContent = open
    ? "⭐ Mercato Capitano APERTO — puoi cambiare il capitano"
    : "🔒 Mercato Capitano CHIUSO — riapre il 1° del mese";

  const grid = $("#myRosterGrid");
  grid.innerHTML = "";
  (me.roster || []).forEach((profId) => {
    const prof = state.professors[profId];
    if (!prof) return;
    const isCaptain = me.captainId === profId;
    const card = document.createElement("div");
    card.className = "prof-card" + (isCaptain ? " captain" : "");
    const pts = prof.points || 0;
    card.innerHTML = `
      <div class="prof-card-top">
        <div>
          <p class="prof-name">${prof.name}</p>
          <p class="prof-subject">${prof.subject}</p>
        </div>
        <button class="star-btn ${isCaptain ? "gold" : ""}" data-prof="${profId}" ${open ? "" : "disabled"}>
          ${isCaptain ? "⭐" : "☆"}
        </button>
      </div>
      <div class="prof-card-footer">
        <span class="prof-points ${pts >= 0 ? "pos" : "neg"}">${pts >= 0 ? "+" : ""}${pts} pt</span>
        ${isCaptain ? '<span class="prof-price">x2</span>' : ""}
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleLockedCaptain(btn.dataset.prof));
  });
}

async function toggleLockedCaptain(profId) {
  if (!captainWindowOpen()) return;
  const me = state.students[state.currentUserId];
  const newCaptain = me.captainId === profId ? null : profId;
  await db.ref(`students/${state.currentUserId}`).update({
    captainId: newCaptain,
    lastCaptainChange: Date.now()
  });
}

/* ---------------------------------------------------------------------
   COSTRUZIONE ROSA (primo mercato, prima del blocco)
--------------------------------------------------------------------- */
let builderPicks = new Set();
let builderCaptain = null;

function renderRosterBuilder(me) {
  builderPicks = new Set(me.roster || []);
  builderCaptain = me.captainId || null;
  drawBuilder();
}

function drawBuilder() {
  const grid = $("#marketGrid");
  grid.innerHTML = "";

  const spent = [...builderPicks].reduce((sum, id) => sum + (state.professors[id]?.price || 0), 0);
  const count = builderPicks.size;

  $("#budgetSpent").textContent = spent;
  $("#pickedCount").textContent = count;
  const fill = $("#budgetBarFill");
  fill.style.width = Math.min(100, (spent / 100) * 100) + "%";
  fill.classList.toggle("over", spent > 100);

  const errEl = $("#rosterError");
  let error = "";
  if (count > 6) error = "Puoi selezionare al massimo 6 professori.";
  else if (spent > 100) error = "Hai superato il budget di 100 FantaCrediti.";
  if (error) { errEl.textContent = error; errEl.classList.remove("hidden"); }
  else errEl.classList.add("hidden");

  const canSave = count === 6 && spent <= 100 && !!builderCaptain && !error;
  $("#btnSaveRoster").disabled = !canSave;

  Object.entries(state.professors).forEach(([id, prof]) => {
    const picked = builderPicks.has(id);
    const isCaptain = builderCaptain === id;
    const disablePick = !picked && count >= 6;

    const card = document.createElement("div");
    card.className = "prof-card" + (picked ? " selected" : "") + (isCaptain ? " captain" : "") + (disablePick ? " disabled" : "");
    card.innerHTML = `
      <div class="prof-card-top">
        <div>
          <p class="prof-name">${prof.name}</p>
          <p class="prof-subject">${prof.subject}</p>
        </div>
        <button class="star-btn ${isCaptain ? "gold" : ""}" data-prof="${id}" ${picked ? "" : "disabled"}>
          ${isCaptain ? "⭐" : "☆"}
        </button>
      </div>
      <div class="prof-card-footer">
        <span class="prof-price">${prof.price} crediti</span>
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" class="pick-checkbox" data-prof="${id}" ${picked ? "checked" : ""} ${disablePick ? "disabled" : ""}>
        </label>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".pick-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.prof;
      if (cb.checked) builderPicks.add(id);
      else {
        builderPicks.delete(id);
        if (builderCaptain === id) builderCaptain = null;
      }
      drawBuilder();
    });
  });

  grid.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.prof;
      builderCaptain = builderCaptain === id ? null : id;
      drawBuilder();
    });
  });
}

$("#btnSaveRoster").addEventListener("click", async () => {
  if (builderPicks.size !== 6 || !builderCaptain) return;
  await db.ref(`students/${state.currentUserId}`).update({
    roster: [...builderPicks],
    captainId: builderCaptain,
    rosterLocked: true,
    lastCaptainChange: Date.now()
  });
});

/* ---------------------------------------------------------------------
   CLASSIFICHE
--------------------------------------------------------------------- */
function assignRanks(items, getPoints) {
  // items già ordinati per punti decrescenti
  let rank = 0, lastPoints = null, seen = 0;
  return items.map((item) => {
    seen++;
    const pts = getPoints(item);
    if (pts !== lastPoints) { rank = seen; lastPoints = pts; }
    return { item, rank, pts };
  });
}

function renderStudentRanking() {
  const list = Object.entries(state.students)
    .filter(([, s]) => s.rosterLocked && !s.isAdmin)
    .map(([id, s]) => ({ id, s, pts: studentTotalPoints(s) }))
    .sort((a, b) => b.pts - a.pts);

  const ranked = assignRanks(list, (x) => x.pts);
  const el = $("#studentRanking");
  el.innerHTML = "";
  if (!ranked.length) {
    el.innerHTML = '<p class="muted">Nessuna squadra ancora schierata.</p>';
    return;
  }
  ranked.forEach(({ item, rank, pts }) => {
    const { id, s } = item;
    const row = document.createElement("div");
    row.className = "ranking-row clickable";
    const topClass = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";
    row.innerHTML = `
      <div class="rank-pos ${topClass}">#${rank}</div>
      <img class="avatar avatar-sm" src="${s.photoUrl || fallbackAvatar(s.username)}" alt="">
      <div class="rank-main"><strong>${s.teamName}</strong><span>${s.name}</span></div>
      <div class="rank-points">${pts}</div>
    `;
    row.addEventListener("click", () => openProfileModal(id));
    el.appendChild(row);
  });
}

function renderProfRanking() {
  const list = Object.entries(state.professors)
    .map(([id, p]) => ({ id, p }))
    .sort((a, b) => (b.p.points || 0) - (a.p.points || 0));
  const ranked = assignRanks(list, (x) => x.p.points || 0);

  const el = $("#profRanking");
  el.innerHTML = "";
  if (!ranked.length) {
    el.innerHTML = '<p class="muted">Nessun professore nel listino.</p>';
    return;
  }
  ranked.forEach(({ item, rank, pts }) => {
    const { p } = item;
    const row = document.createElement("div");
    row.className = "ranking-row";
    const topClass = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";
    row.innerHTML = `
      <div class="rank-pos ${topClass}">#${rank}</div>
      <div class="rank-main"><strong>${p.name}</strong><span>${p.subject}</span></div>
      <div class="rank-points">${pts}</div>
    `;
    el.appendChild(row);
  });
}

/* ---------------------------------------------------------------------
   MODAL PROFILO COMPAGNO
--------------------------------------------------------------------- */
function openProfileModal(studentId) {
  const s = state.students[studentId];
  if (!s) return;
  $("#modalAvatar").src = s.photoUrl || fallbackAvatar(s.username);
  $("#modalTeamName").textContent = s.teamName;
  $("#modalStudentName").textContent = s.name;
  $("#modalTotalPoints").textContent = studentTotalPoints(s);

  const grid = $("#modalRosterGrid");
  grid.innerHTML = "";
  (s.roster || []).forEach((profId) => {
    const prof = state.professors[profId];
    if (!prof) return;
    const isCaptain = s.captainId === profId;
    const pts = prof.points || 0;
    const card = document.createElement("div");
    card.className = "prof-card" + (isCaptain ? " captain" : "");
    card.innerHTML = `
      <div class="prof-card-top">
        <div>
          <p class="prof-name">${prof.name}</p>
          <p class="prof-subject">${prof.subject}</p>
        </div>
        <span class="star-btn ${isCaptain ? "gold" : ""}">${isCaptain ? "⭐" : "☆"}</span>
      </div>
      <div class="prof-card-footer">
        <span class="prof-points ${pts >= 0 ? "pos" : "neg"}">${pts >= 0 ? "+" : ""}${pts} pt</span>
      </div>
    `;
    grid.appendChild(card);
  });

  $("#profileModal").classList.remove("hidden");
}
$("#closeProfileModal").addEventListener("click", () => $("#profileModal").classList.add("hidden"));
$("#profileModal").addEventListener("click", (e) => {
  if (e.target.id === "profileModal") $("#profileModal").classList.add("hidden");
});

/* =====================================================================
   PANNELLO ADMIN
===================================================================== */
function renderAdmin() {
  renderAdminPointsForm();
  renderAdminMarket();
  renderAdminStudents();
  renderAdminProfs();
  renderAdminHistory();
}

/* --- Assegnazione punti --- */
function renderAdminPointsForm() {
  const sel = $("#pointsProf");
  sel.innerHTML = Object.entries(state.professors)
    .map(([id, p]) => `<option value="${id}">${p.name} — ${p.subject}</option>`)
    .join("");
}

$("#pointsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const profId = $("#pointsProf").value;
  const points = parseInt($("#pointsValue").value, 10);
  const description = $("#pointsDesc").value.trim();
  if (!profId || Number.isNaN(points) || !description) return;

  const prof = state.professors[profId];
  const newTotal = (prof.points || 0) + points;

  const eventRef = db.ref("events").push();
  await eventRef.set({
    profId, profName: prof.name, points, description, timestamp: Date.now()
  });
  await db.ref(`professors/${profId}/points`).set(newTotal);

  $("#pointsForm").reset();
});

/* --- Mercato straordinario --- */
function renderAdminMarket() {
  const open = !!state.settings.marketOverrideOpen;
  $("#marketToggle").checked = open;
  $("#marketStatusLabel").innerHTML = `Mercato straordinario: <strong>${open ? "aperto" : "chiuso"}</strong>`;
}
$("#marketToggle").addEventListener("change", async (e) => {
  await db.ref("settings/marketOverrideOpen").set(e.target.checked);
});

/* --- Gestione studenti --- */
$("#addStudentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#newStudentUsername").value.trim();
  const password = $("#newStudentPassword").value.trim();
  const name = $("#newStudentName").value.trim();
  const teamName = $("#newStudentTeam").value.trim();
  const photoUrl = $("#newStudentPhoto").value.trim();
  if (!username || !password || !name || !teamName) return;

  const exists = Object.values(state.students).some((s) => s.username === username);
  if (exists) { alert("Esiste già uno studente con questo nome utente."); return; }

  await db.ref("students").push().set({
    username, password, name, teamName, photoUrl,
    isAdmin: false, roster: [], captainId: null, rosterLocked: false, lastCaptainChange: 0
  });
  $("#addStudentForm").reset();
});

function renderAdminStudents() {
  const sel = $("#resetPasswordStudent");
  sel.innerHTML = Object.entries(state.students)
    .map(([id, s]) => `<option value="${id}">${s.name} (@${s.username})</option>`)
    .join("");

  const list = $("#studentsAdminList");
  list.innerHTML = "";
  Object.entries(state.students).forEach(([id, s]) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <img class="avatar avatar-sm" src="${s.photoUrl || fallbackAvatar(s.username)}" alt="">
      <div class="admin-row-main">
        <strong>${s.name}${s.isAdmin ? " · Admin" : ""}</strong>
        <span>@${s.username} — ${s.teamName || "—"} ${s.rosterLocked ? "· rosa bloccata" : "· rosa da completare"}</span>
      </div>
      ${!s.isAdmin ? `<button class="btn btn-danger btn-sm" data-del="${id}">Elimina</button>` : ""}
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("Eliminare definitivamente questo studente?")) {
        await db.ref(`students/${btn.dataset.del}`).remove();
      }
    });
  });
}

$("#resetPasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#resetPasswordStudent").value;
  const newPass = $("#resetPasswordValue").value.trim();
  if (!id || !newPass) return;
  await db.ref(`students/${id}/password`).set(newPass);
  $("#resetPasswordForm").reset();
  alert("Password aggiornata.");
});

/* --- Listino professori --- */
$("#addProfForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#newProfName").value.trim();
  const subject = $("#newProfSubject").value.trim();
  const price = parseInt($("#newProfPrice").value, 10);
  if (!name || !subject || !price) return;

  await db.ref("professors").push().set({ name, subject, price, points: 0 });
  $("#addProfForm").reset();
});

function renderAdminProfs() {
  const list = $("#profsAdminList");
  list.innerHTML = "";
  Object.entries(state.professors).forEach(([id, p]) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div class="admin-row-main">
        <strong>${p.name}</strong>
        <span>${p.subject} — ${p.price} crediti — ${p.points || 0} pt totali</span>
      </div>
      <button class="btn btn-danger btn-sm" data-delprof="${id}">Elimina</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("[data-delprof]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("Eliminare questo professore dal listino? (sconsigliato se già scelto da qualcuno)")) {
        await db.ref(`professors/${btn.dataset.delprof}`).remove();
      }
    });
  });
}

/* --- Storico eventi + rollback --- */
function renderAdminHistory() {
  const list = $("#eventsHistoryList");
  list.innerHTML = "";
  const entries = Object.entries(state.events).sort((a, b) => b[1].timestamp - a[1].timestamp);
  if (!entries.length) {
    list.innerHTML = '<p class="muted">Nessun evento registrato.</p>';
    return;
  }
  entries.forEach(([id, ev]) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const pos = ev.points >= 0;
    row.innerHTML = `
      <div class="history-main">
        <strong>${ev.profName} <span class="history-points" style="color:${pos ? "var(--green)" : "var(--red)"}">${pos ? "+" : ""}${ev.points}</span></strong>
        <p>${ev.description}</p>
      </div>
      <span class="history-date">${formatDate(ev.timestamp)}</span>
      <button class="btn btn-danger btn-sm" data-delev="${id}">❌</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("[data-delev]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.delev;
      const ev = state.events[id];
      if (!ev) return;
      if (!confirm("Eliminare questo evento e stornare i punti dal professore?")) return;
      const prof = state.professors[ev.profId];
      if (prof) {
        await db.ref(`professors/${ev.profId}/points`).set((prof.points || 0) - ev.points);
      }
      await db.ref(`events/${id}`).remove();
    });
  });
}

/* --- Export / Backup --- */
$("#exportCredentials").addEventListener("click", () => {
  const rows = [["username", "password", "nome", "squadra", "admin"]];
  Object.values(state.students).forEach((s) => {
    rows.push([s.username, s.password, s.name, s.teamName || "", s.isAdmin ? "si" : "no"]);
  });
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadFile("fantaprof_credenziali.csv", csv, "text/csv");
});

$("#exportRosters").addEventListener("click", () => {
  const data = Object.entries(state.students)
    .filter(([, s]) => !s.isAdmin)
    .map(([id, s]) => ({
      studente: s.name, squadra: s.teamName,
      capitano: s.captainId ? state.professors[s.captainId]?.name : null,
      professori: (s.roster || []).map((pid) => state.professors[pid]?.name).filter(Boolean),
      puntiTotali: studentTotalPoints(s)
    }));
  downloadFile("fantaprof_rose.json", JSON.stringify(data, null, 2), "application/json");
});

$("#exportHistory").addEventListener("click", () => {
  const data = Object.values(state.events).sort((a, b) => a.timestamp - b.timestamp);
  downloadFile("fantaprof_storico_eventi.json", JSON.stringify(data, null, 2), "application/json");
});

$("#exportRankings").addEventListener("click", () => {
  const rows = [["tipo", "posizione", "nome", "dettaglio", "punti"]];
  const studentList = Object.values(state.students)
    .filter((s) => s.rosterLocked && !s.isAdmin)
    .map((s) => ({ s, pts: studentTotalPoints(s) }))
    .sort((a, b) => b.pts - a.pts);
  assignRanks(studentList, (x) => x.pts).forEach(({ item, rank, pts }) => {
    rows.push(["studente", rank, item.s.name, item.s.teamName, pts]);
  });
  const profList = Object.values(state.professors).sort((a, b) => (b.points || 0) - (a.points || 0));
  assignRanks(profList, (x) => x.points || 0).forEach(({ item, rank, pts }) => {
    rows.push(["professore", rank, item.name, item.subject, pts]);
  });
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadFile("fantaprof_classifiche.csv", csv, "text/csv");
});

/* =====================================================================
   REGOLE DATABASE SUGGERITE (Firebase Realtime Database → Regole)
   ---------------------------------------------------------------------
   Per un uso in classe senza autenticazione individuale, puoi usare
   regole aperte in lettura/scrittura solo durante lo sviluppo iniziale,
   per poi restringerle. Esempio minimo:

   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }

   Per una protezione più solida valuta Firebase Authentication
   (accesso anonimo + un campo "role") oppure la messa online solo su
   una rete/URL condivisa esclusivamente con la classe.
===================================================================== */
