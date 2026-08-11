const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "observador_vial_rms_pending_v4";
const ACTIVE_TRIP_KEY = "observador_vial_rms_active_trip_v1";

let watchId = null;
let points = [];
let currentTrip = null;
let map = null;
let routeLine = null;
let hazardMarker = null;
let routeBounds = null;
let hazardLayer = null;
let isSelectingHazard = false;
let mapResizeObserver = null;
let wakeLock = null;
let timerId = null;
let isDemoMode = false;
let demoTimerId = null;
let demoRoute = [];
let demoRouteIndex = 0;

const HAZARD_TYPES = {
  "Hueco o deterioro de la vía": { icon: "🕳️", key: "road-damage", label: "Hueco" },
  "Obra o cierre vial": { icon: "🚧", key: "road-work", label: "Obra" },
  "Derrumbe": { icon: "⛰️", key: "landslide", label: "Derrumbe" },
  "Inundación": { icon: "🌊", key: "flood", label: "Inundación" },
  "Animal en la vía": { icon: "🐄", key: "animal", label: "Animal" },
  "Señalización deficiente": { icon: "⚠️", key: "signage", label: "Señalización" },
  "Congestión": { icon: "🚗", key: "traffic", label: "Congestión" },
  "Comportamiento peligroso de terceros": { icon: "💥", key: "unsafe-driver", label: "Terceros" },
  "Objeto en la vía": { icon: "📦", key: "road-object", label: "Objeto" },
  "Otro": { icon: "❗", key: "other", label: "Otro" }
};

let selectedHazardType = "";

function getHazardVisual(type) {
  return HAZARD_TYPES[type] || HAZARD_TYPES["Otro"];
}

function createHazardIcon(type, temporary = false) {
  const visual = getHazardVisual(type);
  return L.divIcon({
    className: "hazard-map-icon-wrapper",
    html: `<div class="hazard-map-icon ${temporary ? "is-temporary" : ""}" aria-label="${escapeHtml(type || "Peligro")}"><span>${visual.icon}</span></div>`,
    iconSize: [42, 50],
    iconAnchor: [21, 48],
    popupAnchor: [0, -44]
  });
}

