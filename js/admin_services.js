import { db, auth } from "./firebase.js";
import { getUsers } from "./db.js";
import { getCurrentProfile } from "./auth.js";
import { addDoc, collection, doc, serverTimestamp, Timestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = s => document.querySelector(s);
const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const money = value => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const toast = message => { const t = $("#toast"); if (!t) return; t.textContent = message; t.classList.add("show"); clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), 2800); };

let profiles = [];
let pendingImportRows = [];

function displayName(user) { return user?.nombre || user?.email?.split("@")[0] || user?.id || "Domiciliario"; }
function isDomi(user) { return ["domiciliario", "domiciliario1", "domiciliario2"].includes(user?.rol); }
function currentUserIsAdmin() { return document.querySelector("#user-role")?.textContent === "admin"; }

function parseNumber(value, field, rowNumber, required = false) {
  if (value === "" || value == null) {
    if (required) throw new Error(`Fila ${rowNumber}: ${field} es obligatorio.`);
    return null;
  }
  const raw = String(value).trim();
  const decimalField = ["distancia_km", "lat", "lng"].includes(field);
  const normalized = decimalField
    ? raw.replace(/\s/g, "").replace(",", ".")
    : raw.replace(/[$.\s]/g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error(`Fila ${rowNumber}: ${field} no es numérico.`);
  return n;
}

function dateString(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear(); const m = String(value.getMonth() + 1).padStart(2, "0"); const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && window.XLSX?.SSF) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return raw;
}

