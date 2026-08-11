/*
  GOOGLE APPS SCRIPT — OBSERVADOR VIAL RMS

  Esta versión recibe los datos del recorrido, guarda una captura del mapa
  en Google Drive y la inserta en la hoja "Recorridos".

  1. Reemplaza PEGUE_AQUI_EL_ID_DE_SU_HOJA por el ID de Google Sheets.
  2. Implementa como Aplicación web:
     - Ejecutar como: tú
     - Quién tiene acceso: cualquier usuario con el enlace
  3. Copia la URL /exec en config.js.
*/

const SPREADSHEET_ID = "PEGUE_AQUI_EL_ID_DE_SU_HOJA";
const SCREENSHOT_FOLDER_NAME = "Observador Vial RMS - Capturas de mapas";

function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: "Observador Vial RMS" })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action !== "saveTrip" || !data.trip) {
      throw new Error("Solicitud no válida");
    }

    if (data.trip.demoMode) {
      throw new Error("No se aceptan recorridos de prueba");
    }

    prepararHojas();
    guardarRecorrido_(data.trip, data.organization || "RMS");

    return ContentService.createTextOutput(
      JSON.stringify({ ok: true })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(error) })
    ).setMimeType(ContentService.MimeType.JSON);

  } finally {
    lock.releaseLock();
  }
}

function prepararHojas() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  crearOActualizarHoja_(ss, "Recorridos", [
    "ID recorrido", "Organización", "Nombre del especialista",
    "Medio de transporte", "Origen", "Destino", "Inicio", "Finalización",
    "Duración (min)", "Distancia aproximada (km)", "Cantidad de peligros",
    "Resultado", "Fecha de recepción", "Captura del mapa", "Enlace captura"
  ]);

  crearOActualizarHoja_(ss, "Peligros", [
    "ID peligro", "ID recorrido", "Nombre del especialista",
    "Medio de transporte", "Origen", "Destino", "Fecha del recorrido",
    "Fecha del reporte", "Tipo de peligro", "Nivel de riesgo",
    "Descripción o punto de referencia", "Latitud", "Longitud"
  ]);

  crearOActualizarHoja_(ss, "Puntos GPS", [
    "ID recorrido", "Nombre del especialista", "Medio de transporte",
    "Número de punto", "Fecha y hora GPS", "Latitud", "Longitud",
    "Precisión aproximada (m)"
  ]);
}

function guardarRecorrido_(trip, organization) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const recorridos = ss.getSheetByName("Recorridos");
  const peligros = ss.getSheetByName("Peligros");
  const puntos = ss.getSheetByName("Puntos GPS");

  const ids = recorridos.getLastRow() > 1
    ? recorridos.getRange(2, 1, recorridos.getLastRow() - 1, 1).getValues().flat()
    : [];

  if (ids.includes(trip.id)) return;

  const route = trip.route || [];
  const hazards = trip.hazards || [];
  const durationMin = trip.startedAt && trip.endedAt
    ? Math.max(1, Math.round(
        (new Date(trip.endedAt) - new Date(trip.startedAt)) / 60000
      ))
    : "";

  const result = hazards.length
    ? "Con peligros reportados"
    : (trip.noHazardsObserved ? "Sin peligros observados" : "Sin confirmación");

  const screenshot = guardarCapturaMapa_(trip);

  recorridos.appendRow([
    trip.id,
    organization,
    trip.driver,
    trip.vehicle,
    trip.origin,
    trip.destination,
    fecha_(trip.startedAt),
    fecha_(trip.endedAt),
    durationMin,
    calcularDistanciaKm_(route),
    hazards.length,
    result,
    new Date(),
    "",
    screenshot.url || ""
  ]);

  const row = recorridos.getLastRow();
  if (screenshot.directUrl) {
    try {
      const cellImage = SpreadsheetApp.newCellImage()
        .setSourceUrl(screenshot.directUrl)
        .setAltTextTitle("Mapa del recorrido " + trip.id)
        .setAltTextDescription("Captura del mapa con la ruta y los peligros identificados")
        .build();
      recorridos.getRange(row, 14).setValue(cellImage);
      recorridos.setRowHeight(row, 230);
      recorridos.setColumnWidth(14, 380);
    } catch (error) {
      recorridos.getRange(row, 14).setFormula(
        '=IMAGE("' + screenshot.directUrl + '",4,220,360)'
      );
    }
  } else {
    recorridos.getRange(row, 14).setValue("Captura no disponible");
  }

  if (hazards.length) {
    const hazardRows = hazards.map(h => [
      h.id,
      trip.id,
      trip.driver,
      trip.vehicle,
      trip.origin,
      trip.destination,
      fecha_(trip.startedAt),
      fecha_(h.reportedAt),
      h.type,
      h.risk,
      h.reference || "",
      h.lat,
      h.lng
    ]);

    peligros.getRange(
      peligros.getLastRow() + 1,
      1,
      hazardRows.length,
      hazardRows[0].length
    ).setValues(hazardRows);
  }

  if (route.length) {
    const routeRows = route.map((point, index) => [
      trip.id,
      trip.driver,
      trip.vehicle,
      index + 1,
      fecha_(point.timestamp),
      point.lat,
      point.lng,
      point.accuracy
    ]);

    puntos.getRange(
      puntos.getLastRow() + 1,
      1,
      routeRows.length,
      routeRows[0].length
    ).setValues(routeRows);
  }
}

function guardarCapturaMapa_(trip) {
  if (!trip.mapScreenshot || !trip.mapScreenshot.includes("base64,")) {
    return { url: "", directUrl: "" };
  }

  try {
    const parts = trip.mapScreenshot.split("base64,");
    const bytes = Utilities.base64Decode(parts[1]);
    const safeId = String(trip.id || new Date().getTime()).replace(/[^a-zA-Z0-9_-]/g, "_");
    const blob = Utilities.newBlob(bytes, "image/jpeg", "mapa_" + safeId + ".jpg");
    const folder = obtenerCarpetaCapturas_();
    const file = folder.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      // Algunas cuentas corporativas impiden compartir públicamente.
    }

    return {
      url: file.getUrl(),
      directUrl: "https://drive.google.com/uc?export=view&id=" + file.getId()
    };
  } catch (error) {
    console.error("No se pudo guardar la captura: " + error);
    return { url: "", directUrl: "" };
  }
}

function obtenerCarpetaCapturas_() {
  const folders = DriveApp.getFoldersByName(SCREENSHOT_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(SCREENSHOT_FOLDER_NAME);
}

function crearOActualizarHoja_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const currentLastColumn = Math.max(sheet.getLastColumn(), 1);
    const currentHeaders = sheet.getRange(1, 1, 1, currentLastColumn).getValues()[0];
    headers.forEach(header => {
      if (!currentHeaders.includes(header)) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
        currentHeaders.push(header);
      }
    });
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setFontWeight("bold")
    .setBackground("#07539a")
    .setFontColor("#ffffff");
}

function fecha_(value) {
  return value ? new Date(value) : "";
}

function calcularDistanciaKm_(route) {
  let meters = 0;

  for (let index = 1; index < route.length; index++) {
    meters += haversine_(route[index - 1], route[index]);
  }

  return Math.round((meters / 1000) * 100) / 100;
}

function haversine_(a, b) {
  const R = 6371000;
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}