function chooseHazardType(type, startSelection = true) {
  if (!HAZARD_TYPES[type]) return;
  selectedHazardType = type;
  $("hazardType").value = type;

  document.querySelectorAll(".hazard-icon-button").forEach((button) => {
    const selected = button.dataset.hazardType === type;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  if (startSelection && map) {
    setHazardSelectionMode(true);
    $("mapHelp").textContent = `${getHazardVisual(type).icon} ${type}: toca el lugar correspondiente en el mapa.`;
    $("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function showToast(message, duration = 3000) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), duration);
}


function saveActiveTrip() {
  if (!currentTrip || currentTrip.demoMode || currentTrip.endedAt) return;
  currentTrip.route = [...points];
  localStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify({
    trip: currentTrip,
    savedAt: new Date().toISOString()
  }));
}

function clearActiveTrip() {
  localStorage.removeItem(ACTIVE_TRIP_KEY);
}

function getActiveTrip() {
  try {
    const stored = JSON.parse(localStorage.getItem(ACTIVE_TRIP_KEY) || "null");
    return stored?.trip && !stored.trip.endedAt ? stored.trip : null;
  } catch {
    return null;
  }
}

function addRealGpsPoint(pos) {
  if (!currentTrip || currentTrip.demoMode || currentTrip.endedAt) return;
  const point = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: Math.round(pos.coords.accuracy),
    timestamp: new Date(pos.timestamp).toISOString()
  };

  const last = points[points.length - 1];
  if (!last || distanceMeters(last, point) >= 8) {
    points.push(point);
    saveActiveTrip();
  }
  updateTrackingMetrics(point);
}

function startGeolocationWatch() {
  if (!navigator.geolocation || !currentTrip || currentTrip.demoMode || currentTrip.endedAt) return;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    addRealGpsPoint,
    (error) => {
      const messages = {
        1: "Permiso de GPS rechazado.",
        2: "No fue posible obtener la ubicación.",
        3: "La ubicación tardó demasiado."
      };
      $("liveInfo").textContent = messages[error.code] || "Error de ubicación.";
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

function getPendingTrips() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePendingTrips(trips) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  updateSyncStatus();
}

function updateSyncStatus(message = "") {
  const pending = getPendingTrips();
  $("syncStatus").textContent = message || (
    pending.length
      ? `${pending.length} recorrido(s) pendiente(s) de envío.`
      : "Sin recorridos pendientes."
  );
  $("retryBtn").classList.toggle("hidden", pending.length === 0);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function routeDistanceKm(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += distanceMeters(route[i - 1], route[i]);
  }
  return total / 1000;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch {}
}

async function releaseWakeLock() {
  try {
    if (wakeLock) await wakeLock.release();
  } catch {}
  wakeLock = null;
}

function validSetup() {
  const required = ["driver", "vehicle", "origin", "destination"];
  const missing = required.find((id) => !$(id).value.trim());
  if (missing) {
    $(missing).focus();
    showToast("Completa todos los datos del recorrido.");
    return false;
  }
  return true;
}

function createTrip(demo = false) {
  return {
    id: uid(),
    driver: $("driver").value.trim(),
    vehicle: $("vehicle").value.trim(),
    origin: $("origin").value.trim(),
    destination: $("destination").value.trim(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    route: [],
    hazards: [],
    noHazardsObserved: false,
    demoMode: demo
  };
}

function beginTrackingUI() {
  $("tripSetup").classList.add("hidden");
  $("trackingPanel").classList.remove("hidden");
  $("resultPanel").classList.add("hidden");
  $("pointCount").textContent = "0";
  $("elapsedTime").textContent = "00:00";
  $("liveDistance").textContent = "0.0 km";

  window.clearInterval(timerId);
  window.clearInterval(demoTimerId);
  demoTimerId = null;
  $("demoControls").classList.add("hidden");
  timerId = window.setInterval(() => {
    if (!currentTrip) return;
    $("elapsedTime").textContent =
      formatElapsed(Date.now() - new Date(currentTrip.startedAt).getTime());
  }, 1000);
}

function updateTrackingMetrics(lastPoint = null) {
  $("pointCount").textContent = String(points.length);
  $("liveDistance").textContent = `${routeDistanceKm(points).toFixed(1)} km`;
  if (lastPoint) {
    $("liveInfo").textContent =
      `${points.length} puntos registrados · precisión aproximada ${lastPoint.accuracy} m`;
  }
}

$("startBtn").addEventListener("click", async () => {
  if (!validSetup()) return;
  if (!navigator.geolocation) {
    showToast("Este dispositivo no permite usar geolocalización desde el navegador.");
    return;
  }

  isDemoMode = false;
  $("demoBanner").classList.add("hidden");
  points = [];
  currentTrip = createTrip(false);
  beginTrackingUI();
  $("trackingStatus").textContent = "El recorrido real se está registrando...";
  $("liveInfo").textContent = "Solicitando permiso de ubicación...";
  await requestWakeLock();

  saveActiveTrip();
  startGeolocationWatch();
});

$("demoBtn").addEventListener("click", () => {
  if (APP_CONFIG.DEMO_ENABLED !== true) {
    showToast("El modo de prueba no está disponible en esta versión.");
    return;
  }
  isDemoMode = true;

  if (!$("driver").value.trim()) $("driver").value = "Especialista de prueba";
  if (!$("vehicle").value.trim()) $("vehicle").value = "Carro";
  if (!$("origin").value.trim()) $("origin").value = "Sede RMS";
  if (!$("destination").value.trim()) $("destination").value = "Destino simulado";

  demoRoute = createDemoRoute();
  demoRouteIndex = 0;
  points = [];
  currentTrip = createTrip(true);

  $("demoBanner").classList.remove("hidden");
  beginTrackingUI();
  $("demoControls").classList.remove("hidden");
  $("trackingStatus").textContent = "Simulando movimiento sin usar el GPS...";
  $("liveInfo").textContent = "La ruta avanzará automáticamente. También puedes avanzar punto por punto.";

  addNextDemoPoint();
  demoTimerId = window.setInterval(() => {
    if (!addNextDemoPoint()) {
      window.clearInterval(demoTimerId);
      demoTimerId = null;
      $("trackingStatus").textContent = "Ruta simulada completada. Puedes finalizar el recorrido.";
    }
  }, 1200);
});

function addNextDemoPoint() {
  if (!isDemoMode || demoRouteIndex >= demoRoute.length) return false;
  const source = demoRoute[demoRouteIndex++];
  const point = { ...source, timestamp: new Date().toISOString() };
  points.push(point);
  updateTrackingMetrics(point);
  $("liveInfo").textContent = `Punto simulado ${demoRouteIndex} de ${demoRoute.length} · sin desplazamiento físico`;
  return demoRouteIndex < demoRoute.length;
}

$("demoStepBtn").addEventListener("click", () => {
  if (demoTimerId) {
    window.clearInterval(demoTimerId);
    demoTimerId = null;
  }
  const hasMore = addNextDemoPoint();
  $("trackingStatus").textContent = hasMore
    ? "Simulación pausada: avanza manualmente o finaliza."
    : "Ruta simulada completada. Puedes finalizar el recorrido.";
});

$("demoCompleteBtn").addEventListener("click", () => {
  if (demoTimerId) {
    window.clearInterval(demoTimerId);
    demoTimerId = null;
  }
  while (demoRouteIndex < demoRoute.length) addNextDemoPoint();
  $("trackingStatus").textContent = "Ruta simulada completada. Puedes finalizar el recorrido.";
});

function createDemoRoute() {
  const start = Date.now() - 12 * 60 * 1000;
  const coords = [
    [3.45165, -76.53205],
    [3.45220, -76.53095],
    [3.45285, -76.52990],
    [3.45355, -76.52885],
    [3.45420, -76.52775],
    [3.45485, -76.52665],
    [3.45545, -76.52545],
    [3.45605, -76.52420],
    [3.45660, -76.52295],
    [3.45715, -76.52170],
    [3.45770, -76.52045],
    [3.45830, -76.51925]
  ];

  return coords.map(([lat, lng], index) => ({
    lat,
    lng,
    accuracy: 8,
    timestamp: new Date(start + index * 60_000).toISOString()
  }));
}

$("finishBtn").addEventListener("click", finishTrip);

async function finishTrip() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  window.clearInterval(timerId);
  window.clearInterval(demoTimerId);
  demoTimerId = null;
  await releaseWakeLock();

  if (points.length < 2) {
    showToast("No hay suficientes puntos para dibujar el recorrido.");
    return;
  }

  currentTrip.endedAt = new Date().toISOString();
  currentTrip.route = [...points];
  clearActiveTrip();

  if (!isDemoMode) persistCurrentTrip();

  $("trackingPanel").classList.add("hidden");
  $("resultPanel").classList.remove("hidden");
  renderTrip();
  $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function persistCurrentTrip() {
  if (!currentTrip || currentTrip.demoMode) return;
  const trips = getPendingTrips();
  const index = trips.findIndex((trip) => trip.id === currentTrip.id);
  if (index >= 0) trips[index] = currentTrip;
  else trips.push(currentTrip);
  savePendingTrips(trips);
}

function setHazardSelectionMode(active) {
  isSelectingHazard = active;
  const button = $("selectHazardBtn");
  const help = $("mapHelp");

  button.classList.toggle("is-active", active);
  button.textContent = active
    ? "✕ Cancelar selección"
    : "⚠ Marcar condición peligrosa";
  help.classList.toggle("is-selecting", active);
  help.textContent = active
    ? "Ahora toca en el mapa el lugar donde observaste la condición peligrosa."
    : "Pulsa “Marcar condición peligrosa” y luego toca el punto correspondiente en el mapa.";

  if (map) {
    map.getContainer().style.cursor = active ? "crosshair" : "grab";
  }
}

function selectHazardLocation(latlng) {
  if (!map || !latlng) return;

  $("hazardLat").value = Number(latlng.lat).toFixed(7);
  $("hazardLng").value = Number(latlng.lng).toFixed(7);
  $("hazardForm").classList.remove("hidden");

  if (hazardMarker) hazardMarker.remove();
  const markerType = selectedHazardType || $("hazardType").value || "Otro";
  if (!selectedHazardType) chooseHazardType(markerType, false);

  hazardMarker = L.marker(latlng, {
    draggable: true,
    icon: createHazardIcon(markerType, true)
  })
    .addTo(map)
    .bindPopup(`${getHazardVisual(markerType).icon} Punto seleccionado. Puedes arrastrarlo para ajustar la ubicación.`)
    .openPopup();

  hazardMarker.on("dragend", () => {
    const position = hazardMarker.getLatLng();
    $("hazardLat").value = Number(position.lat).toFixed(7);
    $("hazardLng").value = Number(position.lng).toFixed(7);
  });

  setHazardSelectionMode(false);
  window.setTimeout(() => {
    $("hazardForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 150);
}

function renderHazardMarkers() {
  if (!map) return;
  if (!hazardLayer) hazardLayer = L.layerGroup().addTo(map);
  hazardLayer.clearLayers();

  (currentTrip.hazards || []).forEach((hazard) => {
    L.marker([hazard.lat, hazard.lng], { icon: createHazardIcon(hazard.type) })
      .addTo(hazardLayer)
      .bindPopup(
        `<strong>${escapeHtml(hazard.type)}</strong><br>` +
        `Riesgo: ${escapeHtml(hazard.risk)}<br>` +
        `${escapeHtml(hazard.reference || "Sin descripción adicional")}`
      );
  });
}

function renderTrip() {
  const route = currentTrip.route || [];
  const latlngs = route
    .filter((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)))
    .map((point) => [Number(point.lat), Number(point.lng)]);

  if (latlngs.length < 2) {
    showToast("No hay suficientes coordenadas válidas para mostrar el mapa.");
    return;
  }

  if (!window.L) {
    $("map").innerHTML = '<div class="map-load-warning">No fue posible cargar el componente del mapa. Verifica la conexión a internet y vuelve a abrir la aplicación.</div>';
    return;
  }

  if (mapResizeObserver) mapResizeObserver.disconnect();
  if (map) map.remove();

  map = L.map("map", {
    zoomControl: true,
    tap: true,
    preferCanvas: true
  });

  const tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
    crossOrigin: true
  }).addTo(map);

  let tileErrorShown = false;
  tileLayer.on("tileerror", () => {
    if (tileErrorShown) return;
    tileErrorShown = true;
    showToast("El mapa base no cargó completamente. Aun puedes marcar puntos sobre la ruta.", 5000);
  });

  routeLine = L.polyline(latlngs, {
    weight: 6,
    color: isDemoMode ? "#7115aa" : "#0968b8"
  }).addTo(map);

  L.marker(latlngs[0]).addTo(map).bindPopup("Inicio");
  L.marker(latlngs[latlngs.length - 1]).addTo(map).bindPopup("Final");

  routeBounds = routeLine.getBounds();
  if (routeBounds.isValid()) {
    map.fitBounds(routeBounds, { padding: [30, 30], maxZoom: 17 });
  } else {
    map.setView(latlngs[0], 16);
  }

  hazardLayer = L.layerGroup().addTo(map);
  renderHazardMarkers();

  map.on("click", (event) => {
    if (!isSelectingHazard) {
      showToast("Primero pulsa “Marcar condición peligrosa”.");
      return;
    }
    selectHazardLocation(event.latlng);
  });

  renderSummary();
  renderHazardList();

  $("sendTripBtn").disabled = isDemoMode;
  $("sendTripBtn").textContent = isDemoMode
    ? "Modo de prueba: no se envían datos"
    : "✈ Enviar recorrido al administrador";

  setHazardSelectionMode(false);

  const refreshMapSize = () => {
    if (!map) return;
    map.invalidateSize({ pan: false });
  };
  window.setTimeout(refreshMapSize, 100);
  window.setTimeout(refreshMapSize, 450);

  if ("ResizeObserver" in window) {
    mapResizeObserver = new ResizeObserver(refreshMapSize);
    mapResizeObserver.observe($("map"));
  }
}

function renderSummary() {
  const start = new Date(currentTrip.startedAt);
  const end = new Date(currentTrip.endedAt);
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  const highestRisk = getHighestRisk(currentTrip.hazards);

  $("tripSummary").innerHTML = `
    <div class="summary-item">
      <strong>${escapeHtml(currentTrip.driver)}</strong>
      <span>Especialista</span>
    </div>
    <div class="summary-item">
      <strong>${escapeHtml(currentTrip.vehicle)}</strong>
      <span>Transporte</span>
    </div>
    <div class="summary-item">
      <strong>${routeDistanceKm(currentTrip.route).toFixed(1)} km</strong>
      <span>Distancia aproximada</span>
    </div>
    <div class="summary-item">
      <strong>${minutes} min</strong>
      <span>Duración</span>
    </div>
    <div class="summary-item">
      <strong>${escapeHtml(currentTrip.origin)}</strong>
      <span>Origen</span>
    </div>
    <div class="summary-item">
      <strong>${escapeHtml(currentTrip.destination)}</strong>
      <span>Destino</span>
    </div>
    <div class="summary-item">
      <strong>${currentTrip.hazards.length}</strong>
      <span>Peligros registrados</span>
    </div>
    <div class="summary-item">
      <strong>${highestRisk || "Sin registro"}</strong>
      <span>Riesgo más alto</span>
    </div>
  `;
}

function getHighestRisk(hazards) {
  const order = { "Bajo": 1, "Medio": 2, "Alto": 3, "Crítico": 4 };
  return hazards.reduce((highest, hazard) => {
    return !highest || order[hazard.risk] > order[highest] ? hazard.risk : highest;
  }, "");
}

$("selectHazardBtn").addEventListener("click", () => {
  if (!map) {
    showToast("El mapa todavía no está disponible.");
    return;
  }
  if (isSelectingHazard) {
    setHazardSelectionMode(false);
    return;
  }
  if (!selectedHazardType) {
    showToast("Selecciona primero uno de los íconos de peligro.");
    $("hazardIconPalette").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  setHazardSelectionMode(true);
  $("mapHelp").textContent = `${getHazardVisual(selectedHazardType).icon} ${selectedHazardType}: toca el lugar correspondiente en el mapa.`;
});

document.querySelectorAll(".hazard-icon-button").forEach((button) => {
  button.addEventListener("click", () => chooseHazardType(button.dataset.hazardType));
});

$("hazardType").addEventListener("change", () => {
  const type = $("hazardType").value;
  if (type) chooseHazardType(type, false);
});

$("recenterMapBtn").addEventListener("click", () => {
  if (!map || !routeBounds?.isValid()) return;
  map.fitBounds(routeBounds, { padding: [30, 30], maxZoom: 17 });
});

$("hazardForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const hazardType = $("hazardType").value;
  if (!hazardType) {
    showToast("Selecciona el tipo de peligro mediante un ícono.");
    return;
  }

  const selectedRisk = document.querySelector('input[name="riskLevel"]:checked');
  if (!selectedRisk) {
    showToast("Selecciona el nivel de riesgo.");
    return;
  }

  const lat = Number($("hazardLat").value);
  const lng = Number($("hazardLng").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    showToast("Selecciona primero una ubicación válida en el mapa.");
    return;
  }

  const hazard = {
    id: uid(),
    lat,
    lng,
    type: hazardType,
    risk: selectedRisk.value,
    reference: $("reference").value.trim(),
    reportedAt: new Date().toISOString()
  };

  currentTrip.hazards.push(hazard);
  currentTrip.noHazardsObserved = false;
  if (!isDemoMode) persistCurrentTrip();

  resetHazardForm();
  renderHazardMarkers();
  renderSummary();
  renderHazardList();
  showToast("Peligro guardado correctamente.");
});

$("cancelHazardBtn").addEventListener("click", resetHazardForm);

function resetHazardForm() {
  $("hazardForm").reset();
  $("hazardForm").classList.add("hidden");
  if (hazardMarker) hazardMarker.remove();
  hazardMarker = null;
  selectedHazardType = "";
  document.querySelectorAll(".hazard-icon-button").forEach((button) => {
    button.classList.remove("is-selected");
    button.setAttribute("aria-pressed", "false");
  });
  setHazardSelectionMode(false);
}

function renderHazardList() {
  const wrap = $("hazardListWrap");
  const list = $("hazardList");
  const hazards = currentTrip.hazards || [];

  wrap.classList.toggle("hidden", hazards.length === 0);
  list.innerHTML = hazards.map((hazard, index) => `
    <div class="hazard-item">
      <div>
        <p><strong><span class="hazard-list-icon">${getHazardVisual(hazard.type).icon}</span>${index + 1}. ${escapeHtml(hazard.type)}</strong></p>
        <small>${escapeHtml(hazard.reference || "Sin descripción adicional")}</small>
      </div>
      <span class="risk-badge ${escapeHtml(hazard.risk)}">${escapeHtml(hazard.risk)}</span>
    </div>
  `).join("");
}

$("noHazardBtn").addEventListener("click", () => {
  currentTrip.noHazardsObserved = true;
  if (!isDemoMode) persistCurrentTrip();
  showToast(isDemoMode
    ? "Prueba registrada: no se observaron peligros."
    : "Se registró que no se observaron peligros.");
});

$("newTripBtn").addEventListener("click", () => {
  clearActiveTrip();
  location.reload();
});


async function captureMapScreenshot() {
  const mapElement = $("map");

  if (!map || !mapElement || !window.html2canvas) {
    throw new Error("No fue posible preparar la captura del mapa.");
  }

  map.invalidateSize({ pan: false });
  if (routeBounds?.isValid()) {
    map.fitBounds(routeBounds, { padding: [35, 35], maxZoom: 17 });
  }

  await new Promise(resolve => setTimeout(resolve, 900));

  const canvas = await window.html2canvas(mapElement, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    scale: 1,
    logging: false,
    imageTimeout: 12000,
    ignoreElements: element =>
      element.classList?.contains("leaflet-control-zoom") ||
      element.classList?.contains("leaflet-control-attribution")
  });

  const maxWidth = 1100;
  let outputCanvas = canvas;

  if (canvas.width > maxWidth) {
    const ratio = maxWidth / canvas.width;
    outputCanvas = document.createElement("canvas");
    outputCanvas.width = maxWidth;
    outputCanvas.height = Math.round(canvas.height * ratio);
    const context = outputCanvas.getContext("2d");
    context.drawImage(canvas, 0, 0, outputCanvas.width, outputCanvas.height);
  }

  return outputCanvas.toDataURL("image/jpeg", 0.78);
}

async function prepareTripWithMapScreenshot(trip) {
  const payloadTrip = JSON.parse(JSON.stringify(trip));

  try {
    payloadTrip.mapScreenshot = await captureMapScreenshot();
    payloadTrip.mapScreenshotCreatedAt = new Date().toISOString();
  } catch (error) {
    console.warn("No se pudo generar la captura del mapa:", error);
    payloadTrip.mapScreenshot = "";
  }

  return payloadTrip;
}
async function capturarMapaComoImagen() {
  const mapElement = document.getElementById("map");

  if (!mapElement) {
    throw new Error("No se encontró el mapa.");
  }

  if (map) {
    map.invalidateSize();
  }

  await new Promise(resolve => setTimeout(resolve, 700));

  const canvas = await html2canvas(mapElement, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    scale: 1
  });

  return canvas.toDataURL("image/jpeg", 0.82);
}
async function sendTripToAdministrator(trip) {
  if (trip.demoMode) {
    throw new Error("Los recorridos de prueba no se envían.");
  }

  const endpoint = APP_CONFIG?.APPS_SCRIPT_URL || "";
  if (!endpoint || endpoint.includes("PEGUE_AQUI")) {
    throw new Error("Falta configurar la URL privada de recepción.");
  }const mapImage = await capturarMapaComoImagen();
trip.mapImage = mapImage;

  await fetch(endpoint, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "saveTrip",
      organization: APP_CONFIG.ORGANIZATION_NAME || "RMS",
      trip
    }),
    keepalive: true
  });
}

