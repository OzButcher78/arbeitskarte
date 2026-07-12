# Architecture

## Mental model

```
main.tsx → <LocaleProvider> → App.tsx (shell: list ↔ editor, settings)
  list   → StatusSelect (inline status change) · preview icon (→ previewJobCard)
  editor → DocumentScanModal (scan) · CameraCaptureModal (photos) · CarMap (damage) · DateField (dates)
  scan   → DocumentScanModal → PhotoCompanionPanel (QR phone photo, Electron)
  save/load  → storage/jobCardRepository → Dexie (db.ts)
  scan       → scan/documentScanner → platform/apiBridge → transport (Electron IPC / Android HTTP)
  print      → print/JobCardDocument (HTML) → print/printPdfBlob (printToPDF / system print)
  settings   → settings/SettingsModal → repository.saveSettings + credentialStore
```

Three runtimes, resolved by `src/platform/detect.ts`: `browser` (dev), `electron` (Windows),
`android` (Capacitor). UI code branches on `isElectron()` / `isAndroid()`.

## Platform seam

- **`platform/detect.ts`** — the one place that decides the runtime.
- **`platform/apiBridge.ts`** — `bridgeFetch('/api/scan-document')` is the only network route. It
  dispatches to the Electron main-process handler (`window.electronAPI.scanDocument`) or the Android
  `CapacitorHttp` branch, which each POST straight to the chosen OCR provider (no third-party infra
  in the loop). Browser returns 501.
- **`platform/credentials.ts` / `credentialStore.ts`** — synchronous `get/set` credential cache
  fronting safeStorage (Electron, via IPC + preload snapshot), `@capacitor/preferences` (Android),
  or `sessionStorage` (browser). Only key: `doc_scan_key`.
- **`electron/preload.ts`** — the contextBridge `electronAPI` surface: `printToPdf`, `printPdf`,
  `scanDocument`, `fs.*`, `cred.*`, plus `initialCredentials` + `appVersion` snapshots.
- **`electron/main.ts`** — window (hidden titlebar overlay, media-permission grant for the camera),
  single-instance lock, IPC registration. Handlers in `electron/ipc/*`.

## Storage

- **Dexie** (`storage/db.ts`), DB name `Arbeitskarte_DB`, v1:
  - `jobcards: 'id, jobNumber, kontrollschild, vin, name, status, createdAt, updatedAt'`
  - `blobs: 'id, jobcardId, sortOrder'` — Ausweis (`kind:'ausweis'`) + photos (`kind:'photo'`), stored as `Blob`.
  - `appmeta: 'key'` — settings + counters.
- **`storage/jobCardRepository.ts`** is the only module that touches Dexie: `saveJobCard`,
  `getJobCard`, `deleteJobCard` (cascades blobs), `loadJobCardsList(filter)`, `getMaxJobNumber`,
  `mintJobNumber`, `saveBlob`/`getBlob`/`getBlobs`/`deleteBlob`, `getSettings`/`saveSettings`.
- **Numbering** (`numbering/jobNumber.ts` + `mintJobNumber`): flat single counter, minted as
  `max(jobNextNumber, dbMax+1)` so a gap/imported higher number is never re-issued. Format
  `PREFIX-NNN` (`formatJobNumber`/`parseJobNumber`).

## Scanner pipeline

1. **`scan/scanProviders.ts`** — pure, dependency-free. `buildScanRequest` (per-provider REST body;
   4 providers, default Infomaniak/CH), `parseScanResponse` (strict-JSON envelope → `ScanFields`),
   `sanitizeScanFields` (anti-hallucination), `normalizeVin/Plate/Stammnummer`. **Extended vs. the
   source app:** `ScanFields` + the prompt read the Halter block (`halter{Vorname,Name,Strasse,Plz,
   Ort}`) + `stammnummer`. Imported by three call sites that must agree: the Electron handler, the
   Android branch, and the client orchestrator.
2. **`scan/documentScanner.ts`** — client orchestrator. Sends via `bridgeFetch`, maps
   `ScanFields` → `ScanResult` (English-ish keys + Halter), sets `lowConfidence`.
3. **`electron/ipc/scan.ts`** — main-process transport; imports the pure module from
   `../../src/scan/scanProviders` (bundled by esbuild).
4. **`scan/DocumentScanModal.tsx`** — capture (camera / file / QR-from-phone) → downscale+encode the
   **whole** frame → confirm/edit → apply. No crop or redaction step (Grab wants the full image).
   Hands the full original back so the card stores it.
5. **`scan/applyScan.ts`** — merges a confirmed `ScanResult` into a `JobCardRecord` (vehicle +
   Halter → Kunde), only overwriting with non-empty values.
