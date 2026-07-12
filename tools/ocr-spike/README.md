# OCR accuracy spike — offline Fahrzeugausweis read

Phase A of the "offline OCR provider" plan. Proves whether a pure **Tesseract.js
(`deu`)** read + anchor/pattern parsing is accurate enough on the 4 real sample
photos **before** any app integration (Phase B).

The parser under test is the shared, app-bound module
[`src/scan/localOcr/parseOcrWords.ts`](../../src/scan/localOcr/parseOcrWords.ts) —
the spike runs the *exact same code* the app will run, so a good spike result
carries over.

## What it does

For each `samples/<name>.{jpg,jpeg,png,webp}` that has a sibling
`samples/<name>.expected.json`:

1. **Preprocess** (`variants.ts`, sharp) into candidate images:
   `full` · `app2560` (the real app pipeline: 2560 px / JPEG q0.85) · `gray` ·
   `up2x`.
2. **OCR** each variant under page-seg modes 3/4/6/11 (`engineNode.ts`).
3. **Parse** the word boxes with `parseOcrWords`.
4. **Score** against the expected JSON — both sides canonicalised by the app's
   own normalisers (`normalizeVin`, `normalizePlate`, `normalizeStammnummer`, …).

It prints a **leaderboard** (which variant×PSM wins), a **per-field accuracy**
table for the winner, per-sample detail, and a **PASS/FAIL** against the gate.

## Setup

```bash
npm install                 # pulls tesseract.js, tsx, sharp (devDeps)
```

`deu.traineddata.gz` (tessdata_fast) is vendored in `tessdata/` and committed —
no download at run time. If it is missing, see `tessdata/README.md`.

## Add the samples (local only — PII, gitignored)

Drop the photos into `samples/`. That alone is enough for a **preview** — the run
prints the fields each photo extracted (+ confidence), no ground truth needed:

```
samples/
  card1.jpg
  card2.jpg
```

To get a **scored** accuracy table + the Phase-A gate, add a ground-truth file
next to a photo:

```
samples/
  card1.jpg
  card1.expected.json      # copy expected.template.json, fill in what you read
```

`*.expected.json` has the 13 `ScanFields` keys; use `null` for anything not
present/legible on that card (nulls are not counted against accuracy). Template:
[`expected.template.json`](expected.template.json). Photos with a sibling JSON are
scored; the rest show up under "Preview".

> `samples/` is in `.gitignore` — real names/addresses never get committed.

## Run

```bash
npm run spike:ocr
```

Narrow the search space while iterating:

```bash
SPIKE_VARIANTS=app2560,gray SPIKE_PSM=6 npm run spike:ocr
```

Env knobs: `SPIKE_VARIANTS`, `SPIKE_PSM`, `SPIKE_GATE_HARD`, `SPIKE_GATE_OVERALL`,
`SPIKE_GATE_MS`.

## Gate → Phase B

- hard-format fields (VIN, Kennzeichen, Stammnummer, Erstzulassung) **≥ 90 %** each,
- overall **≥ 70 %** of expected non-null fields,
- recognition **< 15 s** at 2560 px.

Exit code `0` = gate passed. The winning variant + PSM get baked into the app
engine in Phase B. Review results with the user before proceeding.

## Findings (4 real Schwyz cards, 2026-07-11)

**Winner: `gray·psm11`** (grayscale + normalize, PSM 11 sparse-text), ~2 s/card.

| | |
|---|---|
| Kennzeichen | 100% |
| Marke | 100% |
| Stammnummer / Versicherung / Halter-PLZ | 75% |
| VIN | 50% |
| Farbe / Modell | 50% |
| Erstzulassung | 25% |
| Halter name/street | ~0% (2-column layout jumbles OCR order) |

**Gate FAILED**: hard fields 63% (need 90%), overall ~49% (need 70%), speed 2 s ✓.

- Failures split by **photo quality**, not parser logic: well-shot cards (BMW,
  Peugeot, the Schaffhausen Mercedes) read 8–10/13 with hard fields near-perfect;
  poorer photos (Jeep, Ford) have fields Tesseract simply mangles — unrecoverable.
- **Preprocessing does not help.** Binarization, CLAHE, unsharp, and higher-DPI
  (3200 px) were all tested at PSM 3/4/6/11 — every one scored **below** plain
  `gray`. Aggressive filters destroy the faint typewriter strokes. The real lever
  is consistent, flat, well-lit input, which the shop controls.
- Conclusion: viable as a **privacy-preserving best-effort assist** (no key, no
  PII off-device, mandatory confirm-and-edit), **not** as a drop-in match for the
  cloud LLM's accuracy.