async function sendCurrentTrip() {
  if (isDemoMode || currentTrip?.demoMode) {
    showToast("El modo de prueba no envía datos reales.");
    return;
  }

  if (!currentTrip?.endedAt) {
    showToast("Primero debes finalizar el recorrido.");
    return;
  }

  if (!currentTrip.noHazardsObserved && !(currentTrip.hazards || []).length) {
    const confirmed = confirm("No se registraron peligros. ¿Deseas enviar de todas formas?");
    if (!confirmed) return;
  }

  const button = $("sendTripBtn");
  button.disabled = true;
  button.textContent = "Enviando...";

  try {
    button.textContent = "Generando captura del mapa...";
    const tripWithScreenshot = await prepareTripWithMapScreenshot(currentTrip);
    button.textContent = "Enviando datos y captura...";
    await sendTripToAdministrator(tripWithScreenshot);
    savePendingTrips(getPendingTrips().filter((trip) => trip.id !== currentTrip.id));
    updateSyncStatus("Recorrido enviado al administrador.");
    button.textContent = "Recorrido enviado";
    showToast("Información enviada correctamente.");
  } catch (error) {
    persistCurrentTrip();
    updateSyncStatus(`Envío pendiente: ${error.message}`);
    button.disabled = false;
    button.textContent = "✈ Enviar recorrido al administrador";
    showToast(`No se pudo enviar. Quedó guardado para reintentar.`);
  }
}

