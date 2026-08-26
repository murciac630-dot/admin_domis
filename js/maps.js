import { db } from "./firebase.js";
import { deleteField, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const DEFAULT_OPERATION_CONFIG = {
  mapCenter: { lat: 3.4516, lng: -76.5320 },
  tarifa: {
    activa: true,
    limiteKm: 3.5,
    hastaLimite: 10000,
    sobreLimite: 15000,
    permiteEspecial: true
  },
  version: 1
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getOperationConfig() {
  const snap = await getDoc(doc(db, "configuracion", "operacion"));
  if (!snap.exists()) return structuredClone(DEFAULT_OPERATION_CONFIG);
  const data = snap.data();
  return {
    ...DEFAULT_OPERATION_CONFIG,
    ...data,
    mapCenter: { ...DEFAULT_OPERATION_CONFIG.mapCenter, ...(data.mapCenter || {}) },
    tarifa: { ...DEFAULT_OPERATION_CONFIG.tarifa, ...(data.tarifa || {}) }
  };
}

export async function saveOperationConfig(config, user) {
  const clean = {
    mapCenter: { lat: num(config.mapCenter?.lat), lng: num(config.mapCenter?.lng) },
    tarifa: {
      activa: Boolean(config.tarifa?.activa),
      limiteKm: Math.max(0, num(config.tarifa?.limiteKm, 3.5)),
      hastaLimite: 10000,
      sobreLimite: 15000,
      permiteEspecial: config.tarifa?.permiteEspecial !== false,
      // Retira claves del esquema proporcional que pudiera conservar un documento legado.
      base: deleteField(), porKm: deleteField(), minima: deleteField(), maxima: deleteField(), redondeo: deleteField()
    },
    version: num(config.version, 1),
    actualizadoPor: user?.uid || null,
    actualizadoEn: serverTimestamp()
  };
  await setDoc(doc(db, "configuracion", "operacion"), clean, { merge: true });
  return clean;
}

export function haversineKm(a, b) {
  if (!a || !b) return null;
  const lat1 = num(a.lat, NaN), lng1 = num(a.lng, NaN), lat2 = num(b.lat, NaN), lng2 = num(b.lng, NaN);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const R = 6371;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function calculateDeliveryFee(distanceKm, tarifa) {
  if (!Number.isFinite(Number(distanceKm))) return { valor: 0, calculada: false, motivo: "Distancia no disponible" };
  const distance = Math.max(0, num(distanceKm));
  const t = { ...DEFAULT_OPERATION_CONFIG.tarifa, ...(tarifa || {}) };
  if (!t.activa) return { valor: 0, calculada: false, motivo: "Tarifa no activada" };
  const limit = Math.max(0, num(t.limiteKm, 3.5));
  const withinLimit = distance <= limit;
  return {
    valor: withinLimit ? 10000 : 15000,
    calculada: true,
    motivo: withinLimit ? `Hasta ${limit} km` : `Más de ${limit} km`,
    tipo: withinLimit ? "rango_10000" : "rango_15000"
  };
}

export async function calculateDeliveryPricing(location) {
  const config = await getOperationConfig();
  const distanceKm = haversineKm(config.mapCenter, location);
  const fee = calculateDeliveryFee(distanceKm, config.tarifa);
  return {
    distanciaTarifableKm: distanceKm == null ? null : Number(distanceKm.toFixed(3)),
    valorDomicilio: fee.valor,
    tarifaCalculada: fee.calculada,
    tarifaMotivo: fee.motivo,
    tipoTarifa: fee.tipo || "pendiente",
    tarifaBase: fee.valor,
    valorDomicilioCongelado: fee.valor,
    tarifaVersion: config.version || 1,
    origenTarifa: config.mapCenter,
    tarifa: config.tarifa
  };
}

export function renderTrackingMap(container, tracking, center = DEFAULT_OPERATION_CONFIG.mapCenter) {
  if (!container || !window.L) return null;
  const rows = (tracking || []).filter(x => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)));
  const first = rows[0] || center;
  const map = window.L.map(container, { zoomControl: true }).setView([Number(first.lat), Number(first.lng)], rows.length ? 13 : 12);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const markers = [];
  rows.forEach(row => {
    const marker = window.L.marker([Number(row.lat), Number(row.lng)]).addTo(map);
    marker.bindPopup(`<strong>${escapeHtml(row.usuarioNombre || row.usuarioId || "Domiciliario")}</strong><br>${Number(row.lat).toFixed(5)}, ${Number(row.lng).toFixed(5)}<br>Precisión: ${Math.round(Number(row.accuracy) || 0)} m`);
    markers.push(marker);
  });
  if (markers.length > 1) {
    const bounds = window.L.featureGroup(markers).getBounds().pad(0.15);
    map.fitBounds(bounds);
  }
  setTimeout(() => map.invalidateSize(), 100);
  return map;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
