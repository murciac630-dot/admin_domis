import { getUsers, getActiveTurno } from "./db.js";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

function displayName(user) {
  if (user?.nombre) return user.nombre;
  if (user?.email) return user.email.split("@")[0];
  return user?.id || "Usuario";
}

function formatTime(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

function ensureStyles() {
  if ($("#dashboard-active-styles")) return;
  const style = document.createElement("style");
  style.id = "dashboard-active-styles";
  style.textContent = `
    #m-active-card { cursor: pointer; position: relative; transition: transform .15s ease, border-color .15s ease; }
    #m-active-card:hover { transform: translateY(-2px); }
    #m-active-card::after { content: "Clic para ver usuarios conectados"; display:block; margin-top:8px; font-size:11px; opacity:.75; }
    .active-users-modal { position:fixed; inset:0; z-index:5000; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(2,6,23,.75); backdrop-filter:blur(6px); }
    .active-users-panel { width:min(720px,96vw); max-height:80vh; overflow:auto; border:1px solid rgba(0,245,255,.25); border-radius:16px; background:#0B1120; box-shadow:0 20px 60px rgba(0,0,0,.45); padding:20px; }
    .active-user-row { display:grid; grid-template-columns:1fr auto; gap:12px; padding:14px 0; border-bottom:1px solid rgba(148,163,184,.12); }
    .active-user-row:last-child { border-bottom:0; }
    .active-user-name { font-weight:700; }
    .active-user-meta { color:#94a3b8; font-size:13px; margin-top:4px; }
    .active-user-status { align-self:center; white-space:nowrap; }
    .active-users-empty { text-align:center; padding:28px 10px; color:#94a3b8; }
    @media (max-width:600px){ .active-user-row{grid-template-columns:1fr;} .active-user-status{justify-self:start;} }
  `;
  document.head.appendChild(style);
}

function closeModal() {
  $("#active-users-modal")?.remove();
}

async function showActiveUsers() {
  if (!$("#m-active")) return;
  const users = (await getUsers()).filter(u => ["domiciliario", "domiciliario1", "domiciliario2"].includes(u.rol));
  const active = [];
  for (const user of users) {
    const turn = await getActiveTurno(user.id);
    if (turn) active.push({ user, turn });
  }

  closeModal();
  const modal = document.createElement("div");
  modal.id = "active-users-modal";
  modal.className = "active-users-modal";
  modal.innerHTML = `
    <div class="active-users-panel" role="dialog" aria-modal="true" aria-labelledby="active-users-title">
      <div class="section-head-row">
        <div>
          <h2 id="active-users-title" class="section-title">Turnos activos</h2>
          <div class="muted">Usuarios que actualmente tienen un turno abierto.</div>
        </div>
        <button type="button" class="btn secondary" id="active-users-close">Cerrar</button>
      </div>
      ${active.length ? `<div style="margin-top:14px">${active.map(({ user, turn }) => `
        <div class="active-user-row">
          <div><div class="active-user-name">${esc(displayName(user))}</div><div class="active-user-meta">${esc(user.email || user.id)} · Inicio ${esc(formatTime(turn.inicio))}</div></div>
          <div class="active-user-status"><span class="badge green">CONECTADO</span></div>
        </div>`).join("")}</div>` : `<div class="active-users-empty">No hay domiciliarios con turno activo.</div>`}
      <div class="form-note" style="margin-top:12px">La lista se consulta en tiempo real al abrir esta ventana.</div>
    </div>`;
  document.body.appendChild(modal);
  $("#active-users-close").onclick = closeModal;
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
}

function attachDashboardCard() {
  const value = $("#m-active");
  if (!value) return;
  const card = value.closest(".card");
  if (!card) return;
  card.id = "m-active-card";
  if (card.dataset.activeUsersBound === "1") return;
  card.dataset.activeUsersBound = "1";
  card.addEventListener("click", async () => {
    try { await showActiveUsers(); }
    catch (error) { alert("No se pudo consultar los turnos activos: " + error.message); }
  });
}

ensureStyles();
const observer = new MutationObserver(attachDashboardCard);
observer.observe(document.body, { childList: true, subtree: true });
setInterval(attachDashboardCard, 1000);
attachDashboardCard();
