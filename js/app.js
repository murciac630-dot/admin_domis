import { watchAuth, login, logout, resetPassword, getCurrentProfile } from "./auth.js";
import { createTurno, closeTurno, getActiveTurno, addEntrega, getOwnEntregas, getEntregasByDate, getUsers, saveUser, cancelEntrega, getAllTracking, audit } from "./db.js";
import { db } from "./firebase.js";
import { doc, getDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $=s=>document.querySelector(s);
let profile=null, activeTurn=null, users=[];

const navDefs=[
  ["dashboard","Dashboard",["admin","supervisor"]],
  ["turno","Mi turno",["admin","supervisor","domiciliario"]],
  ["entregas","Entregas",["admin","supervisor"]],
  ["caja","Caja",["admin","supervisor"]],
  ["gps","GPS en vivo",["admin","supervisor"]],
  ["nomina","Nómina",["admin","supervisor"]],
  ["usuarios","Usuarios",["admin"]]
];

// Los roles existentes en Firebase son "domiciliario1" y "domiciliario2".
// Para permisos de interfaz se normalizan a "domiciliario", pero el valor
// original del campo rol se conserva en Firestore.
function canonicalRole(rol){
  return ["domiciliario","domiciliario1","domiciliario2"].includes(rol) ? "domiciliario" : rol;
}
function isDomiciliario(rol){return canonicalRole(rol)==="domiciliario";}
function displayName(p){
  if(p?.nombre) return p.nombre;
  if(p?.rol === "domiciliario1") return "Domi 1";
  if(p?.rol === "domiciliario2") return "Domi 2";
  if(p?.email) return p.email.split("@")[0];
  return "Usuario";
}

function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2800)}
function money(v){return new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(v)||0)}
function dateInputToDate(v,end=false){return Timestamp.fromDate(new Date(v+(end?"T23:59:59":"T00:00:00")))}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

function renderNav(active="dashboard"){
  const role=canonicalRole(profile.rol);
  const items=navDefs.filter(x=>x[2].includes(role));
  $("#nav").innerHTML=items.map(([id,label])=>`<button class="nav-item ${id===active?"active":""}" data-route="${id}">${label}</button>`).join("");
  $("#nav").querySelectorAll("[data-route]").forEach(b=>b.onclick=()=>route(b.dataset.route));
}

async function route(r){
  renderNav(r);$("#sidebar").classList.remove("open");
  if(r==="dashboard") return dashboard();
  if(r==="turno") return turnoView();
  if(r==="entregas") return entregasView();
  if(r==="caja") return cajaView();
  if(r==="gps") return gpsView();
  if(r==="nomina") return nominaView();
  if(r==="usuarios") return usuariosView();
}

async function dashboard(){
  if(isDomiciliario(profile.rol)) return turnoView();
  $("#main").innerHTML=`<div class="page-head"><div><h1>Dashboard</h1><div class="muted">Resumen operativo</div></div></div>
  <div class="grid cards"><div class="card"><div class="metric" id="m-users">…</div><div class="metric-label">Usuarios</div></div>
  <div class="card"><div class="metric" id="m-active">…</div><div class="metric-label">Turnos activos</div></div>
  <div class="card"><div class="metric" id="m-gps">…</div><div class="metric-label">Ubicaciones en vivo</div></div></div>
  <div class="card" style="margin-top:15px"><h3 class="section-title">Arquitectura activa</h3><p class="muted">Una sola aplicación. La interfaz y las operaciones dependen del rol autenticado. Firestore Rules aplican la seguridad real.</p></div>`;
  users=await getUsers();$("#m-users").textContent=users.filter(u=>u.activo!==false).length;
  const tr=await getAllTracking();$("#m-gps").textContent=tr.length;
  const active=await Promise.all(users.map(u=>getActiveTurno(u.id)));$("#m-active").textContent=active.filter(Boolean).length;
}

