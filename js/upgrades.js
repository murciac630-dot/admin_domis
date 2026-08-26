import { getAllTracking } from "./db.js";
import { getCurrentGps } from "./gps.js";
import { getOperationConfig, saveOperationConfig, calculateDeliveryPricing, renderTrackingMap } from "./maps.js";
import { auth } from "./firebase.js";

let mapInstance = null;
let previewTimer = null;
let loadedConfig = null;

const $ = selector => document.querySelector(selector);

function money(value) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

async function enhanceGpsPage() {
  const placeholder = $(".map-placeholder");
  if (!placeholder || !window.L || placeholder.dataset.enhanced === "true") return;
  placeholder.dataset.enhanced = "true";
  placeholder.innerHTML = `<div id="live-map" class="live-map"></div>`;
  try {
    const [tracking, config] = await Promise.all([getAllTracking(), getOperationConfig()]);
    mapInstance?.remove();
    mapInstance = renderTrackingMap($("#live-map"), tracking, config.mapCenter);
  } catch (error) {
    placeholder.innerHTML = `<div class="empty">No se pudo cargar el mapa: ${esc(error.message)}</div>`;
  }
}

function ensureConfigButton() {
  const role = $("#user-role")?.textContent || "";
  if (role !== "admin") return;
  const nav = $("#nav");
  if (!nav || nav.querySelector("[data-operation-config]")) return;
  const button = document.createElement("button");
  button.className = "nav-item";
  button.dataset.operationConfig = "true";
  button.textContent = "Configuración";
  button.onclick = () => renderConfigPage();
  nav.appendChild(button);
}

async function renderConfigPage() {
  const main = $("#main");
  if (!main) return;
  main.innerHTML = `<div class="page-head"><div><h1>Configuración</h1><div class="muted">Origen de operación y tarifa automática de domicilios</div></div></div>
    <div class="card"><div class="section-head-row"><div><h3 class="section-title">Punto de origen</h3><p class="muted">La distancia tarifable se calcula desde este punto hasta la ubicación capturada en la entrega.</p></div><button class="btn secondary" id="use-my-location">Usar mi ubicación</button></div>
      <div class="form-grid"><div><label>Latitud de origen</label><input id="cfg-lat" type="number" step="any"></div><div><label>Longitud de origen</label><input id="cfg-lng" type="number" step="any"></div></div></div>
    <div class="card" style="margin-top:15px"><h3 class="section-title">Tarifas fijas por distancia</h3><div class="form-grid">
      <div><label>Activar cálculo automático</label><select id="cfg-active"><option value="false">No</option><option value="true">Sí</option></select></div>
      <div><label>Hasta (km)</label><input id="cfg-limit" type="number" min="0" step="0.1" value="3.5"></div>
      <div><label>Hasta el límite</label><input class="readonly" readonly value="$10.000"></div>
      <div><label>Más del límite</label><input class="readonly" readonly value="$15.000"></div>
      <div><label>Permitir valor especial</label><select id="cfg-special"><option value="true">Sí, solo administrador</option><option value="false">No</option></select></div>
    </div><p class="form-note">Regla operativa: hasta 3,5 km se liquidan $10.000; por encima, $15.000. Un administrador puede asignar por entrega un valor especial superior a $15.000, con motivo y auditoría.</p></div>
    <div class="card" style="margin-top:15px"><div class="section-head-row"><div><h3 class="section-title">Prueba de cálculo</h3><div id="cfg-preview" class="muted">Configura el origen y una tarifa para ver una simulación.</div></div><button class="btn green" id="save-config">Guardar configuración</button></div></div>`;

  try {
    const config = await getOperationConfig();
    loadedConfig = config;
    $("#cfg-lat").value = config.mapCenter.lat;
    $("#cfg-lng").value = config.mapCenter.lng;
    $("#cfg-active").value = String(Boolean(config.tarifa.activa));
    $("#cfg-limit").value = config.tarifa.limiteKm;
    $("#cfg-special").value = String(config.tarifa.permiteEspecial !== false);
    await updateConfigPreview();
  } catch (error) { $("#cfg-preview").textContent = error.message; }

  $("#use-my-location").onclick = async () => {
    if (!navigator.geolocation) return alert("Este dispositivo no permite geolocalización.");
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 }));
      $("#cfg-lat").value = position.coords.latitude.toFixed(7);
      $("#cfg-lng").value = position.coords.longitude.toFixed(7);
      await updateConfigPreview();
    } catch (error) { alert(error.message || "No fue posible obtener la ubicación."); }
  };

  ["cfg-lat", "cfg-lng", "cfg-active", "cfg-limit", "cfg-special"].forEach(id => $("#" + id).addEventListener("input", updateConfigPreview));
  $("#save-config").onclick = async () => {
    const button = $("#save-config"); button.disabled = true; button.textContent = "Guardando…";
    try {
      await saveOperationConfig({
        mapCenter: { lat: $("#cfg-lat").value, lng: $("#cfg-lng").value },
        tarifa: {
          activa: $("#cfg-active").value === "true",
          limiteKm: $("#cfg-limit").value,
          permiteEspecial: $("#cfg-special").value === "true"
        },
        version: Number(loadedConfig?.version || 0) + 1
      }, auth.currentUser);
      button.textContent = "Guardado";
      setTimeout(() => { button.disabled = false; button.textContent = "Guardar configuración"; }, 1200);
      if (window.toast) window.toast("Configuración guardada");
    } catch (error) {
      button.disabled = false; button.textContent = "Guardar configuración";
      alert("No se pudo guardar: " + error.message);
    }
  };
}

