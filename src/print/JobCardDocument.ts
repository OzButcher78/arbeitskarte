// ============================================================================
// JobCardDocument — render a JobCardRecord as a self-contained A4 print page
// (inline CSS + inline base64 images + inline car-map SVG). Fed to the print
// router (printToPDF on Electron, system WebView print on Android/browser).
// German-only, so labels are hardcoded here.
//
// Layout mirrors the shop's original paper Auftragskarte, kept to one physical
// sheet (double-sided) that is folded in half:
//   • Page 1: slim letterhead, title + Ersatzwagen (L) / dates + Schlüssel-Code
//     (R), status, Kunde / Halter (+ Garage) and Fahrzeug boxes (top half);
//     two ruled Notiz lines and a centred damage map (bottom half).
//   • Page 2 (back): Arbeiten/Material (top half), then the scanned
//     Fahrzeugausweis + any job photos (bottom half).
//   • Fold band: nothing prints within 10mm of the A4 centre line on either
//     side, so the hand-folded card never creases through text.
// ============================================================================

import type { JobCardRecord, WorkshopIdentity } from '../types/jobcard';
import { carMapSvgString } from '../carmap/svgString';
import { panelLabel } from '../carmap/panels';

export interface JobCardDocInput {
  record: JobCardRecord;
  workshop: WorkshopIdentity;
  /** Additional job photos as base64 data URLs (already inlined). */
  photoDataUrls: string[];
  /** The scanned Fahrzeugausweis photo as a base64 data URL (if captured). */
  ausweisDataUrl?: string;
  /** Formatted creation date for the footer. */
  createdLabel: string;
}

const STATUS_LABEL: Record<JobCardRecord['status'], string> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  erledigt: 'Erledigt',
  archiviert: 'Archiviert',
};

// 'archiviert' is a digital filing state — not printed on the physical card.
const PRINT_STATUS_ORDER: JobCardRecord['status'][] = ['offen', 'in_arbeit', 'erledigt'];

/** The printable statuses as EMPTY tickable boxes — the shop marks the current
 *  one by hand. (The app itself shows/edits the real status.) */
function statusChecklist(): string {
  return PRINT_STATUS_ORDER.map(
    (s) => `<span class="st"><span class="box"></span>${esc(STATUS_LABEL[s])}</span>`,
  ).join('');
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** A labelled value cell, or '' when the value is empty. */
function cell(label: string, value: unknown): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  return `<div class="cell"><span class="lbl">${esc(label)}</span><span class="val">${esc(v)}</span></div>`;
}

/** A header fill-in slot — ALWAYS rendered; an empty value leaves an underlined
 *  blank to write on (matches the pre-printed fields of the paper card). */
function slot(label: string, value: unknown): string {
  const v = String(value ?? '').trim();
  return `<div class="slot"><span class="k">${esc(label)}</span><span class="v">${v ? esc(v) : ''}</span></div>`;
}

/** Running header for pages 2+. Loose sheets end up spread over a workbench, so
 *  every page after the first has to identify itself; page 1 already carries the
 *  number in its letterhead block and is left untouched. */
