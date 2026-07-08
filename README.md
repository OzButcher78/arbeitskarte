# Arbeitskarte

Digitale **Auftragskarte** (Job-Card) für die Carrosserie **Spritzwerk Grab GmbH**, Schwyz.
Ersetzt die handschriftliche Papier-Arbeitskarte: Fahrzeugausweis scannen (OCR, eigener
Schlüssel) → Fahrzeug- **und Halterdaten** automatisch übernehmen, Schaden auf einer
Fahrzeug-Grafik markieren, Arbeiten/Material erfassen, A4-Karte drucken/als PDF speichern,
alles lokal ablegen und wieder durchsuchbar machen.

**Standalone** — kein Bezug zu anderen Projekten. Alles läuft offline auf dem Gerät.

## Stack

React + TypeScript + Vite + Dexie (IndexedDB). Zwei Ziele aus einem Baum:

| Ziel | Shell | Befehl |
|---|---|---|
| Windows | Electron | `npm run dev:desktop`, `npm run build:desktop` |
| Android-Tablet | Capacitor | `npm run cap:run:android`, `npm run build:android` |
| Browser (nur Dev) | Vite | `npm run dev` |

CH-Deutsch only. Kein Login, keine Cloud, keine Kalkulation.

## Setup

```bash
npm install
npm run dev            # Browser-Dev (schnellste Iteration)
npm run dev:desktop    # Electron-Shell
npm run typecheck      # tsc, muss sauber sein
```

Für Android zuerst einmalig `npx cap add android` ausführen (legt `android/` an).

## Struktur

```
electron/          Electron-Hauptprozess + IPC (Fenster, Druck, Scan, FS, Credentials)
src/
  platform/        detect (isElectron/isAndroid), apiBridge (Renderer→IPC/CapacitorHttp)
  i18n/            Ein deutsches Wörterbuch hinter useLocale() (Shim)
  storage/         Dexie-DB + jobCardRepository
  types/           JobCardRecord etc.
capacitor.config.ts / electron-builder.config.cjs / vite.config.ts
```
