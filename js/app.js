import { watchAuth, login, logout, resetPassword, getCurrentProfile } from "./auth.js";
import { createTurno, closeTurno, getActiveTurno, addEntrega, getOwnEntregas, getEntregasByDate, getTurnosByDate, getUsers, saveUser, cancelEntrega, setSpecialDeliveryFee, getAllTracking, audit } from "./db.js";
import { startTracking, stopTracking, captureDeliveryLocation, getCurrentGps } from "./gps.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = s => document.querySelector(s);
let profile = null;
let activeTurn = null;
let users = [];
let gpsStatus = "inactive";

const navDefs = [
  ["dashboard", "Dashboard", ["admin", "supervisor"]],
  ["turno", "Mi turno", ["admin", "supervisor", "domiciliario"]],
  ["entregas", "Entregas", ["admin", "supervisor"]],
  ["caja", "Caja", ["admin", "supervisor"]],
  ["gps", "GPS en vivo", ["admin", "supervisor"]],
  ["nomina", "Nómina", ["admin", "supervisor"]],
  ["usuarios", "Usuarios", ["admin"]]
];

function canonicalRole(role) {
  return ["domiciliario", "domiciliario1", "domiciliario2"].includes(role) ? "domiciliario" : role;
}
function isDomiciliario(role) { return canonicalRole(role) === "domiciliario"; }
function displayName(p) {
  if (p?.nombre) return p.nombre;
  if (p?.rol === "domiciliario1") return "Domi 1";
  if (p?.rol === "domiciliario2") return "Domi 2";
  return p?.email?.split("@")[0] || "Usuario";
}
function toast(message) {
  const t = $("#toast"); if (!t) return;
  t.textContent = message; t.classList.add("show");
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), 2800);
}
function money(value) { return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])); }
function dateInputToTimestamp(value, end = false) { return Timestamp.fromDate(new Date(value + (end ? "T23:59:59" : "T00:00:00"))); }
function formatDate(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}
function today() { return new Date().toISOString().slice(0, 10); }

function setNetworkStatus() {
  const el = $("#network-status"); if (!el) return;
  el.textContent = navigator.onLine ? "En línea" : "Sin conexión · guardado local";
  el.className = `network-status ${navigator.onLine ? "online" : "offline"}`;
}

function setGpsStatus(status, message = "") {
  gpsStatus = status;
  const labels = { inactive: "GPS inactivo", requesting: "Solicitando GPS…", active: "GPS activo", error: "GPS con alerta", unsupported: "GPS no disponible" };
  document.querySelectorAll("[data-gps-status]").forEach(el => {
    el.textContent = labels[status] || status;
    el.className = `badge ${status === "active" ? "green" : status === "error" ? "red" : "yellow"}`;
    if (message) el.title = message;
  });
}

function renderNav(active = "dashboard") {
  const role = canonicalRole(profile?.rol);
  const items = navDefs.filter(x => x[2].includes(role));
  $("#nav").innerHTML = items.map(([id, label]) => `<button class="nav-item ${id === active ? "active" : ""}" data-route="${id}">${label}</button>`).join("");
  $("#nav").querySelectorAll("[data-route]").forEach(b => b.onclick = () => route(b.dataset.route));
}

async function route(routeName) {
  renderNav(routeName); $("#sidebar")?.classList.remove("open");
  if (routeName === "dashboard") return dashboardView();
  if (routeName === "turno") return turnoView();
  if (routeName === "entregas") return entregasView();
  if (routeName === "caja") return cajaView();
  if (routeName === "gps") return gpsView();
  if (routeName === "nomina") return nominaView();
  if (routeName === "usuarios") return usuariosView();
}

async function startDomiciliaryGps() {
  if (!activeTurn || !isDomiciliario(profile.rol)) return;
  try {
    setGpsStatus("requesting");
    await startTracking(profile, ({ status, message }) => setGpsStatus(status, message));
  } catch (error) {
    setGpsStatus("error", error.message);
    toast(error.message);
  }
}

