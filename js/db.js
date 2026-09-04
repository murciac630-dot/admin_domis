import { db } from "./firebase.js";
import { calculateDeliveryPricing, getOperationConfig } from "./maps.js";
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const col = name => collection(db, name);

export async function getUsers() {
  const s = await getDocs(col("usuarios"));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.nombre || a.email || a.id).localeCompare(String(b.nombre || b.email || b.id), "es"));
}

export async function getUser(uid) {
  const s = await getDoc(doc(db, "usuarios", uid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function saveUser(uid, data) {
  return setDoc(doc(db, "usuarios", uid), { ...data, actualizadoEn: serverTimestamp() }, { merge: true });
}

export async function createTurno(user) {
  const existing = await getActiveTurno(user.uid);
  if (existing) return existing;
  const ref = await addDoc(col("turnos"), {
    usuarioId: user.uid,
    usuarioNombre: user.nombre || user.email?.split("@")[0] || user.uid,
    usuarioEmail: user.email || null,
    fechaLocal: new Date().toISOString().slice(0, 10),
    inicio: serverTimestamp(),
    estado: "activo",
    pedidos: 0,
    creadoEn: serverTimestamp()
  });
  return { id: ref.id, usuarioId: user.uid, estado: "activo" };
}

export async function closeTurno(id) {
  return updateDoc(doc(db, "turnos", id), {
    fin: serverTimestamp(),
    estado: "cerrado",
    actualizadoEn: serverTimestamp()
  });
}

export async function getActiveTurno(uid) {
  const s = await getDocs(query(col("turnos"), where("usuarioId", "==", uid), where("estado", "==", "activo"), limit(1)));
  return s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
}

export async function getTurnosByDate(startDate, endDate, uid = null) {
  const clauses = [where("fechaLocal", ">=", startDate), where("fechaLocal", "<=", endDate), orderBy("fechaLocal", "desc"), limit(1000)];
  const s = await getDocs(query(col("turnos"), ...clauses));
  const rows = s.docs.map(d => ({ id: d.id, ...d.data() }));
  return uid ? rows.filter(x => x.usuarioId === uid) : rows;
}

export async function incrementTurnoPedidos(turnoId) {
  const ref = doc(db, "turnos", turnoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  return updateDoc(ref, { pedidos: Number(snap.data().pedidos || 0) + 1, actualizadoEn: serverTimestamp() });
}

export async function addEntrega(data) {
  let pricing = {};
  if (Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng))) {
    try { pricing = await calculateDeliveryPricing({ lat: Number(data.lat), lng: Number(data.lng) }); }
    catch { pricing = { tarifaCalculada: false, tarifaMotivo: "No se pudo calcular la tarifa" }; }
  }
  const ref = await addDoc(col("entregas"), {
    ...data,
    ...pricing,
    creadoPor: data.creadoPor || data.usuarioId,
    usuarioEmail: data.usuarioEmail || null,
    timestamp: data.timestamp || serverTimestamp(),
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
    estado: "registrado"
  });
  if (data.turnoId) await incrementTurnoPedidos(data.turnoId);
  return ref;
}

// En "Mi turno" solo deben aparecer los pedidos del turno actualmente activo.
// Los documentos históricos no se eliminan: siguen disponibles para Entregas y Nómina.
export async function getOwnEntregas(uid) {
  const activeTurn = await getActiveTurno(uid);
  if (!activeTurn?.id) return [];

  const s = await getDocs(query(col("entregas"), where("turnoId", "==", activeTurn.id), limit(500)));
  return s.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const da = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || 0).getTime();
      const db = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || 0).getTime();
      return db - da;
    });
}

export async function getEntregasByDate(start, end, uid = null) {
  const clauses = [where("timestamp", ">=", start), where("timestamp", "<=", end), orderBy("timestamp", "desc"), limit(1000)];
  if (uid) clauses.unshift(where("usuarioId", "==", uid));
  const s = await getDocs(query(col("entregas"), ...clauses));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateEntrega(id, data) {
  return updateDoc(doc(db, "entregas", id), { ...data, actualizadoEn: serverTimestamp() });
}

export async function setSpecialDeliveryFee(id, valorEspecial, motivo, user) {
  const valor = Number(valorEspecial);
  const cleanMotivo = String(motivo || "").trim();
  if (!Number.isFinite(valor) || valor <= 15000) throw new Error("El valor especial debe ser superior a $15.000.");
  if (!cleanMotivo) throw new Error("El motivo del valor especial es obligatorio.");
  const operationConfig = await getOperationConfig();
  if (operationConfig.tarifa?.permiteEspecial === false) throw new Error("Los valores especiales están desactivados en Configuración.");
  const entregaRef = doc(db, "entregas", id);
  const entrega = await getDoc(entregaRef);
  if (!entrega.exists()) throw new Error("La entrega ya no existe.");
  const batch = writeBatch(db);
  batch.update(entregaRef, {
    valorDomicilio: Math.round(valor), valorDomicilioCongelado: Math.round(valor), tipoTarifa: "especial",
    tarifaBase: Number(entrega.data().tarifaBase || entrega.data().valorDomicilio || 15000),
    tarifaMotivo: cleanMotivo, modificadoPor: user.uid, modificadoPorNombre: user.nombre || user.email || user.uid,
    modificadoEn: serverTimestamp(), actualizadoEn: serverTimestamp()
  });
  batch.set(doc(col("auditoria")), {
    accion: "asignar_valor_especial_domicilio", registroId: id, usuarioId: user.uid,
    usuarioNombre: user.nombre || user.email || user.uid, valorAnterior: Number(entrega.data().valorDomicilio || 0),
    valorNuevo: Math.round(valor), motivo: cleanMotivo, fecha: serverTimestamp()
  });
  await batch.commit();
}

export async function cancelEntrega(id, motivo, user) {
  return updateDoc(doc(db, "entregas", id), {
    estado: "anulado",
    motivoAnulacion: motivo,
    anuladoPor: user.uid,
    anuladoPorNombre: user.nombre || user.email,
    anuladoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp()
  });
}

export async function setTracking(userId, data) {
  return setDoc(doc(db, "tracking_actual", userId), {
    ...data,
    usuarioId: userId,
    actualizadoEn: serverTimestamp()
  }, { merge: true });
}

export async function addTrackingHistory(userId, data) {
  return addDoc(col("tracking_historial"), {
    ...data,
    usuarioId: userId,
    creadoEn: serverTimestamp()
  });
}

export async function getAllTracking() {
  const s = await getDocs(col("tracking_actual"));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function audit(data) {
  return addDoc(col("auditoria"), { ...data, fecha: serverTimestamp() });
}
