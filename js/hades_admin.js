import { auth, db } from "./firebase.js";
import { getHadesDomisAudit, getHadesDomisMovements, registrarAbonoDomis, liquidarDomisHades } from "./db.js";
import { collection, doc, getDoc, getDocs, limit, query, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const ADMIN_EMAIL = "cris@fercofarma.com";
const $ = s => document.querySelector(s);
const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const money = value => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);

function isAdmin() { return String(auth.currentUser?.email || "").toLowerCase() === ADMIN_EMAIL; }
function formatDate(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "medium" });
}
function toast(message) {
  const t = $("#toast"); if (!t) return;
  t.textContent = message; t.classList.add("show"); clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), 3000);
}

// Defensa de interfaz para versiones anteriores que todavía puedan contener
// los controles inline #btn-abonar-hades-hades / #btn-liquidar-hades.
// La seguridad real sigue estando en Firestore (firestore.rules).
let legacyAbonoOriginal = null;
let legacyAbonoGuarded = null;
let legacyLiquidarOriginal = null;
let legacyLiquidarGuarded = null;

function enforceLegacyHadesControls() {
  const admin = isAdmin();
  const abonoButtons = [
    $("#btn-abonar-hades-hades"),
    $("#btn-abonar-hades-admin")
  ].filter(Boolean);
  const liquidar = $("#btn-liquidar-hades");

  abonoButtons.forEach(button => {
    if (admin) {
      button.style.display = "flex";
      button.disabled = false;
    } else {
      button.style.display = "none";
      button.disabled = true;
      button.removeAttribute("onclick");
    }
  });

  if (liquidar) {
    liquidar.style.display = admin ? "flex" : "none";
    liquidar.disabled = !admin;
    if (!admin) liquidar.removeAttribute("onclick");
  }

  const originalAbono = window.abrirModalAbonoHades;
  if (typeof originalAbono === "function" && !originalAbono.__hadesGuarded) {
    legacyAbonoOriginal = originalAbono;
    legacyAbonoGuarded = (...args) => {
      if (!isAdmin()) return toast("Acción exclusiva del Administrador.");
      return legacyAbonoOriginal(...args);
    };
    legacyAbonoGuarded.__hadesGuarded = true;
    window.abrirModalAbonoHades = legacyAbonoGuarded;
  }

  const originalLiquidar = window.liquidarDomisHades;
  if (typeof originalLiquidar === "function" && !originalLiquidar.__hadesGuarded) {
    legacyLiquidarOriginal = originalLiquidar;
    legacyLiquidarGuarded = (...args) => {
      if (!isAdmin()) return toast("Acción exclusiva del Administrador.");
      return legacyLiquidarOriginal(...args);
    };
    legacyLiquidarGuarded.__hadesGuarded = true;
    window.liquidarDomisHades = legacyLiquidarGuarded;
  }
}

async function render() {
  if (!isAdmin()) return;
  const main = $("#main");
  if (!main) return;
  main.innerHTML = `<div class="page-head"><div><h1>Auditoría · Domis Hades</h1><div class="muted">Solo Administrador · cris@fercofarma.com</div></div><button class="btn secondary" id="refresh-hades-audit">Actualizar</button></div>
    <div class="grid cards"><div class="card"><div class="metric" id="hades-saldo">…</div><div class="metric-label">Saldo calculado actual</div></div><div class="card"><div class="metric" id="hades-abonos-total">…</div><div class="metric-label">Abonos / liquidaciones</div></div><div class="card"><div class="metric" id="hades-costos-total">…</div><div class="metric-label">Costos de domicilios</div></div></div>
    <div class="card" style="margin-top:15px"><h3 class="section-title">Acciones administrativas</h3><div class="toolbar" style="margin-top:10px"><button class="btn green" id="hades-abonar">Registrar abono</button><button class="btn red" id="hades-saldar">Saldar a $0</button></div><p class="form-note">Estas acciones generan el movimiento y su bitácora de auditoría en una misma operación.</p></div>
    <div class="card" style="margin-top:15px"><h3 class="section-title">Bitácora de acciones Hades</h3><div id="hades-audit-table" class="table-wrap" style="margin-top:10px"></div></div>
    <div class="card" style="margin-top:15px"><h3 class="section-title">Movimientos financieros Hades</h3><div id="hades-mov-table" class="table-wrap" style="margin-top:10px"></div></div>`;

  $("#refresh-hades-audit").onclick = render;
  $("#hades-abonar").onclick = () => promptAbono(false);
  $("#hades-saldar").onclick = () => promptAbono(true);
  await loadData();
}

