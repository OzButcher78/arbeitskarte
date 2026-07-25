// ============================================================================
// JobCardDocument — render a JobCardRecord as a self-contained A4 print page
// (inline CSS + inline base64 images + inline car-map SVG). Fed to the print
// router (printToPDF on Electron, system WebView print on Android/browser).
// German-only, so labels are hardcoded here.
//
// Layout mirrors the shop's original paper Auftragskarte, kept to one physical
// sheet (double-sided):
//   • Page 1: slim letterhead, title + Ersatzwagen (L) / dates + Schlüssel-Code
//     (R), status, Kunde / Fahrzeug (top half), then a large centred damage map
//     filling the bottom half.
//   • Page 2 (back): Arbeiten/Material (top half), then the scanned
//     Fahrzeugausweis + any job photos (bottom half).
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

  const fahrzeug = [
    cell('Marke', r.fahrzeugmarke),
    cell('Modell / Typ', r.fahrzeugtyp),
    cell('Kennzeichen', r.kontrollschild),
    cell('Fahrgestell-Nr.', r.vin),
    cell('Stammnummer', r.stammnummer),
    cell('Farbe', r.farbe),
    cell('Erstzulassung', r.erstzulassung),
    cell('Kilometerstand', r.kilometerstand),
    cell('Versicherung', r.versicherung),
    cell('Schaden-Nr.', r.schadenNr),
    cell('Ersatzteile', r.ersatzteileJa ? (r.ersatzteileText || 'Ja') : ''),
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
    workRow('Bemerkungen', r.notes),
  ].join('');

  // Bottom half of page 2: the Fahrzeugausweis (photos moved to their own pages).
  const ausweis = ausweisDataUrl
    ? `<h3 class="sec">Fahrzeugausweis</h3><img class="ausweis" src="${ausweisDataUrl}" alt="Fahrzeugausweis">`
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
  .letterhead { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 5px; }
  .letterhead .name { font-size: 16px; font-weight: 700; }
  .letterhead img { max-height: 34px; max-width: 240px; object-fit: contain; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; margin: 10px 0 10px; }
  .meta-l .title { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
  .meta-l .nr { font-size: 16px; font-weight: 700; color: #000; margin: 5px 0 10px; }
  .slot { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; }
  .slot .k { color: #000; font-weight: 600; white-space: nowrap; min-width: 112px; }
  .slot .v { flex: 1; font-weight: 700; border-bottom: 1px solid #666; min-height: 19px; }
  .statusrow { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin: 8px 0 0; }
  .statusrow .st { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 500; color: #000; }
  .statusrow .box { width: 15px; height: 15px; border: 1.5px solid #000; border-radius: 3px; box-sizing: border-box; flex-shrink: 0; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .box { border: 1px solid #666; border-radius: 6px; padding: 10px 13px; }
  .box h3 { margin: 0 0 7px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #000; }
  .cell { display: flex; gap: 8px; padding: 2px 0; }
  .cell .lbl { color: #000; min-width: 112px; flex-shrink: 0; }
  .cell .val { font-weight: 700; }
  /* Kunde / Halter: pull the bold value column a little further left. */
  .box.kunde .cell .lbl { min-width: 84px; }
  /* The top block fills the upper part of page 1; kept short enough that the
     damage map + beschädigte Teile + Schaden-Notiz all still fit on this one
     sheet (the Notiz used to spill onto a near-empty page 2). */
  .top-half { min-height: 120mm; }
  /* Page-1 bottom half: one big damage map, centred. */
  .schaden-full { margin-top: 2mm; }
  .carmap-big { text-align: center; margin: 2mm 0; }
  .carmap-big svg { width: 134mm; max-width: 100%; height: auto; display: inline-block; }
  /* Car map stays centred (.carmap-big); the parts title + text align left. */
  /* Bottom half of page 1 (map + parts): sizes frozen per the shop — only the
     text colour goes black here. */
  .parts { font-size: 11px; margin-top: 4px; text-align: left; }
  .parts .heading { color: #000; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; margin-bottom: 3px; }
  .parts .list { font-weight: 600; }
  .parts .notiz { margin-top: 6px; white-space: pre-wrap; }
  /* Back page: bigger labels; row height unchanged (taller line, less padding)
     so the 9 rows still fill exactly the top half above the fold. */
  table.arb { width: 100%; border-collapse: collapse; }
  table.arb th { text-align: left; vertical-align: top; color: #000; font-weight: 600; width: 175px; padding: 8px 8px 8px 0; border-bottom: 1px solid #666; }
  table.arb td { vertical-align: top; font-weight: 700; padding: 8px 0; border-bottom: 1px solid #666; }
  table.arb td .wl { display: block; height: 36px; }
  h3.sec { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #000; border-bottom: 1px solid #666; padding-bottom: 3px; }
  .page2 { break-before: page; page-break-before: always; }
  /* Running header on pages 2+ so a loose sheet can still be traced back to its
     card. Reserves ~8.5mm, which is taken off .arb-half below. */
  .pagehead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 11px; color: #444; border-bottom: 1px solid #999; padding-bottom: 3px; margin-bottom: 4mm; }
  /* Page-2 top half: Arbeiten/Material; min-height pushes the media below the
     fold. Reduced from 135mm by the height of .pagehead so the Ausweis stays on
     page 2 instead of spilling onto a third sheet. */
  .arb-half { min-height: 126mm; }
  /* Keep the Ausweis heading with its image. */
  .media-half { break-inside: avoid; page-break-inside: avoid; }
  /* Fill the whole bottom half of page 2 with the scanned Ausweis. */
  .ausweis { width: 100%; max-width: 100%; max-height: 126mm; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; margin-bottom: 0; }
  /* Page 3+: two attached photos per page, stacked and large. */
  .photo-page { break-before: page; page-break-before: always; }
  .photo-grid { display: flex; flex-direction: column; gap: 8mm; }
  .photo-cell { text-align: center; }
  .photo-cell img { max-width: 100%; max-height: 118mm; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
</style></head>
<body>
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
    <div class="box kunde"><h3>Kunde / Halter</h3>${kunde || '<div class="cell"><span class="val">—</span></div>'}</div>
    <div class="box"><h3>Fahrzeug</h3>${fahrzeug || '<div class="cell"><span class="val">—</span></div>'}</div>
  </div>
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

  <div class="page2">
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
