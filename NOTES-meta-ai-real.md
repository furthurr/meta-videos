# meta.ai — Flujo real (reverse-engineering en vivo, jun 2026)

Capturado conectando por CDP a una sesión real logueada (`furfur_furthurr`)
en `https://meta.ai/create?filter=videos`, Chrome 149, UI en español.

## Hallazgos clave

1. **El composer es un editor enriquecido** (tipo Lexical), no un `<textarea>`:
   - El elemento editable real es `div[role="textbox"][contenteditable="true"]`
     (el visible, ~728px). Hay `<textarea>` espejo a `0x0` (ignorar).
   - **`document.execCommand("insertText", ...)` FUNCIONA** e inserta el texto,
     sincroniza el textarea espejo y **habilita el botón Enviar**. ✅ Verificado.

2. **Botón enviar**: `button[aria-label="Enviar"]` (español). Deshabilitado si
   el composer está vacío; se habilita al escribir.

3. **Un prompt genera 4 resultados a la vez** (NATIVO). No hay que enviar 4
   veces. Durante la generación aparecen ~4 `[role="progressbar"]`.

4. **Los resultados NO son `<video>`**. Cada resultado es una tarjeta
   `div.group/media-item` con:
   - un `<img>` poster (`scontent-*.fbcdn.net/o1/v/t0/...`),
   - un link `/create/<id>`,
   - botones: **"Descargar"**, "Añadir a favoritos", "Compartir", "Más opciones".

5. **Descarga = botón "Descargar"** de meta.ai. Al hacer click descarga un
   **`blob:https://meta.ai/...`**. En la prueba (modo imagen) el archivo fue
   `*.jpeg`. Para vídeo sería `.mp4` (mismo mecanismo, pendiente de confirmar).
   - No hay URL mp4 directa en el DOM (solo el poster). El blob lo genera
     meta.ai al pulsar Descargar.

6. **Modo Imagen vs Vídeo + aspecto** están en el popover del botón azul
   **"Creación"** del composer (contiene "9:16", etc.). El default produjo
   **imágenes** → para vídeo hay que seleccionar "Vídeo" en ese popover.
   - `filter=videos` en la URL solo filtra la GALERÍA, no el modo de creación.

7. **Aspecto** sí es configurable (9:16 confirmado en el popover).
   **Duración/resolución**: no confirmados como controles (probablemente meta.ai
   no expone duración; los videos tienen su duración fija por modelo).

## Implicaciones para la extensión (v2)

El flujo actual (enviar 4×, esperar `<video>`, leer `src`) **no aplica** a
meta.ai real. El flujo correcto es:

1. (Una vez por lote) Abrir popover "Creación" → seleccionar **Vídeo** +
   aspecto deseado (best-effort; si no encuentra el control, sigue con default).
2. Escribir el prompt en `[role="textbox"]` con `execCommand insertText`.
3. Click en **Enviar** (una sola vez).
4. Esperar a que **desaparezcan los progressbars** y aparezcan **N botones
   "Descargar"** (N≈4). meta.ai puede tardar 1-3 min en vídeo.
5. **Descargar** = click en cada botón "Descargar". Para conservar nombre y
   carpeta (`MetaVideos/<slug>/NN_<slug>.mp4`) usar
   **`chrome.downloads.onDeterminingFilename`** en el background, que renombra
   las descargas que dispara meta.ai mientras el job está activo.
6. "4 videos por prompt" es nativo: **1 submit por prompt**, no 4.

## Selectores confirmados (ya en `lib/selectors.js`)

- `findPromptInput()` → editable visible más grande (role=textbox).
- `findSendButton()` → aria-label "Enviar"/"Send"/...
- `isGenerating()` → `[role="progressbar"]` presentes.
- `findResultCards()` → `[class*="media-item"]`.
- `findDownloadButtons()` → aria-label "Descargar"/"Download"/...
- `findCreacionButton()` → botón "Creación"/"Creation" del composer.

## Pendiente para completar v2

- Reescribir `content.js`: flujo cards+Descargar en vez de `<video>`.
- `background.js`: `onDeterminingFilename` + 1 submit por prompt (no 4).
- Selección de modo Vídeo + aspecto en el popover "Creación".
- Actualizar mock (`test/e2e/fixtures`) a tarjetas+Descargar+blob.
- Confirmar descarga `.mp4` real en modo Vídeo.

---

## v2 IMPLEMENTADA (basada en el código real de la extensión de referencia)

Descargué e inspeccioné la extensión de referencia
(`pcmcomcmgpmnpdmkdgjnipeipchbfchf`). Sus selectores vienen de un **config
remoto**: `https://configs.kylenguyen.me/config/meta-automation`
(fallback `https://extension-config.onegreen.workers.dev`,
header `X-Client-Secret: YES_THAT_IS_VERY_EASY_RIGHT_?!`).
Copia guardada en `test/cdp/ref-selectors.json`.

### Selectores reales (config remoto) — verificados en vivo
- `promptContentEditable` = `div[contenteditable='true']` ✅
- `sendButton` = `button[data-testid="composer-send-button"], button[data-testid="composer-animate-button"]` ✅
- `modeButton` = `button[role="combobox"]:eq(0)`; `videoModeItem` = `div[role=option]:eq(1)`
- `aspectRatioButton` = `button[role="combobox"]:eq(1)`; opción por texto "9:16"
- `latestOutputContainer` = `div[data-message-item="true"]:last()`
- `loadingOutputElement` = `div.group/media-item canvas` (el loader es un canvas)

### Proceso de descarga de la referencia (REPLICADO en nuestra extensión)
1. Detectar fin: el contenedor de salida ya no tiene `canvas` de carga y hay
   `<video>` con `src`.
2. Por cada `<video>`: leer `.src`. En meta.ai real el src es una **URL
   directa de `fbcdn`** (`scontent-*.fbcdn.net/o1/v/...`) — descargable
   directamente. Si fuese `blob:`, se convierte con `fetch → readAsDataURL`.
3. `chrome.runtime.sendMessage({ type:"DOWNLOAD_RESOURCE", url, filename, folder })`.
4. Background: `chrome.downloads.download({ url, filename: folder/filename })`
   y un `onDeterminingFilename` que renombra las descargas `fbcdn` (red de
   seguridad) — exactamente como el SW de la referencia.

### Confirmado en vivo (CDP a la sesión real)
- Prompt "Crea un vídeo de…" → genera **vídeo** → descarga `.mp4`.
- `findResultVideos()` encuentra 5 `<video>` con URLs `fbcdn`.
- `findSendButton()` devuelve `composer-send-button` al haber texto.
- `findPromptInput()` devuelve el `div[role=textbox][contenteditable]`.

### Dónde está en nuestro código
- `lib/selectors.js`: `findSendButton` (data-testid), `findResultVideos`,
  `findModeButton/Option`, `findAspectButton/Option`, `isGenerating` (canvas).
- `content.js`: `configureVideoMode`, `waitForResults`, `downloadVideos`
  (blob→dataURL + DOWNLOAD_RESOURCE).
- `background.js`: `handleDownload` (DOWNLOAD_RESOURCE), `onDeterminingFilename`
  (rename fbcdn), 1 submit por prompt en `runLoop`.
