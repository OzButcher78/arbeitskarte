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
    cell('Name', [r.vorname, r.name].filter(Boolean).join(' ')),
    cell('Strasse', r.strasse),
    cell('PLZ / Ort', r.plzOrt),
    cell('Telefon', r.telefon),
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

  // Bottom half of page 2: the Fahrzeugausweis + any job photos. When both are
  // present the ausweis is shrunk (`with-photos`) so the media still fits the
  // lower half beside the photo grid.
  const hasPhotos = photoDataUrls.length > 0;
  const photos = hasPhotos
    ? `<h3 class="sec">Fotos</h3><div class="photos">${photoDataUrls.map((u) => `<img src="${u}" alt="">`).join('')}</div>`
    : '';
  const ausweis = ausweisDataUrl
    ? `<h3 class="sec">Fahrzeugausweis</h3><img class="ausweis${hasPhotos ? ' with-photos' : ''}" src="${ausweisDataUrl}" alt="Fahrzeugausweis">`
    : '';
  const media = ausweis || photos ? `<div class="media-half">${ausweis}${photos}</div>` : '';

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Arbeitskarte ${esc(r.jobNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .letterhead { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 2px solid #0f172a; padding-bottom: 5px; }
  .letterhead .name { font-size: 14px; font-weight: 700; }
  .letterhead img { max-height: 34px; max-width: 130px; object-fit: contain; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; margin: 9px 0 10px; }
  .meta-l .title { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
  .meta-l .nr { font-size: 14px; font-weight: 600; color: #2563eb; margin-bottom: 5px; }
  .slot { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; }
  .slot .k { color: #64748b; font-weight: 600; white-space: nowrap; min-width: 96px; }
  .slot .v { flex: 1; font-weight: 500; border-bottom: 1px solid #cbd5e1; min-height: 15px; }
  .statusrow { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin: 8px 0 0; }
  .statusrow .sb-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; font-weight: 600; }
  .statusrow .st { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 500; color: #334155; }
  .statusrow .box { width: 12px; height: 12px; border: 1.25px solid #64748b; border-radius: 2.5px; box-sizing: border-box; flex-shrink: 0; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .box h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  .cell { display: flex; gap: 6px; padding: 1.5px 0; }
  .cell .lbl { color: #64748b; min-width: 92px; flex-shrink: 0; }
  .cell .val { font-weight: 500; }
  /* The sheet is folded across its centre — keep the top block filling the
     upper half so the damage map begins just below the fold line.
     Fold = A4 centre 148.5mm − 14mm @page margin = 134.5mm of content. */
  .top-half { min-height: 135mm; }
  /* Page-1 bottom half: one big damage map, centred. */
  .schaden-full { margin-top: 4mm; }
  .carmap-big { text-align: center; margin: 3mm 0; }
  .carmap-big svg { width: 140mm; max-width: 100%; height: auto; display: inline-block; }
  /* Car map stays centred (.carmap-big); the parts title + text align left. */
  .parts { font-size: 11px; margin-top: 4px; text-align: left; }
  .parts .heading { color: #64748b; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; margin-bottom: 3px; }
  .parts .list { font-weight: 600; }
  .parts .notiz { margin-top: 6px; white-space: pre-wrap; }
  table.arb { width: 100%; border-collapse: collapse; }
  table.arb th { text-align: left; vertical-align: top; color: #64748b; font-weight: 600; width: 150px; padding: 9px 8px 9px 0; border-bottom: 1px solid #cbd5e1; }
  table.arb td { vertical-align: top; padding: 9px 0; border-bottom: 1px solid #cbd5e1; }
  table.arb td .wl { display: block; height: 34px; }
  h3.sec { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  .page2 { break-before: page; page-break-before: always; }
  /* Page-2 top half: Arbeiten/Material; min-height pushes the media below the fold. */
  .arb-half { min-height: 135mm; }
  .ausweis { max-width: 100%; max-height: 116mm; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; margin-bottom: 10px; }
  .ausweis.with-photos { max-height: 78mm; }
  .photos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .photos img { width: 100%; height: 82px; object-fit: cover; border: 1px solid #cbd5e1; border-radius: 4px; }
</style></head>
<body>
  <div class="top-half">
  <div class="letterhead">
    <div class="name">${esc(w.name)}</div>
    ${w.logoDataUrl ? `<img src="${esc(w.logoDataUrl)}" alt="">` : ''}
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
      <div class="statusrow"><span class="sb-label">Status</span>${statusChecklist()}</div>
    </div>
  </div>

  <div class="cols">
    <div class="box"><h3>Kunde / Halter</h3>${kunde || '<div class="cell"><span class="val">—</span></div>'}</div>
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
    <div class="arb-half">
      <h3 class="sec">Arbeiten / Material</h3>
      <table class="arb">${arbeiten}</table>
    </div>
    ${media}
  </div>
</body></html>`;
}