function stopDomiciliaryGps() {
  stopTracking();
  setGpsStatus("inactive");
}

async function dashboardView() {
  if (isDomiciliario(profile.rol)) return turnoView();
  $("#main").innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><div class="muted">Resumen operativo</div></div></div>
    <div class="grid cards"><div class="card"><div class="metric" id="m-users">…</div><div class="metric-label">Usuarios activos</div></div>
    <div class="card"><div class="metric" id="m-active">…</div><div class="metric-label">Turnos activos</div></div>
    <div class="card"><div class="metric" id="m-gps">…</div><div class="metric-label">GPS publicados</div></div></div>
    <div class="card" style="margin-top:15px"><h3 class="section-title">Sistema unificado</h3><p class="muted">Una sola aplicación. La interfaz cambia según el rol autenticado y Firestore aplica la seguridad real.</p></div>`;
  try {
    users = await getUsers();
    $("#m-users").textContent = users.filter(u => u.activo !== false).length;
    const tracking = await getAllTracking(); $("#m-gps").textContent = tracking.length;
    const active = await Promise.all(users.map(u => getActiveTurno(u.id))); $("#m-active").textContent = active.filter(Boolean).length;
  } catch (e) { toast("No se pudo cargar el dashboard: " + e.message); }
}

async function turnoView() {
  activeTurn = await getActiveTurno(profile.uid);
  const pedidos = await getOwnEntregas(profile.uid);
  const validPedidos = pedidos.filter(p => p.estado !== "anulado");
  const totalPagos = validPedidos.reduce((sum, p) => sum + Number(p.pago?.total || p.valorPagado || 0), 0);
  const gps = getCurrentGps();

  $("#main").innerHTML = `<div class="page-head"><div><h1>Mi turno</h1><div class="muted">${esc(displayName(profile))}</div></div><span data-gps-status class="badge yellow">GPS inactivo</span></div>
    ${activeTurn ? `<div class="card"><div class="toolbar"><span class="badge green">TURNO ACTIVO</span><span>Pedidos: <b>${validPedidos.length}</b></span><span>Total: <b>${money(totalPagos)}</b></span><button class="btn red" id="finish">Finalizar turno</button></div></div>` : `<div class="card"><h3 class="section-title">No hay turno activo</h3><p class="muted">Al iniciar el turno se solicitará el permiso de ubicación del dispositivo.</p><button class="btn green" id="start">Iniciar turno</button></div>`}
    ${activeTurn ? `<div class="card shift-card" style="margin-top:15px"><div class="section-head-row"><div><h3 class="section-title">Nuevo pedido</h3><div class="muted">La ubicación se captura automáticamente. No necesitas escribir coordenadas.</div></div><span class="badge ${navigator.onLine ? "green" : "yellow"}">${navigator.onLine ? "Sincronización activa" : "Sin conexión"}</span></div>
      <form id="pedido" class="form-grid">
        <div><label>Cliente</label><input id="cliente" required autocomplete="off"></div>
        <div><label>Empresa</label><select id="empresa"><option>Ferco Farma</option><option>Hades</option></select></div>
        <div><label>Total</label><input id="total" type="number" min="0" step="1" value="0" inputmode="numeric"></div>
        <div><label>Medio de pago</label><select id="medio"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="datafono">Datáfono</option><option value="credito">Crédito</option><option value="garantia">Garantía/Cruce</option></select></div>
        <div class="location-state" style="grid-column:1/-1"><span class="location-icon">⌖</span><div><strong>Ubicación de entrega</strong><div class="muted" id="location-copy">${gps ? `Capturada · precisión aprox. ${Math.round(gps.accuracy || 0)} m` : "Se capturará automáticamente al registrar el pedido."}</div></div></div>
        <div style="grid-column:1/-1"><button class="btn primary" id="submit-pedido" type="submit">Registrar pedido</button></div>
      </form></div>` : ""}
    <div class="grid cards stats-row" style="margin-top:15px"><div class="card"><div class="metric">${validPedidos.length}</div><div class="metric-label">Pedidos</div></div><div class="card"><div class="metric">${money(totalPagos)}</div><div class="metric-label">Pagos registrados</div></div><div class="card"><div class="metric">${pedidos.filter(p => p.estado === "anulado").length}</div><div class="metric-label">Anulados</div></div></div>
    <div class="card" style="margin-top:15px"><h3 class="section-title">Mis pedidos recientes</h3>${pedidos.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Empresa</th><th>Total</th><th>Estado</th></tr></thead><tbody>${pedidos.map(p => `<tr><td>${esc(formatDate(p.timestamp))}</td><td>${esc(p.cliente)}</td><td>${esc(p.empresa)}</td><td>${money(p.pago?.total || p.valorPagado || 0)}</td><td><span class="badge ${p.estado === "anulado" ? "red" : "green"}">${esc(p.estado || "registrado")}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Sin pedidos registrados.</div>`}</div>`;

  if (activeTurn) {
    setGpsStatus(gps ? "active" : "inactive");
    if (gpsStatus !== "active") await startDomiciliaryGps();
  }

  $("#start")?.addEventListener("click", async () => {
    const button = $("#start"); button.disabled = true; button.textContent = "Iniciando…";
    try {
      activeTurn = await createTurno(profile);
      await startDomiciliaryGps();
      toast("Turno iniciado"); await turnoView();
    } catch (e) { toast(e.message); button.disabled = false; button.textContent = "Iniciar turno"; }
  });

  $("#finish")?.addEventListener("click", async () => {
    if (!confirm("¿Cerrar el turno y detener el GPS?")) return;
    try { await closeTurno(activeTurn.id); stopDomiciliaryGps(); toast("Turno cerrado"); await turnoView(); }
    catch (e) { toast("No se pudo cerrar el turno: " + e.message); }
  });

  $("#pedido")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#submit-pedido"); button.disabled = true; button.textContent = "Capturando ubicación…";
    try {
      const location = await captureDeliveryLocation();
      const total = Number($("#total").value) || 0;
      await addEntrega({
        usuarioId: profile.uid,
        usuarioNombre: displayName(profile),
        usuarioEmail: profile.email,
        creadoPor: profile.uid,
        turnoId: activeTurn.id,
        empresa: $("#empresa").value,
        cliente: $("#cliente").value.trim(),
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy ?? null,
        gpsCapturadoEn: location.timestamp,
        pago: { estado: total > 0 ? "pagado" : "sin_pago", total, medios: [{ medio: $("#medio").value, valor: total }] }
      });
      toast(navigator.onLine ? "Pedido registrado y sincronizado" : "Pedido guardado; se sincronizará al volver la conexión");
      await turnoView();
    } catch (e) {
      toast("No se pudo registrar el pedido: " + e.message);
      button.disabled = false; button.textContent = "Registrar pedido";
    }
  });
}

async function entregasView() {
  const d = today();
  $("#main").innerHTML = `<div class="page-head"><div><h1>Entregas</h1><div class="muted">Consulta y control operativo</div></div></div>
    <div class="card"><div class="form-grid"><div><label>Desde</label><input id="desde" type="date" value="${d}"></div><div><label>Hasta</label><input id="hasta" type="date" value="${d}"></div><div><label>Domiciliario</label><select id="fuser"><option value="">Todos</option></select></div><div style="align-self:end"><button id="buscar" class="btn primary">Consultar</button></div></div></div>
    <div id="result" class="card" style="margin-top:15px"><div class="empty">Cargando…</div></div>`;
  users = await getUsers(); $("#fuser").innerHTML += users.filter(u => isDomiciliario(u.rol) && u.activo !== false).map(u => `<option value="${u.id}">${esc(displayName(u))}</option>`).join("");
  const search = async () => {
    try {
      const data = await getEntregasByDate(dateInputToTimestamp($("#desde").value), dateInputToTimestamp($("#hasta").value, true), $("#fuser").value || null);
      $("#result").innerHTML = `<h3 class="section-title">${data.length} registros</h3>${data.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Domi</th><th>Cliente</th><th>Empresa</th><th>Total</th><th>Tarifa</th><th>GPS</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${data.map(p => `<tr><td>${esc(formatDate(p.timestamp))}</td><td>${esc(p.usuarioNombre)}</td><td>${esc(p.cliente)}</td><td>${esc(p.empresa)}</td><td>${money(p.pago?.total || p.valorPagado || 0)}</td><td>${money(p.valorDomicilio)}<br><small class="muted">${esc(p.tipoTarifa === "especial" ? "Especial" : p.tarifaMotivo || "Pendiente")}</small></td><td>${p.lat != null && p.lng != null ? `<span class="badge green">${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}</span>` : `<span class="badge red">Sin GPS</span>`}</td><td><span class="badge ${p.estado === "anulado" ? "red" : "green"}">${esc(p.estado)}</span></td><td>${p.estado !== "anulado" ? `${profile.rol === "admin" ? `<button class="btn secondary special-fee" data-id="${p.id}" data-value="${Number(p.valorDomicilio || 0)}">Valor especial</button> ` : ""}<button class="btn red cancel" data-id="${p.id}">Anular</button>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Sin resultados.</div>`}`;
      $("#result").querySelectorAll(".cancel").forEach(b => b.onclick = async () => { const motivo = prompt("Motivo de anulación:"); if (!motivo) return; await cancelEntrega(b.dataset.id, motivo, profile); await audit({ accion: "anular_entrega", registroId: b.dataset.id, usuarioId: profile.uid, usuarioNombre: displayName(profile), motivo }); toast("Registro anulado"); await search(); });
      $("#result").querySelectorAll(".special-fee").forEach(b => b.onclick = async () => { const valor = prompt("Valor especial (debe ser mayor a $15.000):", b.dataset.value); if (valor == null) return; const motivo = prompt("Motivo del valor especial:"); if (!motivo) return; try { await setSpecialDeliveryFee(b.dataset.id, valor, motivo, profile); toast("Valor especial registrado y auditado"); await search(); } catch (e) { toast(e.message); } });
    } catch (e) { $("#result").innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  $("#buscar").onclick = search; await search();
}

async function cajaView() {
  const d = today();
  $("#main").innerHTML = `<div class="page-head"><div><h1>Caja</h1><div class="muted">Consolidado por medio de pago</div></div></div><div class="card"><div class="form-grid"><div><label>Desde</label><input id="c1" type="date" value="${d}"></div><div><label>Hasta</label><input id="c2" type="date" value="${d}"></div><div style="align-self:end"><button id="cgo" class="btn primary">Procesar</button></div></div></div><div id="cresult" class="grid cards" style="margin-top:15px"></div>`;
  const process = async () => { const data = await getEntregasByDate(dateInputToTimestamp($("#c1").value), dateInputToTimestamp($("#c2").value, true)); const sums = { efectivo: 0, transferencia: 0, datafono: 0, credito: 0, garantia: 0, total: 0 }; data.filter(x => x.estado !== "anulado").forEach(x => (x.pago?.medios || []).forEach(m => { const v = Number(m.valor) || 0; if (sums[m.medio] !== undefined) sums[m.medio] += v; sums.total += v; })); $("#cresult").innerHTML = Object.entries(sums).map(([k, v]) => `<div class="card"><div class="metric">${money(v)}</div><div class="metric-label">${k}</div></div>`).join(""); };
  $("#cgo").onclick = process; await process();
}

async function gpsView() {
  const data = await getAllTracking();
  $("#main").innerHTML = `<div class="page-head"><div><h1>GPS en vivo</h1><div class="muted">${data.length} posiciones actuales</div></div><button class="btn secondary" id="refresh-gps">Actualizar</button></div>
    <div class="grid cards">${data.map(x => `<div class="card"><div class="section-head-row"><b>${esc(x.usuarioNombre || x.usuarioId)}</b><span class="badge green">ACTIVO</span></div><p class="muted">${Number(x.lat).toFixed(6)}, ${Number(x.lng).toFixed(6)}</p><p class="muted">Precisión: ${Math.round(Number(x.accuracy) || 0)} m</p><span class="badge blue">${esc(formatDate(x.actualizadoEn))}</span></div>`).join("") || `<div class="card empty">No hay posiciones publicadas.</div>`}</div>
    <div class="map-placeholder" style="margin-top:15px">Mapa visual preparado para la siguiente iteración. Los puntos GPS ya quedan separados de los pedidos.</div>`;
  $("#refresh-gps").onclick = () => route("gps");
}

async function nominaView() {
  const d = today();
  $("#main").innerHTML = `<div class="page-head"><div><h1>Nómina</h1><div class="muted">Turnos reales + domicilios registrados.</div></div></div><div class="card"><div class="form-grid"><div><label>Desde</label><input id="n1" type="date" value="${d}"></div><div><label>Hasta</label><input id="n2" type="date" value="${d}"></div><div style="align-self:end"><button id="ngo" class="btn primary">Calcular</button></div></div><p class="form-note">Base de turno: $50.000. Nómina suma el <b>valorDomicilioCongelado</b> de cada entrega (incluyendo los valores especiales autorizados).</p></div><div id="nresult" class="card" style="margin-top:15px"><div class="empty">Procesa un rango.</div></div>`;
  $("#ngo").onclick = async () => {
    try {
      users = await getUsers();
      const start = $("#n1").value, end = $("#n2").value;
      const turns = await getTurnosByDate(start, end);
      const rows = [];
      for (const u of users.filter(x => isDomiciliario(x.rol) && x.activo !== false)) {
        const deliveries = await getEntregasByDate(dateInputToTimestamp(start), dateInputToTimestamp(end, true), u.id);
        const valid = deliveries.filter(x => x.estado !== "anulado");
        const shifts = turns.filter(x => x.usuarioId === u.id).length;
        const domicilios = valid.reduce((sum, x) => sum + Number(x.valorDomicilioCongelado ?? x.valorDomicilio ?? 0), 0);
        rows.push({ name: displayName(u), shifts, deliveries: valid.length, base: shifts * 50000, domicilios, total: shifts * 50000 + domicilios });
      }
      $("#nresult").innerHTML = `<h3 class="section-title">Liquidación</h3><div class="table-wrap"><table class="table"><thead><tr><th>Domiciliario</th><th>Turnos</th><th>Domicilios</th><th>Base</th><th>Pago domicilios</th><th>Total</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.shifts}</td><td>${r.deliveries}</td><td>${money(r.base)}</td><td>${money(r.domicilios)}</td><td><b>${money(r.total)}</b></td></tr>`).join("")}</tbody></table></div>`;
    } catch (e) { $("#nresult").innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
}

async function usuariosView() {
  users = await getUsers();
  $("#main").innerHTML = `<div class="page-head"><div><h1>Usuarios</h1><div class="muted">El administrador gestiona el perfil y permisos. Las cuentas de Authentication se crean desde Firebase Console o Admin SDK.</div></div></div>
    <div class="card"><h3 class="section-title">Perfil de usuario</h3><form id="user-form" class="form-grid"><div><label>UID</label><input id="u-uid" class="readonly" readonly></div><div><label>Nombre</label><input id="u-name"></div><div><label>Correo</label><input id="u-email" type="email"></div><div><label>Rol</label><select id="u-role"><option value="admin">admin</option><option value="supervisor">supervisor</option><option value="domiciliario1">domiciliario1</option><option value="domiciliario2">domiciliario2</option></select></div><div><label>Activo</label><select id="u-active"><option value="true">Sí</option><option value="false">No</option></select></div><div class="form-actions" style="align-self:end"><button class="btn green" type="submit">Guardar perfil</button><button class="btn secondary hidden" id="u-cancel" type="button">Cancelar</button></div></form></div>
    <div class="card" style="margin-top:15px"><div class="section-head-row"><h3 class="section-title">Perfiles registrados</h3><span class="badge blue">Editable</span></div><div class="table-wrap"><table class="table"><thead><tr><th>UID</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th><th>Acción</th></tr></thead><tbody>${users.map(u => `<tr><td class="td-mono">${esc(u.id)}</td><td>${esc(u.nombre || "")}</td><td>${esc(u.email || "")}</td><td><span class="badge blue">${esc(u.rol || "")}</span></td><td>${u.activo === false || u.activo === "false" ? "No" : "Sí"}</td><td><button class="btn secondary edit-user" data-id="${esc(u.id)}">Editar</button></td></tr>`).join("")}</tbody></table></div></div>`;

  const form = $("#user-form");
  const cancel = $("#u-cancel");
  const clear = () => { form.reset(); $("#u-uid").value = ""; $("#u-email").value = ""; $("#u-active").value = "true"; cancel.classList.add("hidden"); };
  document.querySelectorAll(".edit-user").forEach(button => button.onclick = () => {
    const u = users.find(x => x.id === button.dataset.id); if (!u) return;
    $("#u-uid").value = u.id; $("#u-name").value = u.nombre || ""; $("#u-email").value = u.email || ""; $("#u-role").value = u.rol || "domiciliario1"; $("#u-active").value = (u.activo === false || u.activo === "false") ? "false" : "true"; cancel.classList.remove("hidden"); form.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  cancel.onclick = clear;
  form.onsubmit = async e => { e.preventDefault(); const uid = $("#u-uid").value; if (!uid) return toast("Selecciona un perfil registrado."); try { await saveUser(uid, { nombre: $("#u-name").value.trim(), email: $("#u-email").value.trim(), rol: $("#u-role").value, activo: $("#u-active").value === "true" }); toast("Perfil guardado"); await usuariosView(); } catch (err) { toast("No se pudo guardar: " + err.message); } };
}

$("#login-form").onsubmit = async e => { e.preventDefault(); const error = $("#login-error"); error.classList.add("hidden"); try { await login($("#login-email").value.trim(), $("#login-password").value); } catch (err) { error.textContent = humanAuthError(err); error.classList.remove("hidden"); } };
$("#forgot-password").onclick = async () => { const email = $("#login-email").value.trim(); if (!email) return toast("Escribe primero tu correo."); try { await resetPassword(email); toast("Correo de restablecimiento enviado."); } catch (e) { toast(e.message); } };
$("#logout").onclick = async () => { stopDomiciliaryGps(); await logout(); };
$("#menu-toggle").onclick = () => $("#sidebar")?.classList.toggle("open");
window.addEventListener("online", setNetworkStatus); window.addEventListener("offline", setNetworkStatus); setNetworkStatus();

function humanAuthError(e) { const c = e?.code || ""; if (c.includes("invalid-credential")) return "Correo o contraseña incorrectos."; if (c.includes("too-many-requests")) return "Demasiados intentos. Intenta más tarde."; if (c.includes("user-disabled")) return "Usuario deshabilitado."; return e?.message || "No fue posible iniciar sesión."; }

watchAuth(async user => {
  if (!user) { profile = null; stopDomiciliaryGps(); $("#app").classList.add("hidden"); $("#login-screen").classList.remove("hidden"); return; }
  try {
    profile = await getCurrentProfile(user);
    $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden");
    $("#user-name").textContent = displayName(profile); $("#user-role").textContent = canonicalRole(profile.rol); setNetworkStatus();
    const initialRoute = isDomiciliario(profile.rol) ? "turno" : "dashboard";
    renderNav(initialRoute); await route(initialRoute);
  } catch (e) {
    await logout(); $("#login-error").textContent = e.message; $("#login-error").classList.remove("hidden");
  }
});
