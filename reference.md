# Reference

Provenance, external resources, defaults, and open items. (Kept free of other-repo path/name
tokens so the isolation grep stays clean — see CLAUDE.md rule 1.)

## Provenance

Several modules were **copied and adapted** from an existing internal Electron/Capacitor app
(scanner, camera, car map, print/FS/credential primitives). The originals were only ever read;
this repo owns its copies and its data model. Adaptations of note:

- Scanner extraction **extended** to read the owner (Halter) block + Swiss Stammnummer.
- Owner-block redaction **and the crop step removed** — the scanner sends the whole captured/attached
  image (the shop wants the Halter data). `scanRedaction.ts` now only feeds the camera framing guide.
- Puppeteer PDF replaced by `webContents.printToPDF`.
- Audit logging stripped from the scan modal; a fresh, dependency-light **LAN photo companion (QR)**
  added as Phase 5 (`qrcode` + a `node:http` server; plain HTTP over LAN, no self-signed cert).
- Android secure-store plugin simplified to `@capacitor/preferences` for the single BYO key.

## OCR providers (BYO key)

Configured in Settings → Scanner. Metadata + endpoints live in `src/scan/scanProviders.ts`
(`SCAN_PROVIDER_META`, `SCAN_MODELS`).

| Provider | Region | Notes |
|---|---|---|
| **infomaniak** (default) | CH | OpenAI-compatible; endpoint templates a non-secret **Produkt-ID**; no `response_format` (vLLM host rejects it). |
| mistral | EU | OpenAI-compatible; image part is a bare string. |
| openai | US | Standard chat-completions; gated behind the US cross-border ack. |
| anthropic | US | Messages API; `anthropic-dangerous-direct-browser-access` header. |

The key is stored under credential key `doc_scan_key` (never in settings). Compliance ack + DPA link
are required before the scanner is usable.

## Swiss Fahrzeugausweis field cues (extraction prompt)

Marke/Modell = the "Marke und Typ" line (split); Kennzeichen/Kontrollschild; Fahrgestellnummer =
17-char VIN (code E); **Stammnummer** = 9-digit `123.456.789` (distinct from the VIN);
**Typengenehmigung** = field 24 (EU: code K), short letters+digits code, copied as printed; Erstzulassung
= "1. Inverkehrsetzung" (code B); Halter block = codes C / C.1.1 (name) / C.1.3 (address).

## Local storage / keys

- Dexie DB: `Arbeitskarte_DB` (`jobcards`, `blobs`, `appmeta`).
- Settings: `appmeta['settings']` (`AppSettings`, defaults in `src/types/jobcard.ts`).
- Credential key: `doc_scan_key` (prefix `ak_` inside the store).
- Electron userData folder: `Arbeitskarte` (under `%AppData%`).

## Workshop defaults (Grab)

`DEFAULT_SETTINGS.workshop` in `src/types/jobcard.ts`: Carrosserie Spritzwerk Grab GmbH,
Grundstrasse 126, 6430 Schwyz, info@carrosserie-grab.ch, www.carrosserie-grab.ch. Editable in
Settings → Betrieb (incl. logo for the print header). Job-number default prefix `AK`.

## Build / release

- Electron: `npm run build:desktop` → unsigned NSIS in `release/`. `appId ch.spritzwerkgrab.arbeitskarte`,
  no auto-update channel yet (add `publish` + a release script when wanted).
- Android: needs `npx cap add android` once (Android SDK), then `npm run build:android`.
- Line endings pinned to LF via `.gitattributes` (Capacitor `cap sync` is LF-sensitive).

## Open items

- **Phase 5 built** (LAN QR phone companion, Electron-only). Server logic + phone page verified
  headlessly (unit smoke, offscreen render); the real two-device handshake (phone camera over the
  shop LAN, Windows-Firewall allow-prompt on first run) still needs a manual smoke.
- **Android shell** not scaffolded (`npx cap add android` pending).
- **Manual smokes** (can't run headless): real scan with a valid Infomaniak key; interactive car-map
  toggling (incl. the new windscreen zones); the mini date picker; the list status dropdown + preview
  icon; save → restart → search persistence; physical print / "Als PDF speichern"; QR companion from a
  real phone.
