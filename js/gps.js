import { setTracking, addTrackingHistory } from "./db.js";

let watchId = null;
let currentPosition = null;
let lastTrackingAt = 0;
let lastTrackingPosition = null;
let lastHistoryAt = 0;
let lastHistoryPosition = null;
let currentUser = null;
let statusCallback = () => {};

const TRACKING_INTERVAL_MS = 30 * 1000;
const TRACKING_DISTANCE_M = 25;
const HISTORY_INTERVAL_MS = 3 * 60 * 1000;
const HISTORY_DISTANCE_M = 75;

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function emit(status, extra = {}) { statusCallback({ status, ...extra }); }
function normalizeError(error) {
  if (error?.code === 1) return "Permiso de ubicación denegado.";
  if (error?.code === 2) return "No fue posible obtener la ubicación.";
  if (error?.code === 3) return "La ubicación tardó demasiado en responder.";
  return error?.message || "No fue posible acceder a la ubicación.";
}

async function persistPosition(position, { history = false } = {}) {
  const coords = position.coords;
  const data = {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy ?? null,
    heading: coords.heading ?? null,
    speed: coords.speed ?? null,
    timestamp: Date.now(),
    usuarioNombre: currentUser?.nombre || currentUser?.email?.split("@")[0] || currentUser?.uid
  };
  currentPosition = data;

  const now = Date.now();
  const movedSinceTracking = distanceMeters(lastTrackingPosition, data);
  if (history || !lastTrackingPosition || now - lastTrackingAt >= TRACKING_INTERVAL_MS || movedSinceTracking >= TRACKING_DISTANCE_M) {
    await setTracking(currentUser.uid, data);
    lastTrackingAt = now;
    lastTrackingPosition = data;
  }

  const movedSinceHistory = distanceMeters(lastHistoryPosition, data);
  if (history || !lastHistoryPosition || now - lastHistoryAt >= HISTORY_INTERVAL_MS || movedSinceHistory >= HISTORY_DISTANCE_M) {
    await addTrackingHistory(currentUser.uid, data);
    lastHistoryAt = now;
    lastHistoryPosition = data;
  }

  emit("active", { position: data });
  return data;
}

export function getCurrentGps() { return currentPosition; }
export function getGpsStatus() { if (!navigator.geolocation) return "unsupported"; return watchId === null ? "inactive" : "active"; }

export async function requestCurrentPosition() {
  if (!navigator.geolocation) throw new Error("Este dispositivo no permite geolocalización.");
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }));
}

export async function startTracking(user, onStatus = () => {}) {
  stopTracking();
  if (!navigator.geolocation) { emit("unsupported"); throw new Error("Este dispositivo no permite geolocalización."); }
  currentUser = user; statusCallback = onStatus; emit("requesting");
  try {
    const first = await requestCurrentPosition();
    await persistPosition(first, { history: true });
  } catch (error) {
    emit("error", { message: normalizeError(error) });
    throw new Error(normalizeError(error));
  }
  watchId = navigator.geolocation.watchPosition(async position => {
    try { await persistPosition(position); }
    catch (error) { emit("error", { message: error?.message || "No se pudo guardar la ubicación." }); }
  }, error => emit("error", { message: normalizeError(error) }), { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
  emit("active", { position: currentPosition });
  return currentPosition;
}

export function stopTracking() {
  if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null; currentPosition = null; currentUser = null;
  lastTrackingAt = 0; lastTrackingPosition = null; lastHistoryAt = 0; lastHistoryPosition = null; statusCallback = () => {};
}

export async function captureDeliveryLocation() {
  if (currentPosition) return currentPosition;
  const position = await requestCurrentPosition();
  return { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy ?? null, heading: position.coords.heading ?? null, speed: position.coords.speed ?? null, timestamp: Date.now() };
}