async function turnoView(){
  activeTurn=await getActiveTurno(profile.uid);
  const pedidos=await getOwnEntregas(profile.uid);
  $("#main").innerHTML=`<div class="page-head"><div><h1>Mi turno</h1><div class="muted">${esc(displayName(profile))} · ${esc(profile.rol)}</div></div></div>
  ${activeTurn?`<div class="card"><div class="toolbar"><span class="badge green">TURNO ACTIVO</span><span>Pedidos: <b>${pedidos.filter(p=>p.estado!=="anulado").length}</b></span><button class="btn red" id="finish">Finalizar turno</button></div></div>`:
  `<div class="card"><h3 class="section-title">No hay turno activo</h3><button class="btn green" id="start">Iniciar turno</button></div>`}
  ${activeTurn?`<div class="card" style="margin-top:15px"><h3 class="section-title">Nuevo pedido</h3>
  <form id="pedido" class="form-grid">
    <div><label>Cliente</label><input id="cliente" required></div>
    <div><label>Empresa</label><select id="empresa"><option>Ferco Farma</option><option>Hades</option></select></div>
    <div><label>Total</label><input id="total" type="number" min="0" value="0"></div>
    <div><label>Medio de pago</label><select id="medio"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="datafono">Datáfono</option><option value="credito">Crédito</option><option value="garantia">Garantía/Cruce</option></select></div>
    <div><label>Latitud</label><input id="lat" type="number" step="any" placeholder="Opcional"></div>
    <div><label>Longitud</label><input id="lng" type="number" step="any" placeholder="Opcional"></div>
    <div style="grid-column:1/-1"><button class="btn primary" type="submit">Registrar pedido</button></div>
  </form></div>`:""}
  <div class="card" style="margin-top:15px"><h3 class="section-title">Mis pedidos recientes</h3>${pedidos.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Empresa</th><th>Total</th><th>Estado</th></tr></thead><tbody>${pedidos.map(p=>`<tr><td>${esc(formatDate(p.timestamp))}</td><td>${esc(p.cliente)}</td><td>${esc(p.empresa)}</td><td>${money(p.pago?.total||p.valorPagado||0)}</td><td><span class="badge ${p.estado==="anulado"?"red":"green"}">${esc(p.estado||"registrado")}</span></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">Sin pedidos registrados.</div>`}</div>`;
  if($("#start"))$("#start").onclick=async()=>{activeTurn=await createTurno(profile);toast("Turno iniciado");route("turno")};
  if($("#finish"))$("#finish").onclick=async()=>{if(confirm("¿Cerrar el turno?")){await closeTurno(activeTurn.id);toast("Turno cerrado");route("turno")}};
  if($("#pedido"))$("#pedido").onsubmit=async e=>{e.preventDefault();const total=Number($("#total").value)||0;let lat=Number($("#lat").value),lng=Number($("#lng").value);if(!lat||!lng){try{const pos=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:7000}));lat=pos.coords.latitude;lng=pos.coords.longitude}catch{}}
    await addEntrega({usuarioId:profile.uid,usuarioNombre:displayName(profile),creadoPor:profile.uid,turnoId:activeTurn.id,empresa:$("#empresa").value,cliente:$("#cliente").value.trim(),timestamp:null,lat:lat||null,lng:lng||null,pago:{estado:total>0?"pagado":"sin_pago",total,medios:[{medio:$("#medio").value,valor:total}]}});
    toast("Pedido registrado");route("turno");
  };
}