6. **`scan/vinDecode.ts`** — offline WMI/year decode. `scanRedaction.ts` is live again: its
   `defaultRedactionBox` geometry restricts the offline OCR parser to the Halter block, and its
   `documentFrameBox` drives the full-screen card-aspect alignment outline in `CameraCaptureModal`'s
   `variant='document'` layout (used by the Fahrzeugausweis scan). The outline is cosmetic
   (`pointer-events-none`) and is never baked into the captured JPEG — the whole frame is still
   captured uncropped.

## LAN photo companion (Phase 5, Electron-only)

Lets a phone on the same LAN shoot a photo straight into the scanner — no cable, no cloud.

- **`electron/companion/server.ts`** — a tiny `node:http` server (bound `0.0.0.0`, ephemeral port).
  Plain HTTP on purpose: the phone captures via the OS camera through an `<input capture>` (not
  `getUserMedia`), so no secure-context / self-signed-cert dance. A single active pairing keyed by a
  random token in the URL path; a new pairing 404s the old one. The received image lives only in
  memory and is consumed once. `getLanIp()` picks the first private IPv4.
- **`electron/ipc/companion.ts`** + **`electron/preload.ts`** — `companion:start` (→ `{url, token}`),
  `companion:poll` (→ the image once, then cleared), `companion:stop`.
- **`src/platform/companion.ts`** — renderer wrappers; `isCompanionAvailable()` gates the UI to
  Electron.
- **`src/scan/PhotoCompanionPanel.tsx`** — renders the phone URL as a QR (`qrcode`), polls every
  1.5 s, hands the data URL to `DocumentScanModal.runScan` when it arrives, tears the pairing down on
  close.

## Car map

The commissioned **`carmap/FlatCarMap2.svg`** (multi-view blueprint, viewBox `185 460 2095 1575`)
is the single source of truth for geometry AND appearance. It self-contains 49 clickable panels
keyed by `data-panel`, an embedded `<style>` that owns every visual state (hover + `.selected`
fills per category: body/rear-light red, glass/indicator orange, front-light yellow), and a
trailing `<g id="DrawLayer">` for freehand strokes. **Never edit / reformat / optimize this file.**

- **`carmap/panels.ts`** — pure data: `PANEL_DEFS` (49 `{key,label,category}`) → `PANEL_LABELS` /
  `PANEL_CATEGORIES`; `panelLabel`/`panelCategory` (fallbacks: new → legacy → raw id / `'body'`);
  `LEGACY_PANEL_MIGRATION` (16 old ids → new keys) + `LEGACY_LABELS` (all 20 old ids).
- **`carmap/strokes.ts`** — `MIN_POINT_DIST` + `strokeToPathD` (a single point → `M p L p`, a dot).
- **`carmap/CarMap.tsx`** — inlines the SVG via `?raw` + a **module-level** `{__html}` (stable
  identity → React sets innerHTML once, never clobbering imperative edits). Props
  `{selected, strokes, mode, onToggle, onStrokeAdd}`. Native listeners attach **once** and read a
  `latest` ref: `click` delegates via `closest('[data-panel]')`; Pointer Events (`setPointerCapture`,
  viewBox coords via `createSVGPoint`+`getScreenCTM().inverse()`) drive freehand draw. Idempotent
  effects toggle `.selected` (querySelectorAll over `[data-panel="KEY"]`, so multi-view panels
  light up together), the `draw-mode` class, and repopulate `#DrawLayer`. Draw mode (`'select'`
  vs `'draw'`) is ephemeral UI state, not persisted.
- **`carmap/svgString.ts`** — `carMapSvgString(selected, strokes)` for print: `DOMParser` bakes the
  `.selected` classes + stroke paths into a clone, `XMLSerializer` emits it (renderer-only).
- **Persistence**: `damagedParts` (data-panel keys) + `damageStrokes: DamageStroke[]` on the record;
  the Dexie **v2** upgrade remaps legacy ids and backfills `damageStrokes: []`.

## Print

- **`print/JobCardDocument.ts`** — `buildJobCardHtml()` returns a self-contained A4 page (inline
  CSS + inline base64 photos + inline car-map SVG). German labels hardcoded.
- **`print/printPdfBlob.ts`** — `printJobCard(html, filename)`: Electron → `renderHtmlToPdfBytes`
  (offscreen `printToPDF`) → `previewPdfBytes` (native preview window); Android/browser → open the
  page + system print dialog. No PDF is persisted — the card is stored as data and re-rendered.

## Deliberately left behind (from the source app)

No cost/AW calculation, invoicing, vault multi-device sync, audit hash-chain, licensing/trial gate,
multi-region/currency, or the 5-locale i18n machinery. Puppeteer is replaced by `printToPDF`.
The Android EncryptedSharedPreferences secure-store plugin is simplified to `@capacitor/preferences`
for the single BYO key (upgrade path noted in `credentials.ts`).