async function updateConfigPreview() {
  const el = $("#cfg-preview");
  if (!el) return;
  const gps = getCurrentGps();
  if (!gps) { el.textContent = "Inicia un turno o usa una ubicación del dispositivo para probar el cálculo."; return; }
  const config = {
    mapCenter: { lat: $("#cfg-lat").value, lng: $("#cfg-lng").value },
    tarifa: {
      activa: $("#cfg-active").value === "true",
      limiteKm: $("#cfg-limit").value,
      permiteEspecial: $("#cfg-special").value === "true"
    }
  };
  const distanceKm = await import("./maps.js").then(m => m.haversineKm(config.mapCenter, gps));
  const fee = await import("./maps.js").then(m => m.calculateDeliveryFee(distanceKm, config.tarifa));
  el.textContent = distanceKm == null ? "No hay distancia disponible." : `${distanceKm.toFixed(2)} km · ${fee.calculada ? money(fee.valor) : "tarifa no activada"}`;
}

async function enhanceDeliveryForm() {
  const form = $("#pedido");
  if (!form || form.dataset.pricingEnhanced === "true") return;
  form.dataset.pricingEnhanced = "true";
  const state = form.querySelector(".location-state");
  if (!state) return;
  const preview = document.createElement("div");
  preview.className = "delivery-pricing-preview";
  preview.innerHTML = `<strong>Liquidación automática</strong><div class="muted" id="delivery-pricing-copy">Calculando distancia y tarifa…</div>`;
  state.after(preview);
  const refresh = async () => {
    const copy = $("#delivery-pricing-copy");
    if (!copy) return;
    try {
      const gps = getCurrentGps();
      if (!gps) { copy.textContent = "La ubicación se capturará al registrar el pedido."; return; }
      const pricing = await calculateDeliveryPricing(gps);
      copy.textContent = pricing.distanciaTarifableKm == null ? "Distancia no disponible" : `${pricing.distanciaTarifableKm.toFixed(2)} km · ${pricing.tarifaCalculada ? money(pricing.valorDomicilio) : "Tarifa pendiente de configuración"}`;
    } catch (error) { copy.textContent = "Tarifa pendiente de cálculo"; }
  };
  await refresh();
  clearInterval(previewTimer); previewTimer = setInterval(refresh, 10000);
}

const observer = new MutationObserver(() => {
  ensureConfigButton();
  enhanceGpsPage();
  enhanceDeliveryForm();
});
observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => { ensureConfigButton(); enhanceGpsPage(); enhanceDeliveryForm(); }, 300);