async function retryPendingTrips() {
  const pending = getPendingTrips();
  if (!pending.length) return;

  $("retryBtn").disabled = true;
  const remaining = [];
  let sent = 0;

  for (const trip of pending) {
    try {
      const payloadTrip = currentTrip?.id === trip.id && map
        ? await prepareTripWithMapScreenshot(trip)
        : trip;
      await sendTripToAdministrator(payloadTrip);
      sent += 1;
    } catch {
      remaining.push(trip);
    }
  }

  savePendingTrips(remaining);
  $("retryBtn").disabled = false;
  showToast(`${sent} enviado(s); ${remaining.length} pendiente(s).`);
}

$("sendTripBtn").addEventListener("click", sendCurrentTrip);
$("retryBtn").addEventListener("click", retryPendingTrips);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

document.addEventListener("visibilitychange", async () => {
  if (!currentTrip || currentTrip.demoMode || currentTrip.endedAt) return;

  if (document.visibilityState === "hidden") {
    saveActiveTrip();
  } else {
    await requestWakeLock();
    startGeolocationWatch();
    $("trackingStatus").textContent = "Recorrido recuperado y GPS reactivado.";
    showToast("El recorrido continúa con los puntos que ya estaban guardados.");
  }
});

window.addEventListener("pagehide", saveActiveTrip);
window.addEventListener("beforeunload", saveActiveTrip);