async function loadData() {
  const [auditRows, movementRows, configSnap] = await Promise.all([
    getHadesDomisAudit(auth.currentUser),
    getHadesDomisMovements(auth.currentUser),
    getDoc(doc(db, "configuracion", "hades_domis"))
  ]);

  let costs = 0;
  const ventas = await getDocs(query(collection(db, "ventas"), orderBy("timestamp", "desc"), limit(1000)));
  ventas.forEach(s => {
    const d = s.data();
    if (String(d.creadoPor || "").toLowerCase() !== "hades@fercofarma.com") return;
    costs += Number(d.entrega?.costo || 0);
  });
  const abonos = movementRows.reduce((sum, d) => sum + Number(d.totalVenta || 0), 0);
  const saldo = Math.max(0, costs - abonos);
  $("#hades-saldo").textContent = money(saldo);
  $("#hades-abonos-total").textContent = money(abonos);
  $("#hades-costos-total").textContent = money(costs);

  const config = configSnap.exists() ? configSnap.data() : {};
  const configValue = config.ultimaLiquidacion || 0;
  const configInfo = `<div class="form-note" style="margin:10px 0 16px">configuracion/hades_domis · ultimaLiquidacion: <b>${esc(configValue)}</b></div>`;

  $("#hades-audit-table").innerHTML = configInfo + (auditRows.length ? `<table class="table"><thead><tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Monto</th><th>Medio</th><th>Cuenta</th><th>Operación</th></tr></thead><tbody>${auditRows.map(a => `<tr><td>${esc(formatDate(a.creadoEn || a.timestampCliente))}</td><td><span class="badge ${a.accion === "SALDAR_A_CERO" ? "red" : "green"}">${esc(a.accion)}</span></td><td>${esc(a.usuarioEmail || "—")}</td><td>${money(a.monto)}</td><td>${esc(a.metodo || "—")}</td><td>${esc(a.cuenta || "—")}</td><td class="muted">${esc(a.operacionId || "—")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Sin registros de auditoría Hades.</div>`);

  $("#hades-mov-table").innerHTML = movementRows.length ? `<table class="table"><thead><tr><th>Fecha</th><th>Monto</th><th>Creado por</th><th>Nota</th><th>Consecutivo</th><th>ID</th></tr></thead><tbody>${movementRows.map(m => `<tr><td>${esc(formatDate(m.horaServidor || m.timestamp))}</td><td>${money(m.totalVenta)}</td><td><b>${esc(m.creadoPor || "—")}</b></td><td>${esc(m.notas || "—")}</td><td>${esc(m.consecutivo || "—")}</td><td class="muted">${esc(m.id)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No existen movimientos Abono Domis.</div>`;
}

async function promptAbono(liquidacion) {
  if (!isAdmin()) return toast("Acción exclusiva del Administrador.");
  const current = Number($("#hades-saldo")?.textContent?.replace(/[^0-9-]/g, "")) || 0;
  const raw = prompt(liquidacion ? `Saldo actual: ${money(current)}\nMonto a liquidar:` : `Saldo actual: ${money(current)}\nMonto del abono:`);
  if (raw == null) return;
  const amount = Math.round(Number(String(raw).replace(/\./g, "").replace(/,/g, ".")) || 0);
  if (amount <= 0) return toast("Monto inválido.");
  try {
    const result = liquidacion
      ? await liquidarDomisHades(auth.currentUser, amount)
      : await registrarAbonoDomis({ user: auth.currentUser, monto: amount, metodo: prompt("Medio de pago:", "Transferencia") || "Transferencia", cuenta: prompt("Cuenta destino:", "CRIS") || "CRIS", liquidacion: false });
    toast(`Movimiento registrado: ${result.ventaId}`);
    await loadData();
  } catch (error) {
    console.error(error);
    toast("No se pudo registrar: " + error.message);
  }
}

window.abrirAuditoriaHades = async () => {
  if (!isAdmin()) return toast("Acceso exclusivo del Administrador.");
  await render();
};

setInterval(enforceLegacyHadesControls, 800);
enforceLegacyHadesControls();

setTimeout(() => {
  if (isAdmin() && document.querySelector("#nav")) {
    const nav = $("#nav");
    if (!nav.querySelector("[data-hades-audit]")) {
      const button = document.createElement("button");
      button.className = "nav-item";
      button.dataset.hadesAudit = "true";
      button.textContent = "Auditoría Hades";
      button.onclick = () => window.abrirAuditoriaHades();
      nav.appendChild(button);
    }
  }
}, 500);

const observer = new MutationObserver(() => {
  enforceLegacyHadesControls();
  if (!isAdmin()) return;
  const nav = $("#nav");
  if (nav && !nav.querySelector("[data-hades-audit]")) {
    const button = document.createElement("button");
    button.className = "nav-item";
    button.dataset.hadesAudit = "true";
    button.textContent = "Auditoría Hades";
    button.onclick = () => window.abrirAuditoriaHades();
    nav.appendChild(button);
  }
});
observer.observe(document.body, { childList: true, subtree: true });
