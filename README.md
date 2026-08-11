# EDICIÓN FINAL

Esta edición es la versión operativa. El modo simulado está deshabilitado y oculto.

# Observador Vial RMS

Aplicativo web para registrar recorridos y peligros viales.

## Incluye

- Logo institucional RMS.
- Recorrido real mediante GPS.
- Modo de prueba sin GPS.
- Ruta simulada en Cali para revisar toda la parte visual.
- Mapa OpenStreetMap con Leaflet.
- Registro de tipo de peligro y nivel de riesgo.
- Envío de recorridos reales a Google Apps Script.
- El modo de prueba no se guarda ni se envía.
- Almacenamiento temporal de recorridos pendientes.
- Diseño adaptable para celular y computador.

## Publicación en GitHub Pages

1. Sube todos los archivos y la carpeta `assets` al repositorio.
2. En GitHub abre `Settings`.
3. Entra a `Pages`.
4. En `Build and deployment` selecciona `Deploy from a branch`.
5. Selecciona la rama `main` y la carpeta `/root`.
6. Guarda y espera la publicación.

## Configuración de Google Apps Script

1. Conserva tu URL `/exec` en `config.js`.
2. En `Code.gs`, reemplaza:
   `PEGUE_AQUI_EL_ID_DE_SU_HOJA`
   por el ID de la hoja de cálculo.
3. Implementa Apps Script como aplicación web.
4. El modo de prueba es bloqueado tanto en el navegador como en `Code.gs`.

## Archivos principales

- `index.html`: estructura visual.
- `styles.css`: diseño.
- `app.js`: GPS, simulación, mapa, peligros y envío.
- `config.js`: URL de Apps Script.
- `Code.gs`: receptor para Google Sheets.
- `manifest.webmanifest`: instalación como aplicación.
- `sw.js`: caché y funcionamiento básico sin conexión.

## Corrección del mapa (versión 5)

- El mapa recalcula su tamaño al mostrarse y cuando cambia el espacio disponible.
- Se agregó el botón **Marcar condición peligrosa** para evitar toques accidentales.
- El punto seleccionado puede arrastrarse antes de guardar.
- Se agregó el botón **Volver al recorrido**.
- Guardar un peligro ya no destruye ni reinicia el mapa.
- Se validan las coordenadas antes de registrar el peligro.
- Se muestra una advertencia si las teselas de OpenStreetMap no cargan.


## Modo de prueba sin desplazamiento

La pantalla inicial incluye **Modo de prueba (recorrido simulado)**. Este modo genera puntos de una ruta ficticia automáticamente, permite avanzar punto por punto o completar toda la ruta, y después probar el mapa y el registro de peligros. No usa GPS, no guarda recorridos pendientes y no envía información al administrador.

El logo oficial suministrado se encuentra en `assets/logo-rms.png` y se usa en el encabezado, favicon y manifiesto de instalación.

## Captura automática del mapa

Al enviar un recorrido, la aplicación genera una imagen JPEG del mapa con la ruta y los íconos de peligro. Google Apps Script guarda la imagen en la carpeta de Drive **Observador Vial RMS - Capturas de mapas** y la muestra en las columnas **Captura del mapa** y **Enlace captura** de la hoja **Recorridos**.

Después de reemplazar `Code.gs`, es obligatorio crear una **nueva versión de la implementación web** de Apps Script y copiar la URL `/exec` en `config.js`.