function buildTimestamp(fecha, hora) {
  const date = dateString(fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Fecha inválida: ${fecha}`);
  const time = String(hora || "12:00").trim();
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error(`Hora inválida: ${hora}`);
  const [h, m] = time.split(":").map(Number);
  const local = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  if (Number.isNaN(local.getTime())) throw new Error(`Fecha/hora inválida: ${date} ${time}`);
  return Timestamp.fromDate(local);
}

function normalizeRow(raw, rowNumber) {
  const get = (...names) => {
    const key = Object.keys(raw).find(k => names.some(n => String(k).trim().toLowerCase() === n));
    return key == null ? "" : raw[key];
  };
  const uid = String(get("domiciliario_uid", "uid", "usuario_id")).trim();
  const email = String(get("domiciliario_email", "email", "usuario_email")).trim().toLowerCase();
  const fecha = get("fecha", "date");
  const hora = get("hora", "time") || "12:00";
  const cliente = String(get("cliente", "nombre_cliente")).trim();
  const empresa = String(get("empresa", "servicio", "empresa_servicio")).trim() || "Ferco Farma";
  const valorDomicilio = parseNumber(get("valor_domicilio", "valor_domicilio_cop", "tarifa"), "valor_domicilio", rowNumber, true);
  const distancia = parseNumber(get("distancia_km", "distancia"), "distancia_km", rowNumber);
  const total = parseNumber(get("total_cobrado", "total"), "total_cobrado", rowNumber) ?? 0;
  const lat = parseNumber(get("lat", "latitud"), "lat", rowNumber);
  const lng = parseNumber(get("lng", "longitud"), "lng", rowNumber);
  const medio = String(get("medio_pago", "medio", "forma_pago")).trim() || "efectivo";
  const observaciones = String(get("observaciones", "nota", "notas")).trim();
  if (!cliente) throw new Error(`Fila ${rowNumber}: cliente es obligatorio.`);
  if (!uid && !email) throw new Error(`Fila ${rowNumber}: indica domiciliario_uid o domiciliario_email.`);
  if (valorDomicilio < 0) throw new Error(`Fila ${rowNumber}: valor_domicilio no puede ser negativo.`);
  return { uid, email, fecha, hora, cliente, empresa, valorDomicilio: Math.round(valorDomicilio), distancia, total: Math.round(total), lat, lng, medio, observaciones };
}

function resolveUser(row, rowNumber) {
  let user = row.uid ? profiles.find(x => x.id === row.uid) : null;
  if (!user && row.email) user = profiles.find(x => String(x.email || "").toLowerCase() === row.email);
  if (!user || !isDomi(user)) throw new Error(`Fila ${rowNumber}: no se encontró un domiciliario válido para ${row.uid || row.email}.`);
  return user;
}

function toEntrega(row, rowNumber, adminProfile, origenRegistro) {
  const user = resolveUser(row, rowNumber);
  const timestamp = buildTimestamp(row.fecha, row.hora);
  return {
    usuarioId: user.id,
    usuarioNombre: displayName(user),
    usuarioEmail: user.email || row.email || null,
    creadoPor: adminProfile.uid,
    creadoPorNombre: adminProfile.nombre || adminProfile.email || adminProfile.uid,
    origenRegistro,
    turnoId: null,
    empresa: row.empresa,
    cliente: row.cliente,
    lat: row.lat,
    lng: row.lng,
    accuracy: null,
    gpsCapturadoEn: null,
    distanciaTarifableKm: row.distancia,
    tarifaCalculada: true,
    valorDomicilio: row.valorDomicilio,
    valorDomicilioCongelado: row.valorDomicilio,
    tarifaBase: row.valorDomicilio,
    tipoTarifa: "manual",
    tarifaMotivo: "Registro administrativo",
    pago: { estado: row.total > 0 ? "pagado" : "sin_pago", total: row.total, medios: [{ medio: row.medio, valor: row.total }] },
    observaciones: row.observaciones,
    timestamp,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
    estado: "registrado"
  };
}

async function loadProfiles() {
  profiles = (await getUsers()).filter(isDomi);
  const select = $("#svc-domi");
  if (select) select.innerHTML = `<option value="">Selecciona un domiciliario</option>` + profiles.map(u => `<option value="${esc(u.id)}">${esc(displayName(u))} · ${esc(u.email || "")}</option>`).join("");
}

function downloadTemplate() {
  if (!window.XLSX) return toast("No se cargó el módulo de Excel. Recarga la aplicación e inténtalo de nuevo.");
  const headers = ["fecha", "hora", "domiciliario_uid", "domiciliario_email", "cliente", "empresa", "valor_domicilio", "distancia_km", "total_cobrado", "medio_pago", "lat", "lng", "observaciones"];
  const ws = XLSX.utils.json_to_sheet([{ fecha: today(), hora: "12:00", domiciliario_uid: "", domiciliario_email: "domi1@fercofarma.com", cliente: "Ejemplo", empresa: "Ferco Farma", valor_domicilio: 10000, distancia_km: 2.5, total_cobrado: 0, medio_pago: "efectivo", lat: "", lng: "", observaciones: "Eliminar esta fila de ejemplo antes de importar" }], { header: headers });
  ws["!cols"] = headers.map(h => ({ wch: Math.max(16, h.length + 2) }));
  const info = [["PLANTILLA · CARGA DE DOMICILIOS"],["Obligatorios: fecha, domiciliario_uid o domiciliario_email, cliente, valor_domicilio."],["fecha: AAAA-MM-DD. hora: HH:MM. Si hora queda vacía se usa 12:00."],["valor_domicilio queda congelado para nómina y no se recalcula después."],["No necesitas turno_id: estos registros quedan como históricos administrativos."],["La fila de ejemplo debe eliminarse antes de importar."],["El domiciliario se resuelve por UID o por correo. El UID tiene prioridad."]];
  const wi = XLSX.utils.aoa_to_sheet(info); wi["!cols"] = [{ wch: 105 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Domicilios"); XLSX.utils.book_append_sheet(wb, wi, "Instrucciones");
  XLSX.writeFile(wb, "plantilla_carga_domicilios.xlsx");
}

function renderRowsPreview(rows) {
  const preview = $("#svc-preview"); if (!preview) return;
  preview.innerHTML = rows.length ? `<div class="section-head-row"><h3 class="section-title">Vista previa</h3><span class="badge blue">${rows.length} registros</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Domiciliario</th><th>Cliente</th><th>Empresa</th><th>Tarifa</th><th>Total cobrado</th></tr></thead><tbody>${rows.slice(0, 100).map(r => `<tr><td>${esc(dateString(r.fecha))} ${esc(r.hora || "12:00")}</td><td>${esc(r.uid || r.email)}</td><td>${esc(r.cliente)}</td><td>${esc(r.empresa)}</td><td>${money(r.valorDomicilio)}</td><td>${money(r.total)}</td></tr>`).join("")}</tbody></table></div>${rows.length > 100 ? `<p class="form-note">Mostrando 100 de ${rows.length}. La importación procesará todos.</p>` : ""}` : `<div class="empty">Selecciona un archivo para ver la vista previa.</div>`;
}

async function importFile(file) {
  if (!file) return;
  if (!window.XLSX) throw new Error("No se cargó el módulo de Excel. Recarga la aplicación.");
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  if (!wb.SheetNames.length) throw new Error("El archivo no contiene hojas.");
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!raw.length) throw new Error("El archivo no contiene registros.");
  const rows = raw.map((r, i) => normalizeRow(r, i + 2));
  pendingImportRows = rows;
  renderRowsPreview(rows);
  $("#svc-import-action").disabled = false;
  toast(`Archivo leído: ${rows.length} registros listos para importar.`);
}

async function saveManual() {
  const row = normalizeRow({ fecha: $("#svc-fecha").value, hora: $("#svc-hora").value, domiciliario_uid: $("#svc-domi").value, cliente: $("#svc-cliente").value, empresa: $("#svc-empresa").value, valor_domicilio: $("#svc-valor").value, distancia_km: $("#svc-distancia").value, total_cobrado: $("#svc-total").value, medio_pago: $("#svc-medio").value, lat: $("#svc-lat").value, lng: $("#svc-lng").value, observaciones: $("#svc-obs").value }, 2);
  const adminProfile = await getCurrentProfile(auth.currentUser);
  const payload = toEntrega(row, 2, adminProfile, "admin_manual");
  await addDoc(collection(db, "entregas"), payload);
  await addDoc(collection(db, "auditoria"), { accion: "crear_domicilio_admin_manual", usuarioId: adminProfile.uid, usuarioNombre: adminProfile.nombre || adminProfile.email, registros: 1, fecha: serverTimestamp() });
  toast("Domicilio agregado correctamente");
  $("#svc-manual").reset(); $("#svc-fecha").value = today(); $("#svc-hora").value = "12:00";
}

async function saveImport() {
  if (!pendingImportRows.length) throw new Error("Primero selecciona un archivo válido.");
  const adminProfile = await getCurrentProfile(auth.currentUser);
  const payloads = pendingImportRows.map((row, i) => toEntrega(row, i + 2, adminProfile, "admin_importacion"));
  for (let start = 0; start < payloads.length; start += 450) {
    const batch = writeBatch(db);
    payloads.slice(start, start + 450).forEach(payload => batch.set(doc(collection(db, "entregas")), payload));
    await batch.commit();
  }
  await addDoc(collection(db, "auditoria"), { accion: "importar_domicilios_admin", usuarioId: adminProfile.uid, usuarioNombre: adminProfile.nombre || adminProfile.email, registros: payloads.length, archivo: $("#svc-file")?.files?.[0]?.name || null, fecha: serverTimestamp() });
  toast(`${payloads.length} domicilios importados correctamente.`);
  pendingImportRows = [];
  $("#svc-import-action").disabled = true;
  $("#svc-file").value = "";
  renderRowsPreview([]);
}

async function renderPage() {
  if (!currentUserIsAdmin()) return;
  $("#main").innerHTML = `<div class="page-head"><div><h1>Servicios / Domicilios</h1><div class="muted">Agrega servicios realizados por un domiciliario, incluso cuando no fueron registrados durante un turno.</div></div></div>
    <div class="card"><div class="section-head-row"><div><h3 class="section-title">Carga masiva</h3><p class="muted">Descarga la plantilla, diligénciala en Excel y vuelve a subirla. Los registros quedan históricos y participan en Nómina.</p></div><button class="btn secondary" id="svc-template">Descargar plantilla</button></div>
      <div class="form-grid" style="margin-top:12px"><div style="grid-column:1/-1"><label>Archivo (.xlsx, .xls o .csv)</label><input id="svc-file" type="file" accept=".xlsx,.xls,.csv"></div><div style="grid-column:1/-1"><button class="btn primary" id="svc-import-action" disabled>Importar domicilios</button></div></div>
      <div id="svc-preview" style="margin-top:15px"><div class="empty">Selecciona un archivo para ver la vista previa.</div></div></div>
    <div class="card" style="margin-top:15px"><div class="section-head-row"><div><h3 class="section-title">Agregar domicilio manualmente</h3><p class="muted">Úsalo para registrar un servicio histórico o corregir un registro que no se creó desde el turno.</p></div><span class="badge green">Solo administrador</span></div>
      <form id="svc-manual" class="form-grid" style="margin-top:12px">
        <div><label>Fecha</label><input id="svc-fecha" type="date" value="${today()}" required></div><div><label>Hora</label><input id="svc-hora" type="time" value="12:00"></div>
        <div><label>Domiciliario</label><select id="svc-domi" required></select></div><div><label>Empresa / servicio</label><input id="svc-empresa" value="Ferco Farma" required></div>
        <div><label>Cliente</label><input id="svc-cliente" required></div><div><label>Valor domicilio</label><input id="svc-valor" type="number" min="0" step="1" required></div>
        <div><label>Distancia (km)</label><input id="svc-distancia" type="number" min="0" step="0.01"></div><div><label>Total cobrado al cliente</label><input id="svc-total" type="number" min="0" step="1" value="0"></div>
        <div><label>Medio de pago</label><select id="svc-medio"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="datafono">Datáfono</option><option value="credito">Crédito</option><option value="garantia">Garantía/Cruce</option></select></div>
        <div><label>Latitud (opcional)</label><input id="svc-lat" type="number" step="any"></div><div><label>Longitud (opcional)</label><input id="svc-lng" type="number" step="any"></div>
        <div style="grid-column:1/-1"><label>Observaciones</label><textarea id="svc-obs" rows="2"></textarea></div>
        <div style="grid-column:1/-1"><button class="btn green" type="submit">Agregar domicilio</button></div>
      </form></div>`;
  pendingImportRows = [];
  await loadProfiles();
  $("#svc-template").onclick = downloadTemplate;
  $("#svc-file").onchange = async e => { try { await importFile(e.target.files[0]); } catch (error) { pendingImportRows = []; toast(error.message); $("#svc-import-action").disabled = true; renderRowsPreview([]); } };
  $("#svc-import-action").onclick = async () => { const b = $("#svc-import-action"); b.disabled = true; b.textContent = "Importando…"; try { await saveImport(); } catch (error) { toast("No se importó el archivo: " + error.message); b.disabled = false; b.textContent = "Importar domicilios"; } finally { if (b) b.textContent = "Importar domicilios"; } };
  $("#svc-manual").onsubmit = async e => { e.preventDefault(); const b = e.submitter; b.disabled = true; b.textContent = "Guardando…"; try { await saveManual(); } catch (error) { toast("No se pudo agregar: " + error.message); } finally { b.disabled = false; b.textContent = "Agregar domicilio"; } };
}

function addNavButton() {
  if (!currentUserIsAdmin()) return;
  const nav = $("#nav"); if (!nav || nav.querySelector("[data-services-admin]")) return;
  const button = document.createElement("button"); button.className = "nav-item"; button.dataset.servicesAdmin = "true"; button.textContent = "Servicios / Domicilios"; button.onclick = renderPage; nav.appendChild(button);
}

const observer = new MutationObserver(() => addNavButton());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(addNavButton, 500);
