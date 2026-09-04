import { getUsers, getEntregasByDate } from "./db.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = s => document.querySelector(s);
const money = value => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);
const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const SHIFT_VALUE = 50000;

function roleIsDomi(role) { return ["domiciliario", "domiciliario1", "domiciliario2"].includes(role); }
function userName(u) { return u?.nombre || u?.email?.split("@")[0] || u?.id || "Domiciliario"; }

function toStartStamp(value) { return Timestamp.fromDate(new Date(`${value}T00:00:00`)); }
function toEndStamp(value) { return Timestamp.fromDate(new Date(`${value}T23:59:59`)); }

function renderRows(rows) {
  $("#nt-result").innerHTML = `<div class="section-head-row"><div><h3 class="section-title">Liquidación</h3><p class="muted">Ingresa manualmente la cantidad de turnos realizados. El sistema calcula automáticamente la base y el total.</p></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Domiciliario</th><th>Turnos</th><th>Valor turno</th><th>Base turnos</th><th>Domicilios</th><th>Pago domicilios</th><th>Total</th><th>Detalle</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr>
        <td>${esc(r.name)}</td>
        <td><input class="nt-shifts" data-index="${i}" type="number" min="0" step="1" value="${Number(r.shifts) || 0}" style="width:90px"></td>
        <td>${money(SHIFT_VALUE)}</td>
        <td class="nt-base" data-index="${i}">${money((Number(r.shifts) || 0) * SHIFT_VALUE)}</td>
        <td>${r.deliveries}</td>
        <td>${money(r.domicilios)}</td>
        <td class="nt-total" data-index="${i}"><b>${money((Number(r.shifts) || 0) * SHIFT_VALUE + r.domicilios)}</b></td>
        <td><button class="btn secondary nt-deliveries" data-index="${i}">Ver domicilios</button></td>
      </tr>`).join("")}
    </tbody></table></div>`;

  document.querySelectorAll(".nt-shifts").forEach(input => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      const shifts = Math.max(0, Math.floor(Number(input.value) || 0));
      rows[index].shifts = shifts;
      const base = shifts * SHIFT_VALUE;
      $( `.nt-base[data-index="${index}"]`).textContent = money(base);
      $( `.nt-total[data-index="${index}"]`).innerHTML = `<b>${money(base + rows[index].domicilios)}</b>`;
    });
  });

  document.querySelectorAll(".nt-deliveries").forEach(button => {
    button.onclick = () => renderDeliveryDetails(rows[Number(button.dataset.index)]);
  });
}

function renderDeliveryDetails(row) {
  const box = $("#nt-detail");
  if (!box) return;
  box.innerHTML = `<div class="section-head-row"><div><h3 class="section-title">Domicilios de ${esc(row.name)}</h3><p class="muted">${row.deliveries} domicilios · ${money(row.domicilios)} para Nómina</p></div><button class="btn secondary" id="nt-close">Cerrar</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Empresa</th><th>Tarifa</th><th>Origen</th></tr></thead><tbody>
      ${row.deliveryDetails.map(d => `<tr><td>${esc(d.date)}</td><td>${esc(d.cliente)}</td><td>${esc(d.empresa)}</td><td>${money(d.valor)}</td><td>${esc(d.origen)}</td></tr>`).join("") || `<tr><td colspan="5">Sin domicilios en el rango.</td></tr>`}
    </tbody></table></div>`;
  $("#nt-close").onclick = () => { box.innerHTML = ""; box.classList.add("hidden"); };
  box.classList.remove("hidden");
}

async function queryPayroll(start, end) {
  const users = (await getUsers()).filter(u => roleIsDomi(u.rol));
  const rows = [];
  for (const u of users) {
    const deliveries = await getEntregasByDate(toStartStamp(start), toEndStamp(end), u.id);
    const valid = deliveries.filter(x => x.estado !== "anulado");
    const domicilios = valid.reduce((sum, x) => sum + Number(x.valorDomicilioCongelado ?? x.valorDomicilio ?? 0), 0);
    const deliveryDetails = valid.sort((a, b) => {
      const da = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || 0).getTime();
      const db = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || 0).getTime();
      return da - db;
    }).map(x => {
      const d = x.timestamp?.toDate ? x.timestamp.toDate() : new Date(x.timestamp || 0);
      return {
        date: Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }),
        cliente: x.cliente || "—",
        empresa: x.empresa || "—",
        valor: Number(x.valorDomicilioCongelado ?? x.valorDomicilio ?? 0),
        origen: x.origenRegistro === "admin_importacion" ? "Importación" : x.origenRegistro === "admin_manual" ? "Manual" : "Turno"
      };
    });
    rows.push({ id: u.id, name: userName(u), shifts: 0, deliveries: valid.length, domicilios, deliveryDetails });
  }
  return rows;
}

async function renderPayroll() {
  const d = new Date().toISOString().slice(0, 10);
  $("#main").innerHTML = `<div class="page-head"><div><h1>Nómina</h1><div class="muted">Turnos ingresados manualmente + domicilios del rango seleccionado.</div></div></div>
    <div class="card"><div class="form-grid"><div><label>Desde</label><input id="nt-start" type="date" value="${d}"></div><div><label>Hasta</label><input id="nt-end" type="date" value="${d}"></div><div style="align-self:end"><button id="nt-go" class="btn primary">Cargar nómina</button></div></div>
    <p class="form-note"><b>Valor por turno: ${money(SHIFT_VALUE)}.</b> La cantidad de turnos la ingresas tú manualmente. El sistema solo multiplica <b>turnos × $50.000</b> y suma el valor de los domicilios válidos del rango.</p></div>
    <div id="nt-result" class="card" style="margin-top:15px"><div class="empty">Selecciona el rango y pulsa «Cargar nómina».</div></div>
    <div id="nt-detail" class="card hidden" style="margin-top:15px"></div>`;

  $("#nt-go").onclick = async () => {
    const start = $("#nt-start").value;
    const end = $("#nt-end").value;
    if (!start || !end) return;
    if (start > end) return toast("La fecha Desde no puede ser posterior a Hasta.");
    const button = $("#nt-go");
    button.disabled = true;
    button.textContent = "Cargando…";
    try {
      const rows = await queryPayroll(start, end);
      renderRows(rows);
    } catch (error) {
      $("#nt-result").innerHTML = `<div class="error">${esc(error.message)}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = "Cargar nómina";
    }
  };
}

document.addEventListener("click", event => {
  const button = event.target.closest('#nav [data-route="nomina"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  renderPayroll().catch(error => toast(error.message));
}, true);
