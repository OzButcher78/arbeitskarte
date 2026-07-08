# Handoff — continue building Arbeitskarte

> Paste this into a new Claude Code session started **inside** `C:\Users\Dieter\git\arbeitskarte`.
> `CLAUDE.md`, `ARCHITECTURE.md`, `errors.md`, `reference.md` are the orientation docs (CLAUDE.md
> auto-loads). The original build plan is at
> `C:\Users\Dieter\.claude\plans\read-swiss-jobcard-app-reuse-plan-md-ful-witty-chipmunk.md`.

## Paste-to-continue prompt

> Read HANDOFF.md, CLAUDE.md and ARCHITECTURE.md, then continue the Arbeitskarte plan. Phases 0–5
> are done and committed. Do the next open item (see HANDOFF “Next steps”): the Android shell
> (`npx cap add android`), then the manual smokes. Keep typecheck at zero and both Vite builds green;
> commit per phase.

## Status (as of 2026-07-08)

Standalone repo, git initialized locally on `main`, **8 commits, no remote yet**. Windows (Electron)
+ Android (Capacitor) from one tree, CH-German only.

**Done & verified** (typecheck app/electron/node clean · both `BUILD_TARGET` builds green · isolation
grep clean · NSIS installer built):

- **Phase 0** `13269a7` — skeleton, Dexie, i18n shim, printToPDF round-trip.
- **Phase 1** `eac3c5f` — camera + document scanner; extraction **extended to Halter block +
  Stammnummer**; Settings; redaction opt-in/off; stores full original Ausweis.
- **Phase 2** `4023551` — data-driven car map + Frontstossstange/Heckstossstange.
- **Phase 3** `bc210fd` — full card form, per-job photos, unified Settings (Betrieb + Nummerierung +
  Scanner).
- **Phase 4** `35523eb` — A4 print (`JobCardDocument` + workshop header) via printToPDF / system print.
- Docs `4fec4e1`,`e3d1f01`.
- **Phase 5 + UI improvements** (this session): LAN QR phone companion (`electron/companion/server.ts`,
  `electron/ipc/companion.ts`, `src/platform/companion.ts`, `src/scan/PhotoCompanionPanel.tsx`, `qrcode`
  dep); **scanner sends the whole image** (crop/redaction step removed); list **status dropdown** +
  **preview icon**; **clickable windscreens** (amber) on the car map; **mini date picker**
  (`src/components/DateField.tsx`). GitHub remote created (private, account `OzButcher78`).

## Next steps (pick up here)

1. **Android shell:** `npx cap add android` (needs Android SDK), then `npm run build:android` /
   `npm run cap:run:android`. Verify the CapacitorHttp scan path + system print on a tablet.
2. **Phase 5 real-device smoke:** phone on the shop LAN scans the QR, shoots a Fahrzeugausweis, and it
   lands in the scanner. Windows Firewall will prompt to allow the port on first run. Server logic +
   phone page are verified headlessly; only the two-device handshake is untested.
3. **Manual smokes** (couldn't run headless): install the `.exe`, run a real scan with a valid
   Infomaniak key (Produkt-ID + key in Settings), toggle the car map (incl. windscreens), use the date
   picker + list status dropdown + preview icon, save → restart → search, do a physical print / "Als
   PDF speichern".

## Commands

```bash
npm install            # if node_modules is missing
npm run dev            # browser dev
npm run dev:desktop    # Electron shell (launches the real window)
npm run typecheck:all  # app + electron configs — keep at zero
npm run build:desktop  # unsigned NSIS → release/
npm run build:android  # after `npx cap add android`
```

## Gotchas

- Print on Electron uses `webContents.printToPDF` (no Puppeteer). See `src/print/`.
- Scanner key lives only in the credential store (`doc_scan_key`), never in settings.
- New synced/persisted `AppSettings` fields need a default in `DEFAULT_SETTINGS`
  (`src/types/jobcard.ts`) — `getSettings()` shallow-merges over it.
- Keep the repo standalone: isolation grep for the source app's identifiers must return nothing
  (CLAUDE.md rule 1).