async function entregasView(){
  $("#main").innerHTML=`<div class="page-head"><div><h1>Entregas</h1><div class="muted">Consulta y control operativo</div></div></div>
  <div class="card"><div class="form-grid"><div><label>Desde</label><input id="desde" type="date"></div><div><label>Hasta</label><input id="hasta" type="date"></div><div><label>Domiciliario</label><select id="fuser"><option value="">Todos</option></select></div><div style="align-self:end"><button id="buscar" class="btn primary">Consultar</button></div></div></div>
  <div id="result" class="card" style="margin-top:15px"><div class="empty">Selecciona un rango.</div></div>`;
  users=await getUsers();$("#fuser").innerHTML+=users.filter(u=>isDomiciliario(u.rol)&&u.activo!==false).map(u=>`<option value="${u.id}">${esc(displayName(u))}</option>`).join("");
  const today=new Date().toISOString().slice(0,10);$("#desde").value=today;$("#hasta").value=today;
  $("#buscar").onclick=async()=>{try{const data=await getEntregasByDate(dateInputToDate($("#desde").value),dateInputToDate($("#hasta").value,true),$("#fuser").value||null);$("#result").innerHTML=`<h3 class="section-title">${data.length} registros</h3>${data.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Domi</th><th>Cliente</th><th>Empresa</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${data.map(p=>`<tr><td>${esc(formatDate(p.timestamp))}</td><td>${esc(p.usuarioNombre)}</td><td>${esc(p.cliente)}</td><td>${esc(p.empresa)}</td><td>${money(p.pago?.total||p.valorPagado||0)}</td><td>${esc(p.estado)}</td><td>${p.estado!=="anulado"?`<button class="btn red cancel" data-id="${p.id}">Anular</button>`:"—"}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">Sin resultados.</div>`}`;$("#result").querySelectorAll(".cancel").forEach(b=>b.onclick=async()=>{const motivo=prompt("Motivo de anulación:");if(motivo){await cancelEntrega(b.dataset.id,motivo,profile);await audit({accion:"anular_entrega",registroId:b.dataset.id,usuarioId:profile.uid,usuarioNombre:displayName(profile),motivo});toast("Registro anulado");$("#buscar").click()}})}catch(e){toast("No se pudo consultar: "+e.message)}};
}

async function cajaView(){
  const today=new Date().toISOString().slice(0,10);$("#main").innerHTML=`<div class="page-head"><div><h1>Caja</h1><div class="muted">Consolidado por medio de pago</div></div></div><div class="card"><div class="form-grid"><div><label>Desde</label><input id="c1" type="date" value="${today}"></div><div><label>Hasta</label><input id="c2" type="date" value="${today}"></div><div style="align-self:end"><button id="cgo" class="btn primary">Procesar</button></div></div></div><div id="cresult" class="grid cards" style="margin-top:15px"></div>`;
  $("#cgo").onclick=async()=>{const data=await getEntregasByDate(dateInputToDate($("#c1").value),dateInputToDate($("#c2").value,true));const sums={efectivo:0,transferencia:0,datafono:0,credito:0,garantia:0,total:0};data.filter(x=>x.estado!=="anulado").forEach(x=>(x.pago?.medios||[]).forEach(m=>{const k=m.medio;const v=Number(m.valor)||0;if(sums[k]!==undefined)sums[k]+=v;sums.total+=v}));$("#cresult").innerHTML=Object.entries(sums).map(([k,v])=>`<div class="card"><div class="metric">${money(v)}</div><div class="metric-label">${k}</div></div>`).join("")};$("#cgo").click();
}

async function gpsView(){const data=await getAllTracking();$("#main").innerHTML=`<div class="page-head"><div><h1>GPS en vivo</h1><div class="muted">${data.length} posiciones publicadas</div></div><button class="btn secondary" id="refresh-gps">Actualizar</button></div><div class="grid cards">${data.map(x=>`<div class="card"><b>${esc(x.usuarioNombre||x.usuarioId)}</b><p class="muted">${esc(x.lat)}, ${esc(x.lng)}</p><span class="badge green">${esc(formatDate(x.actualizadoEn))}</span></div>`).join("")||`<div class="card empty">No hay posiciones.</div>`}</div><div class="map-placeholder" style="margin-top:15px">Mapa visual: integrar Leaflet/Google Maps en la siguiente iteración. Los datos GPS ya quedan separados de los pedidos.</div>`;$("#refresh-gps").onclick=()=>route("gps")}

async function nominaView(){const today=new Date().toISOString().slice(0,10);$("#main").innerHTML=`<div class="page-head"><div><h1>Nómina</h1><div class="muted">Basada en turnos reales, no en inferencias de pedidos.</div></div></div><div class="card"><div class="form-grid"><div><label>Desde</label><input id="n1" type="date" value="${today}"></div><div><label>Hasta</label><input id="n2" type="date" value="${today}"></div><div style="align-self:end"><button id="ngo" class="btn primary">Calcular</button></div></div></div><div id="nresult" class="card" style="margin-top:15px"><div class="empty">Procesa un rango.</div></div>`;$("#ngo").onclick=async()=>{users=await getUsers();const rows=[];for(const u of users.filter(x=>x.rol==="domiciliario"&&x.activo!==false)){const qs=await getEntregasByDate(dateInputToDate($("#n1").value),dateInputToDate($("#n2").value,true),u.id);const turnos=[...new Set(qs.map(q=>q.turnoId).filter(Boolean))];rows.push({u,turnos:turnos.length,pedidos:qs.filter(q=>q.estado!=="anulado").length,domis:qs.filter(q=>q.estado!=="anulado").reduce((s,q)=>s+Number(q.tarifaDomicilio||0),0)})}$("#nresult").innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>Domiciliario</th><th>Turnos</th><th>Pedidos</th><th>Base</th><th>Domicilios</th><th>Total</th></tr></thead><tbody>${rows.map(r=>{const base=r.turnos*50000;return`<tr><td>${esc(displayName(r.u))}</td><td>${r.turnos}</td><td>${r.pedidos}</td><td>${money(base)}</td><td>${money(r.domis)}</td><td><b>${money(base+r.domis)}</b></td></tr>`}).join("")}</tbody></table></div>`};}

async function usuariosView(){if(profile.rol!=="admin")return;users=await getUsers();$("#main").innerHTML=`<div class="page-head"><div><h1>Usuarios</h1><div class="muted">El administrador gestiona el perfil y permisos. Las cuentas de Authentication se crean desde Firebase Console o Admin SDK.</div></div></div><div class="card"><h3 class="section-title">Perfil de usuario</h3><form id="uf" class="form-grid"><div><label>UID</label><input id="uid" required placeholder="UID de Authentication"></div><div><label>Nombre</label><input id="unombre" required></div><div><label>Correo</label><input id="uemail" type="email"></div><div><label>Rol</label><select id="urole"><option>domiciliario1</option><option>domiciliario2</option><option>supervisor</option><option>admin</option></select></div><div><label>Activo</label><select id="uactivo"><option value="true">Sí</option><option value="false">No</option></select></div><div style="align-self:end"><button class="btn green">Guardar perfil</button></div></form></div><div class="card" style="margin-top:15px"><h3 class="section-title">Perfiles registrados</h3><div class="table-wrap"><table class="table"><thead><tr><th>UID</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.id)}</td><td>${esc(displayName(u))}</td><td>${esc(u.email)}</td><td><span class="badge blue">${esc(u.rol)}</span></td><td>${u.activo!==false?"Sí":"No"}</td></tr>`).join("")}</tbody></table></div></div>`;$("#uf").onsubmit=async e=>{e.preventDefault();await saveUser($("#uid").value.trim(),{nombre:$("#unombre").value.trim(),email:$("#uemail").value.trim(),rol:$("#urole").value,activo:$("#uactivo").value==="true"});toast("Perfil guardado");route("usuarios")}}

function formatDate(v){if(!v)return"—";try{if(v.toDate)return v.toDate().toLocaleString("es-CO");if(v.seconds)return new Date(v.seconds*1000).toLocaleString("es-CO");return new Date(v).toLocaleString("es-CO")}catch{return"—"}}

$("#login-form").onsubmit=async e=>{e.preventDefault();$("#login-error").classList.add("hidden");try{await login($("#login-email").value.trim(),$("#login-password").value)}catch(err){$("#login-error").textContent=humanAuthError(err);$("#login-error").classList.remove("hidden")}};
$("#forgot-password").onclick=async()=>{try{await resetPassword($("#login-email").value.trim());toast("Revisa tu correo para restablecer la contraseña")}catch(e){toast("Indica primero un correo válido")}};
$("#logout").onclick=()=>logout();$("#menu-toggle").onclick=()=>$("#sidebar").classList.toggle("open");

function humanAuthError(e){const c=e?.code||"";if(c.includes("invalid-credential"))return"Correo o contraseña incorrectos.";if(c.includes("too-many-requests"))return"Demasiados intentos. Intenta más tarde.";if(c.includes("user-disabled"))return"Usuario deshabilitado.";return e?.message||"No fue posible iniciar sesión."}

watchAuth(async user=>{if(!user){profile=null;$("#app").classList.add("hidden");$("#login-screen").classList.remove("hidden");return}try{profile=await getCurrentProfile(user);$("#login-screen").classList.add("hidden");$("#app").classList.remove("hidden");$("#user-name").textContent=profile.nombre;$("#user-role").textContent=profile.rol;renderNav(profile.rol==="domiciliario"?"turno":"dashboard");await route(profile.rol==="domiciliario"?"turno":"dashboard")}catch(e){await logout();$("#login-error").textContent=e.message;$("#login-error").classList.remove("hidden")}});