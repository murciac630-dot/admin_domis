import { db, auth } from "./firebase.js";
import { addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = s => document.querySelector(s);
const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const money = value => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const daysFromToday = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const toStamp = (value, end = false) => Timestamp.fromDate(new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`));
const toast = message => { const t = $("#toast"); if (!t) return; t.textContent = message; t.classList.add("show"); clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), 3000); };

function isAdmin() { return $("#user-role")?.textContent?.trim() === "admin"; }
function isAdminOrigin(data) { return ["admin_manual", "admin_importacion"].includes(data?.origenRegistro); }
function formatDate(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}

async function loadAdminRecords() {
  const start = $("#svc-clean-start").value;
  const end = $("#svc-clean-end").value;
  if (!start || !end) throw new Error("Indica el rango de fechas.");
  if (start > end) throw new Error("La fecha inicial no puede ser posterior a la final.");
  const snapshot = await getDocs(query(
    collection(db, "entregas"),
    where("timestamp", ">=", toStamp(start)),
    where("timestamp", "<=", toStamp(end, true)),
    orderBy("timestamp", "desc"),
    limit(500)
  ));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(isAdminOrigin);
}

async function renderAdminRecords() {
  const box = $("#svc-clean-results");
  if (!box) return;
  box.innerHTML = `<div class="empty">Consultando…</div>`;
  try {
    const records = await loadAdminRecords();
    if (!records.length) {
      box.innerHTML = `<div class="empty">No hay domicilios administrativos en este rango.</div>`;
      return;
    }
    box.innerHTML = `<div class="section-head-row"><div><h3 class="section-title">Registros administrativos</h3><p class="muted">Solo aparecen domicilios creados por el administrador mediante registro manual o importación.</p></div><span class="badge blue">${records.length} registros</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Domiciliario</th><th>Cliente</th><th>Origen</th><th>Tarifa</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
      ${records.map(r => `<tr><td>${esc(formatDate(r.timestamp))}</td><td>${esc(r.usuarioNombre || r.usuarioEmail || r.usuarioId)}</td><td>${esc(r.cliente)}</td><td><span class="badge blue">${esc(r.origenRegistro === "admin_importacion" ? "Importación" : "Manual")}</span></td><td>${money(r.valorDomicilioCongelado ?? r.valorDomicilio)}</td><td><span class="badge ${r.estado === "anulado" ? "red" : "green"}">${esc(r.estado || "registrado")}</span></td><td>${r.estado === "anulado" ? "—" : `<button class="btn red svc-delete" data-id="${esc(r.id)}">Eliminar prueba</button>`}</td></tr>`).join("")}
      </tbody></table></div>`;
    box.querySelectorAll(".svc-delete").forEach(btn => btn.onclick = async () => {
      const record = records.find(x => x.id === btn.dataset.id);
      if (!record || !isAdminOrigin(record)) return;
      const ok = confirm(`Eliminar definitivamente el domicilio de ${record.usuarioNombre || record.usuarioEmail || "este domiciliario"} del ${formatDate(record.timestamp)}?\n\nEsta acción se recomienda solo para registros de prueba.`);
      if (!ok) return;
      try {
        const adminUid = auth.currentUser?.uid;
        const batch = writeBatch(db);
        batch.delete(doc(db, "entregas", record.id));
        batch.set(doc(collection(db, "auditoria")), {
          accion: "eliminar_domicilio_administrativo",
          registroId: record.id,
          usuarioId: adminUid || null,
          usuarioNombre: $("#user-name")?.textContent || adminUid || "admin",
          domiciliarioId: record.usuarioId,
          domiciliarioNombre: record.usuarioNombre || null,
          origenRegistro: record.origenRegistro,
          valorEliminado: Number(record.valorDomicilioCongelado ?? record.valorDomicilio ?? 0),
          fechaEntrega: record.timestamp || null,
          fecha: serverTimestamp()
        });
        await batch.commit();
        toast("Registro eliminado y auditado.");
        await renderAdminRecords();
      } catch (error) {
        toast("No se pudo eliminar: " + error.message);
      }
    });
  } catch (error) {
    box.innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

function injectManager() {
  if (!isAdmin()) return;
  const main = $("#main");
  if (!main || !$("#svc-file")) return;
  if ($("#svc-admin-manager")) return;
  const section = document.createElement("div");
  section.className = "card";
  section.id = "svc-admin-manager";
  section.style.marginTop = "15px";
  section.innerHTML = `<div class="section-head-row"><div><h3 class="section-title">Gestionar cargas administrativas</h3><p class="muted">Consulta y elimina únicamente registros creados desde esta sección. No muestra ni elimina domicilios registrados por los domiciliarios desde sus turnos.</p></div><span class="badge yellow">Administrador</span></div>
    <div class="form-grid" style="margin-top:12px"><div><label>Desde</label><input id="svc-clean-start" type="date" value="${daysFromToday(-90)}"></div><div><label>Hasta</label><input id="svc-clean-end" type="date" value="${daysFromToday(90)}"></div><div style="align-self:end"><button id="svc-clean-search" class="btn secondary">Buscar registros</button></div></div>
    <div id="svc-clean-results" style="margin-top:15px"><div class="empty">Pulsa «Buscar registros».</div></div>`;
  main.appendChild(section);
}

function wireManager() {
  const button = $("#svc-clean-search");
  if (!button || button.dataset.wired === "true") return;
  button.dataset.wired = "true";
  button.onclick = renderAdminRecords;
}

function refresh() { injectManager(); wireManager(); }
const observer = new MutationObserver(refresh);
observer.observe(document.body, { childList: true, subtree: true });
setInterval(refresh, 800);
setTimeout(refresh, 300);