function pageHead(r: JobCardRecord, page: number, total: number): string {
  const kunde = String(r.firma || '').trim() || [r.vorname, r.name].filter(Boolean).join(' ').trim();
  const left = [
    r.jobNumber ? `Arbeitskarte Nr. ${r.jobNumber}` : 'Arbeitskarte',
    kunde,
    String(r.kontrollschild || '').trim(),
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  return `<div class="pagehead"><span>${left}</span><span>Seite ${page} / ${total}</span></div>`;
}

/** Front-page Notiz: ruled lines at the top of the bottom half (just under the
 *  fold) to write on. Typed Bemerkungen (`notes`) print on the lines; at least
 *  NOTIZ_LINES are always rendered so there is room left to write by hand. */
const NOTIZ_LINES = 2;
function notizLines(notes: unknown): string {
  const typed = String(notes ?? '').trim();
  const lines = typed ? typed.split('\n') : [];
  while (lines.length < NOTIZ_LINES) lines.push('');
  return lines.map((l) => `<div class="wl">${esc(l)}</div>`).join('');
}

/** A free-text Arbeiten row. Always rendered — an empty value leaves a blank
 *  writing line so the card can still be filled in by hand. */
function workRow(label: string, value: unknown): string {
  const v = String(value ?? '').trim();
  const content = v ? esc(v).replace(/\n/g, '<br>') : '<span class="wl"></span>';
  return `<tr><th>${esc(label)}</th><td>${content}</td></tr>`;
}

export function buildJobCardHtml(input: JobCardDocInput): string {
  const { record: r, workshop: w, photoDataUrls, ausweisDataUrl, createdLabel } = input;

  const damaged = r.damagedParts.map(panelLabel).join(', ');
  const carMap = carMapSvgString(new Set(r.damagedParts), r.damageStrokes ?? []);

  const kunde = [
    cell('Firma', r.firma),
    cell('Name', [r.vorname, r.name].filter(Boolean).join(' ')),
    cell('Strasse', r.strasse),
    cell('PLZ / Ort', r.plzOrt),
    cell('Telefon', r.telefon),
    cell('Telefon 2', r.telefon2),
    cell('Notiz', r.kundeNotiz),
  ].join('');

  // Einliefernde Garage — printed as its own titled block under the Halter.
  const garageCells = [
    cell('Firma', r.garageName),
    cell('Strasse', r.garageStrasse),
    cell('PLZ / Ort', r.garagePlzOrt),
    cell('Telefon', r.garageTelefon),
    cell('E-Mail', r.garageEmail),
  ].join('');
  const garage = garageCells ? `<div class="sub"><h3>Garage</h3>${garageCells}</div>` : '';

  const fahrzeug = [
    cell('Marke', r.fahrzeugmarke),
    cell('Modell / Typ', r.fahrzeugtyp),
    cell('Kennzeichen', r.kontrollschild),
    cell('Fahrgestell-Nr.', r.vin),
    cell('Stammnummer', r.stammnummer),
    cell('Typengenehmigung', r.typengenehmigung),
    cell('Farbe', r.farbe),
    cell('Erstzulassung', r.erstzulassung),
    cell('Kilometerstand', r.kilometerstand),
    cell('Versicherung', r.versicherung),
    cell('Schaden-Nr.', r.schadenNr),
  ].join('');

  // Back-of-card work/material lines — always shown with a writing line.
  const arbeiten = [
    workRow('Spenglerarbeit', r.spenglerarbeit),
    workRow('Ersatzteile / Kleinmat.', r.ersatzteileKleinmat),
    workRow('Lackierarbeit', r.lackierarbeit),
    workRow('Lackmaterial', r.lackmaterial),
    workRow('Kittsatz', r.kittsatz),
    workRow('Nebenarbeiten', r.nebenarbeiten),
    workRow('Schneidfaden', r.schneidfaden),
    workRow('Ersatzwagen', r.arbeitenErsatzwagen),
  ].join('');

  // Bottom half of page 2: the Fahrzeugausweis (photos moved to their own pages).
  const ausweis = ausweisDataUrl
    ? `<h3 class="sec">Fahrzeugausweis</h3><div class="ausweis-box"><img class="ausweis" src="${ausweisDataUrl}" alt="Fahrzeugausweis"></div>`
    : '';
  const media = ausweis ? `<div class="media-half">${ausweis}</div>` : '';

  // Page 3 onward: attached job photos, two per page (large, portrait-stacked).
  // Page 2 always exists, so the total is known up front — no CSS counter needed.
  const photoPageCount = Math.ceil(photoDataUrls.length / 2);
  const totalPages = 2 + photoPageCount;

  const photoPages: string[] = [];
  for (let i = 0; i < photoDataUrls.length; i += 2) {
    const pair = photoDataUrls.slice(i, i + 2);
    photoPages.push(
      `<div class="photo-page">${pageHead(r, 3 + i / 2, totalPages)}<h3 class="sec">Fotos</h3><div class="photo-grid">${pair
        .map((u) => `<div class="photo-cell"><img src="${u}" alt=""></div>`)
        .join('')}</div></div>`,
    );
  }
  const photos = photoPages.join('');

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Arbeitskarte ${esc(r.jobNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  /* All text pure black (shop request) — structure lines a neutral dark gray. */
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #000; font-size: 14px; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .letterhead { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 3px; }
  .letterhead .name { font-size: 16px; font-weight: 700; }
  .letterhead img { max-height: 34px; max-width: 240px; object-fit: contain; }
  /* Vertical spacing in the header + Kunde/Fahrzeug boxes is kept tight (font
     sizes untouched) so the Notiz lines still fit above the fold. */
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; margin: 4px 0 6px; }
  .meta-l .title { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
  .meta-l .nr { font-size: 16px; font-weight: 700; color: #000; margin: 5px 0 10px; }
  .slot { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; }
  .slot .k { color: #000; font-weight: 600; white-space: nowrap; min-width: 112px; }
  .slot .v { flex: 1; font-weight: 700; border-bottom: 1px solid #666; min-height: 19px; }
  .statusrow { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin: 4px 0 0; }
  .statusrow .st { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 500; color: #000; }
  .statusrow .box { width: 15px; height: 15px; border: 1.5px solid #000; border-radius: 3px; box-sizing: border-box; flex-shrink: 0; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .box { border: 1px solid #666; border-radius: 6px; padding: 10px 13px; }
  .box h3 { margin: 0 0 3px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #000; }
  .cols .box { padding: 6px 11px; }
  .cell { display: flex; gap: 8px; padding: 1px 0; line-height: 1.2; }
  /* Wide enough for "Typengenehmigung" so every Fahrzeug value lines up. */
  .cell .lbl { color: #000; min-width: 128px; flex-shrink: 0; }
  .cell .val { font-weight: 700; }
  /* Kunde / Halter: pull the bold value column a little further left. */
  .box.kunde .cell .lbl { min-width: 84px; }
  /* Garage block under the Halter lines, inside the same box. */
  .box .sub { margin-top: 5px; padding-top: 4px; border-top: 1px solid #bbb; }
  .box .sub h3 { margin-bottom: 2px; }
  /* ── Fold band ──────────────────────────────────────────────────────────
     The A4 fold is at 148.5mm on paper = 134.5mm below the 14mm top margin.
     The card is folded by hand, so a 10mm band on EACH side of the fold is
     kept empty: page-1's top block ends by 124.5mm and the bottom block
     starts at 144.5mm. Page 1 is a fixed-height column (269mm printable
     minus slack) so the bottom block can never spill onto a new sheet: the
     damage map simply takes whatever height is left. */
  .page1 { height: 264mm; display: flex; flex-direction: column; }
  .top-half { flex: none; min-height: 124.5mm; }
  .bottom-half { flex: 1 1 0; min-height: 0; margin-top: 20mm; display: flex; flex-direction: column; }
  /* Notiz: two ruled lines right under the fold band. */
  .notiz-lines { flex: none; margin-bottom: 3mm; }
  .notiz-lines .heading { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .notiz-lines .wl { min-height: 6.5mm; border-bottom: 1px solid #666; display: flex; align-items: flex-end; padding-bottom: 1mm; font-weight: 700; white-space: pre-wrap; }
  /* Damage section fills the rest of the bottom half; the map scales to the
     height left over after the heading, the parts list and the Schaden-Notiz. */
  .schaden-full { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
  .schaden-full h3.sec { flex: none; }
  .carmap-big { flex: 1 1 0; min-height: 0; text-align: center; margin: 1mm 0; }
  .carmap-big svg { height: 100%; width: auto; max-width: 100%; display: inline-block; }
  /* Car map stays centred (.carmap-big); the parts title + text align left. */
  .parts { flex: none; font-size: 11px; margin-top: 4px; text-align: left; }
  .parts .heading { color: #000; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; margin-bottom: 3px; }
  .parts .list { font-weight: 600; }
  .parts .notiz { margin-top: 6px; white-space: pre-wrap; }
  /* Back page: bigger labels. Bemerkungen live on the front Notiz lines, so 8
     rows of ~13mm — together with the running header + heading they end at
     ~119mm, inside the 124.5mm fold-band limit. */
  table.arb { width: 100%; border-collapse: collapse; }
  table.arb th { text-align: left; vertical-align: top; color: #000; font-weight: 600; width: 175px; padding: 7px 8px 7px 0; border-bottom: 1px solid #666; }
  table.arb td { vertical-align: top; font-weight: 700; padding: 7px 0; border-bottom: 1px solid #666; }
  table.arb td .wl { display: block; height: 34px; }
  h3.sec { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #000; border-bottom: 1px solid #666; padding-bottom: 3px; }
  .page2 { break-before: page; page-break-before: always; }
  /* Running header on pages 2+ so a loose sheet can still be traced back to its
     card. Reserves ~8.5mm, which is taken off .arb-half below. */
  .pagehead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 11px; color: #444; border-bottom: 1px solid #999; padding-bottom: 3px; margin-bottom: 4mm; }
  /* Page-2 top half: Arbeiten/Material. Running header (~8.8mm) + 136mm puts
     the media at ~144.8mm — the far edge of the fold band. */
  .arb-half { min-height: 136mm; flex: none; }
  /* With an Ausweis, page 2 is a fixed-height column (269mm printable, minus
     slack) and the scan takes exactly the space left under Arbeiten. Fixed mm
     budgets spilled it onto a third sheet whenever the rows or the crop's
     aspect came out a few mm taller than planned. */
  .page2.has-ausweis { display: flex; flex-direction: column; height: 264mm; }
  .page2.has-ausweis .pagehead { flex: none; }
  .media-half { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
  .media-half h3.sec { flex: none; }
  .ausweis-box { flex: 1 1 0; min-height: 0; }
  .ausweis { display: block; margin: 0 auto; max-width: 100%; max-height: 100%; border: 1px solid #cbd5e1; border-radius: 4px; }
  /* Page 3+: two attached photos per page, stacked and large. */
  .photo-page { break-before: page; page-break-before: always; }
  .photo-grid { display: flex; flex-direction: column; gap: 8mm; }
  .photo-cell { text-align: center; }
  .photo-cell img { max-width: 100%; max-height: 118mm; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
</style></head>
<body>
  <div class="page1">
  <div class="top-half">
  <div class="letterhead">
    <div class="name">${esc(w.name)}</div>
    ${w.logoDataUrl ? `<img src="${esc(w.logoDataUrl)}" alt="" style="max-height:${Number(w.logoHeightPx) || 34}px">` : ''}
  </div>

  <div class="meta">
    <div class="meta-l">
      <div class="title">Arbeitskarte</div>
      ${r.jobNumber ? `<div class="nr">Nr. ${esc(r.jobNumber)}</div>` : ''}
      ${slot('Ersatzwagen', r.ersatzwagenKopf)}
      ${slot('Automat', r.automat ? 'Ja' : '')}
    </div>
    <div class="meta-r">
      ${slot('Erstellt', createdLabel)}
      ${slot('Rep.-Datum', r.repDatum)}
      ${slot('Abholdatum', r.abholdatum)}
      ${slot('Schlüssel-Code', r.schluesselCode)}
      <div class="statusrow">${statusChecklist()}</div>
    </div>
  </div>

  <div class="cols">
    <div class="box kunde"><h3>Kunde / Halter</h3>${kunde || '<div class="cell"><span class="val">—</span></div>'}${garage}</div>
    <div class="box"><h3>Fahrzeug</h3>${fahrzeug || '<div class="cell"><span class="val">—</span></div>'}</div>
  </div>
  </div>

  <div class="bottom-half">
  <div class="notiz-lines">
    <div class="heading">Notiz</div>
    ${notizLines(r.notes)}
  </div>

  <div class="schaden-full">
    <h3 class="sec">Schaden</h3>
    <div class="carmap-big">${carMap}</div>
    <div class="parts">
      <div class="heading">Beschädigte Teile</div>
      <div class="list">${damaged ? esc(damaged) : '—'}</div>
      ${r.schadenNotiz ? `<div class="notiz">${esc(r.schadenNotiz)}</div>` : ''}
    </div>
  </div>
  </div>
  </div>

  <div class="page2${media ? ' has-ausweis' : ''}">
    ${pageHead(r, 2, totalPages)}
    <div class="arb-half">
      <h3 class="sec">Arbeiten / Material</h3>
      <table class="arb">${arbeiten}</table>
    </div>
    ${media}
  </div>
  ${photos}
</body></html>`;
}
