# Arbeitskarte — Operating Guide

Digital **Auftragskarte** (job card) for the carrosserie **Spritzwerk Grab GmbH**, Schwyz.
Replaces the handwritten paper card: scan the Fahrzeugausweis (OCR, bring-your-own key) →
auto-fill vehicle **and owner (Halter)** fields, mark damage on a clickable car diagram,
capture free-text work/material lines, print a clean A4 card / export PDF, and keep a
searchable local archive.

**Standalone.** This repo has no connection to any other project. Everything runs offline on
the device.

---

## Start of every session — pull first

This repo is edited from **two machines** (laptop and home desktop) and `main` on GitHub is the
single source of truth. Before touching anything — reading code, planning, editing, building:

```bash
git status            # must be clean; stash or commit stray local changes first
git pull --ff-only    # bring in what the other machine pushed
npm install           # only if package-lock.json changed in the pull
```

If `git pull --ff-only` refuses (diverged histories), stop and show the user — never force. When a
piece of work is finished, **commit and push** so the other machine finds it.

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
   but must stand alone: a case-insensitive grep across `src` + `electron` for the source app's
   product / package identifiers must return nothing. Never add a path reference to another repo.
2. **Scanner privacy contract** (`src/scan/scanProviders.ts`): the extraction reads vehicle fields
   **and** the owner (Halter) block + Swiss Stammnummer — this is intentional (the shop needs it).
   A camera capture in the Fahrzeugausweis flow is **cropped to the on-screen alignment box** (the
   whole card the user framed — Halter block included; only the surrounding hand/desk/background is
   trimmed); file / companion attachments are sent **as-is**. There is **no owner-block redaction
   step** — Grab wants the Halter data — so owner PII still leaves the device to the OCR provider and
   the Settings compliance ack **must stay**. A policy / contract / insurance-certificate **number**
   is never extracted. The BYO API key lives only in the credential store (`doc_scan_key`), **never**
   in settings/localStorage.
3. **Print = `printToPDF`, not `window.print()` on Electron.** Desktop renders A4 via an offscreen
   `webContents.printToPDF` and previews the bytes; Android/browser fall back to the system print
   dialog. Never bundle Puppeteer/Chromium. The card is folded by hand: keep the **10mm fold band**
   on each side of the A4 centre line empty (see ARCHITECTURE.md → Print) when touching the layout.
4. **Credentials never in plaintext settings.** Only `credentialStore` (safeStorage / Preferences /
   sessionStorage) holds the scanner key.
5. **Backwards compatibility.** `getSettings()` shallow-merges over `DEFAULT_SETTINGS`; new
   `AppSettings` fields must have a default there so old stores keep working.
6. **Typecheck stays at zero** — see [errors.md](errors.md).
7. **Data model is owned here** (Tier-2, German field names): `src/types/jobcard.ts`. Car-map part
   ids are the canonical `data-panel` keys of `FlatCarMap2.svg` (49 panels); legacy region ids are
   remapped by the Dexie **v2** upgrade (v3 adds the `garagen` store) and any unknown id is tolerated (label fallback, renders as
   a chip but doesn't highlight). `damageStrokes` holds freehand strokes in the SVG's viewBox space.
   `FlatCarMap2.svg` is inlined via `?raw` and owns ALL geometry and visual states. **Never
   reformat/optimize it or rename its paths / `data-panel` keys** (geometry is frozen). Damage
   colours are NOT computed in the app — tune the hover/selected fills, `fill-opacity`, and the
   `#DrawLayer` stroke in its embedded `<style>` (one edit flows to both the live map and the print
   bake-in). The app only toggles a `.selected` class and writes stroke `d` paths into `#DrawLayer`.

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
| App shell / editor / list | `src/App.tsx`, `src/main.tsx`, `src/components/{ErrorBoundary,DateField}.tsx` |
| Platform seam | `src/platform/{detect,apiBridge,credentials,credentialStore,companion,androidBackHandler}.ts` |
| i18n shim | `src/i18n/{locale.tsx,de.ts}` |
| Storage | `src/storage/{db,jobCardRepository,garageRepository}.ts`, `src/numbering/jobNumber.ts` |
| Garagen-Adressbuch | `src/garage/GaragePickerModal.tsx` (picker + edit; card stores a snapshot) |
| Data model | `src/types/jobcard.ts` |
| Scanner | `src/scan/{scanProviders,documentScanner,scanRedaction,vinDecode,applyScan,DocumentScanModal,PhotoCompanionPanel}.tsx?`, `electron/ipc/scan.ts` |
| LAN photo companion (Phase 5, Electron) | `electron/companion/server.ts`, `electron/ipc/companion.ts`, `src/platform/companion.ts`, `src/scan/PhotoCompanionPanel.tsx` |
| Capture | `src/capture/{CameraCaptureModal.tsx,useDeviceCameras,compressImage,photoLimits}.ts` |
| Car map | `src/carmap/{panels,strokes,CarMap,svgString}.ts? + FlatCarMap2.svg` (49-panel multi-view blueprint + freehand draw) |
| Print | `src/print/{JobCardDocument,printPdfBlob}.ts`, `electron/ipc/{print,printPdf}.ts` |
| Settings | `src/settings/SettingsModal.tsx` |
| Electron shell | `electron/{main,preload}.ts`, `electron/ipc/{fs,credentials,types}.ts` |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how these fit together, and [reference.md](reference.md)
for external resources + defaults + open items.
