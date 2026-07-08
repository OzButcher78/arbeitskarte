# Architecture

## Mental model

```
main.tsx → <LocaleProvider> → App.tsx (shell: list ↔ editor, settings)
  editor → DocumentScanModal (scan) · CameraCaptureModal (photos) · CarMap (damage)
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
4. **`scan/DocumentScanModal.tsx`** — capture → crop → (optional owner-block redaction, off by
   default) → confirm/edit → apply. Returns the **full un-redacted original** so the card stores it.
5. **`scan/applyScan.ts`** — merges a confirmed `ScanResult` into a `JobCardRecord` (vehicle +
   Halter → Kunde), only overwriting with non-empty values.
6. **`scan/scanRedaction.ts` / `vinDecode.ts`** — pure crop/redaction geometry; offline WMI/year decode.

## Car map

- **`carmap/regions.ts`** — data: `DECOR` (outline paths) + `REGIONS` (16 body zones lifted +
  `frontStossstange`/`heckStossstange`). Each region is `{id,label,shape}` where shape is
  path/polygon/rect.
- **`carmap/CarMap.tsx`** — generic renderer; `selected: Set<string>` + `onToggle`.
- **`carmap/svgString.ts`** — `carMapSvgString(selected)` for the print HTML (outline + selected
  regions in red).

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