function restoreActiveTrip() {
  const activeTrip = getActiveTrip();
  if (!activeTrip) return;

  const resume = confirm(
    `Hay un recorrido sin finalizar de ${activeTrip.origin} a ${activeTrip.destination}. ¿Deseas continuarlo?`
  );

  if (!resume) {
    clearActiveTrip();
    return;
  }

  currentTrip = activeTrip;
  points = Array.isArray(activeTrip.route) ? [...activeTrip.route] : [];
  isDemoMode = false;
  $("driver").value = activeTrip.driver || "";
  $("vehicle").value = activeTrip.vehicle || "";
  $("origin").value = activeTrip.origin || "";
  $("destination").value = activeTrip.destination || "";
  $("demoBanner").classList.add("hidden");
  beginTrackingUI();
  updateTrackingMetrics(points[points.length - 1] || null);
  $("trackingStatus").textContent = "Recorrido recuperado. Reactivando ubicación...";
  $("liveInfo").textContent = `${points.length} puntos recuperados del dispositivo.`;
  requestWakeLock();
  startGeolocationWatch();
}


if (APP_CONFIG.DEMO_ENABLED !== true) {
  $("demoBtn")?.classList.add("hidden");
  $("demoBanner")?.classList.add("hidden");
  $("demoControls")?.classList.add("hidden");
}

updateSyncStatus();
restoreActiveTrip();
