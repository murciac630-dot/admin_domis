import { getUsers, getTurnosByDate, getEntregasByDate } from "./db.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = s => document.querySelector(s);
const money = value => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);
const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const SHIFT_VALUE = 50000;

function roleIsDomi(role) { return ["domiciliario", "domiciliario1", "domiciliario2"].includes(role); }
function userName(u) { return u?.nombre || u?.email?.split("@")[0] || u?.id || "Domiciliario"; }
function asDate(value) { return value?.toDate ? value.toDate() : (value ? new Date(value) : null); }
function localDateKey(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function localTimeKey(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function deliveryDateKey(delivery) {
  const d = asDate(delivery?.timestamp);
  return localDateKey(d);
}

function normalizeStartTime(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localTimeKey(value);
  if (typeof value === "number" && window.XLSX?.SSF) {
    const p = XLSX.SSF.parse_date_code(value);
    if (p) return `${String(p.H).padStart(2, "0")}:${String(p.M).padStart(2, "0")}`;
  }
  const raw = String(value).trim().toLowerCase();
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?$/i);
  if (!m) return "";
  let h = Number(m[1]); const min = Number(m[2]);
  if (raw.includes("p") && h < 12) h += 12;
  if (raw.includes("a") && h === 12) h = 0;
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function actualTurnKey(turn) {
  const date = String(turn?.fechaLocal || "").slice(0, 10);
  const start = normalizeStartTime(turn?.horaInicioTurno) || localTimeKey(asDate(turn?.inicio));
  return date && start ? `${date}|${start}` : date ? `${date}|__SIN_HORA__` : "";
}

function importedTurnKey(delivery) {
  const date = deliveryDateKey(delivery);
  const start = normalizeStartTime(delivery?.horaInicioTurno);
  return date ? `${date}|${start || "__SIN_HORA__"}` : "";
}

function formatDay(key) {
  const [y, m, d] = String(key || "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : key || "—";
}

function buildShiftMap(actualTurns, adminDeliveries) {
  const map = new Map();
  for (const t of actualTurns) {
    const key = actualTurnKey(t);
    if (!key) continue;
    map.set(key, {
      key,
      date: String(t.fechaLocal || key.split("|")[0]),
      start: normalizeStartTime(t.horaInicioTurno) || localTimeKey(asDate(t.inicio)) || "—",
      end: localTimeKey(asDate(t.fin)) || "—",
      source: "Turno registrado",
      turnoId: t.id,
      deliveryCount: 0
    });
  }
  for (const d of adminDeliveries.filter(x => x.estado !== "anulado")) {
    const key = importedTurnKey(d);
    if (!key) continue;
    const date = key.split("|")[0];
    const start = key.split("|")[1];
    if (!map.has(key)) {
      map.set(key, {
        key,
        date,
        start: start === "__SIN_HORA__" ? "—" : start,
        end: "—",
        source: start === "__SIN_HORA__" ? "Reconocido por fecha de carga" : "Reconocido por hora de inicio",
        turnoId: null,
        deliveryCount: 0
      });
    }
    map.get(key).deliveryCount += 1;
  }
  return [...map.values()].sort((a, b) => `${a.date}|${a.start}`.localeCompare(`${b.date}|${b.start}`));
}

async function queryPayroll(start, end) {
  const users = (await getUsers()).filter(u => roleIsDomi(u.rol));
  const turns = await getTurnosByDate(start, end);
  const rows = [];
  for (const u of users) {
    const deliveries = await getEntregasByDate(
      Timestamp.fromDate(new Date(`${start}T00:00:00`)),
      Timestamp.fromDate(new Date(`${end}T23:59:59`)),
      u.id
    );
    const valid = deliveries.filter(x => x.estado !== "anulado");
    const ownTurns = turns.filter(x => x.usuarioId === u.id);
    const shiftDetails = buildShiftMap(ownTurns, valid);
    const domicilios = valid.reduce((sum, x) => sum + Number(x.valorDomicilioCongelado ?? x.valorDomicilio ?? 0), 0);
    rows.push({
      id: u.id,
      name: userName(u),
      shifts: shiftDetails.length,
      shiftDetails,
      deliveries: valid.length,
      base: shiftDetails.length * SHIFT_VALUE,
      domicilios,
      total: shiftDetails.length * SHIFT_VALUE + domicilios
    });
  }
  return rows;
}

function renderTurnDetails(row) {
  const box = $("#nt-detail");
  if (!box) return;
  box.innerHTML = `<div class="section-head-row"><div><h3 class="section-title">Turnos de ${esc(row.name)}</h3><p class="muted">Turnos reconocidos automáticamente: ${row.shifts} · valor configurado ${money(SHIFT_VALUE)}</p></div><button class="btn secondary" id="nt-close">Cerrar</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Inicio</th><th>Fin</th><th>Origen</th><th>Domicilios</th></tr></thead><tbody>${row.shiftDetails.map(t => `<tr><td>${esc(formatDay(t.date))}</td><td>${esc(t.start)}</td><td>${esc(t.end)}</td><td>${esc(t.source)}</td><td>${t.deliveryCount}</td></tr>`).join("")}</tbody></table></div>`;
  $("#nt-close").onclick = () => { box.innerHTML = ""; box.classList.add("hidden"); };
  box.classList.remove("hidden");
}

async function renderPayroll() {
  const d = new Date().toISOString().slice(0, 10);
  $("#main").innerHTML = `<div class="page-head"><div><h1>Nómina</h1><div class="muted">Cantidad de turnos editable manualmente + pago de domicilios.</div></div></div>
    <div class="card"><div class="form-grid"><div><label>Desde</label><input id="nt-start" type="date" value="${d}"></div><div><label>Hasta</label><input id="nt-end" type="date" value="${d}"></div><div style="align-self:end"><button id="nt-go" class="btn primary">Calcular</button></div></div>
    <p class="form-note"><b>Valor por turno: ${money(SHIFT_VALUE)}.</b> El número de turnos de la tabla es editable manualmente. La aplicación multiplica ese valor por ${money(SHIFT_VALUE)} y suma el pago de domicilios.</p></div>
    <div id="nt-result" class="card" style="margin-top:15px"><div class="empty">Procesa un rango.</div></div>
    <div id="nt-detail" class="card hidden" style="margin-top:15px"></div>`;

  async function calculate() {
    const start = $("#nt-start").value, end = $("#nt-end").value;
    if (!start || !end || start > end) return toast("Revisa el rango de fechas.");
    const rows = await queryPayroll(start, end);
    rows.forEach(r => { r.manualShifts = r.shifts; r.manualBase = r.manualShifts * SHIFT_VALUE; r.manualTotal = r.manualBase + r.domicilios; });

    $("#nt-result").innerHTML = `<div class="section-head-row"><div><h3 class="section-title">Liquidación</h3><p class="muted">Edita directamente la cantidad de turnos de cada domiciliario.</p></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Domiciliario</th><th>Turnos</th><th>Valor turno</th><th>Base turnos</th><th>Domicilios</th><th>Pago domicilios</th><th>Total</th><th>Detalle</th></tr></thead><tbody>${rows.map((r,i) => `<tr data-row="${i}"><td>${esc(r.name)}</td><td><input class="nt-shifts" data-index="${i}" type="number" min="0" step="1" value="${r.manualShifts}" aria-label="Turnos de ${esc(r.name)}" style="width:88px"></td><td>${money(SHIFT_VALUE)}</td><td class="nt-base">${money(r.manualBase)}</td><td>${r.deliveries}</td><td>${money(r.domicilios)}</td><td><b class="nt-total">${money(r.manualTotal)}</b></td><td><button class="btn secondary nt-turns" data-index="${i}">Ver domicilios</button></td></tr>`).join("")}</tbody></table></div>`;

    document.querySelectorAll(".nt-shifts").forEach(input => input.addEventListener("input", () => {
      const i = Number(input.dataset.index);
      let shifts = Number(input.value);
      if (!Number.isFinite(shifts) || shifts < 0) shifts = 0;
      shifts = Math.floor(shifts);
      rows[i].manualShifts = shifts;
      rows[i].manualBase = shifts * SHIFT_VALUE;
      rows[i].manualTotal = rows[i].manualBase + rows[i].domicilios;
      const tr = input.closest("tr");
      tr.querySelector(".nt-base").textContent = money(rows[i].manualBase);
      tr.querySelector(".nt-total").textContent = money(rows[i].manualTotal);
    }));

    document.querySelectorAll(".nt-turns").forEach(btn => btn.onclick = () => renderTurnDetails(rows[Number(btn.dataset.index)]));
  }

  $("#nt-go").onclick = () => calculate().catch(e => $("#nt-result").innerHTML = `<div class="error">${esc(e.message)}</div>`);
}

document.addEventListener("click", event => {
  const button = event.target.closest('#nav [data-route="nomina"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  renderPayroll();
}, true);
