# Arbeitskarte — Operating Guide

Digital **Auftragskarte** (job card) for the carrosserie **Spritzwerk Grab GmbH**, Schwyz.
Replaces the handwritten paper card: scan the Fahrzeugausweis (OCR, bring-your-own key) →
auto-fill vehicle **and owner (Halter)** fields, mark damage on a clickable car diagram,
capture free-text work/material lines, print a clean A4 card / export PDF, and keep a
searchable local archive.

**Standalone.** This repo has no connection to any other project. Everything runs offline on
the device.

---

## Identity & stack

- **Stack:** React 19 + TypeScript + Vite + Dexie (IndexedDB) + Tailwind CSS v4.
- **One tree, two targets** (`BUILD_TARGET` switch in `vite.config.ts`):

| Target | Shell | Dev | Build |
|---|---|---|---|
| Windows | Electron | `npm run dev:desktop` | `npm run build:desktop` (unsigned NSIS) |
| Android tablet | Capacitor | `npm run cap:run:android` | `npm run build:android` |
| Browser (dev only) | Vite | `npm run dev` | — |

- **Language:** CH-German only. No i18n machinery — one flat German dict behind a `useLocale()`
  shim (`src/i18n/`). New user-visible strings go there or are hardcoded German in print templates.

---

## Critical rules

1. **No coupling to other repos.** This app copied/adapted modules from an internal source app,
   but must stand alone: `grep -rEi "pdrkalk|pdr kalk|bss pdr" src electron *.ts *.cjs` must return
   nothing. Never add a path reference to another repo.
2. **Scanner privacy contract** (`src/scan/scanProviders.ts`): the extraction reads vehicle fields
   **and** the owner (Halter) block + Swiss Stammnummer — this is intentional (the shop needs it).
   Because owner PII therefore leaves the device to the OCR provider, the Settings compliance ack
   must stay. A policy / contract / insurance-certificate **number** is never extracted. The BYO API
   key lives only in the credential store (`doc_scan_key`), **never** in settings/localStorage.
3. **Print = `printToPDF`, not `window.print()` on Electron.** Desktop renders A4 via an offscreen
   `webContents.printToPDF` and previews the bytes; Android/browser fall back to the system print
   dialog. Never bundle Puppeteer/Chromium.
4. **Credentials never in plaintext settings.** Only `credentialStore` (safeStorage / Preferences /
   sessionStorage) holds the scanner key.
5. **Backwards compatibility.** `getSettings()` shallow-merges over `DEFAULT_SETTINGS`; new
   `AppSettings` fields must have a default there so old stores keep working.
6. **Typecheck stays at zero** — see [errors.md](errors.md).
7. **Data model is owned here** (Tier-2, German field names): `src/types/jobcard.ts`. The car-map
   part ids are free-form (no fixed-panel rule); custom regions are fine.

---

## Commands

```bash
npm install
npm run dev            # browser dev (fastest iteration)
npm run dev:desktop    # Electron shell
npm run typecheck      # tsc app config — must be clean
npm run typecheck:all  # app + electron configs
npm run build:desktop  # BUILD_TARGET=electron vite build + electron-builder (NSIS)
npm run build:android  # BUILD_TARGET=capacitor vite build + cap sync
```

Android needs a one-time `npx cap add android` (Android SDK) before `cap` scripts work.

---

## File map

| Area | Files |
|---|---|
| App shell / editor / list | `src/App.tsx`, `src/main.tsx`, `src/components/ErrorBoundary.tsx` |
| Platform seam | `src/platform/{detect,apiBridge,credentials,credentialStore,androidBackHandler}.ts` |
| i18n shim | `src/i18n/{locale.tsx,de.ts}` |
| Storage | `src/storage/{db,jobCardRepository}.ts`, `src/numbering/jobNumber.ts` |
| Data model | `src/types/jobcard.ts` |
| Scanner | `src/scan/{scanProviders,documentScanner,scanRedaction,vinDecode,applyScan,DocumentScanModal}.tsx?`, `electron/ipc/scan.ts` |
| Capture | `src/capture/{CameraCaptureModal.tsx,useDeviceCameras,compressImage,photoLimits}.ts` |
| Car map | `src/carmap/{regions,CarMap,svgString}.ts?` |
| Print | `src/print/{JobCardDocument,printPdfBlob}.ts`, `electron/ipc/{print,printPdf}.ts` |
| Settings | `src/settings/SettingsModal.tsx` |
| Electron shell | `electron/{main,preload}.ts`, `electron/ipc/{fs,credentials,types}.ts` |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how these fit together, and [reference.md](reference.md)
for external resources + defaults + open items.
