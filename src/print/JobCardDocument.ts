// ============================================================================
// JobCardDocument — render a JobCardRecord as a self-contained A4 print page
// (inline CSS + inline base64 images + inline car-map SVG). Fed to the print
// router (printToPDF on Electron, system WebView print on Android/browser).
// German-only, so labels are hardcoded here.
// ============================================================================

import type { JobCardRecord, WorkshopIdentity } from '../types/jobcard';
import { carMapSvgString } from '../carmap/svgString';
import { regionLabel } from '../carmap/regions';

export interface JobCardDocInput {
  record: JobCardRecord;
  workshop: WorkshopIdentity;
  /** Additional job photos as base64 data URLs (already inlined). */
  photoDataUrls: string[];
  /** Formatted creation date for the footer. */
  createdLabel: string;
}

const STATUS_LABEL: Record<JobCardRecord['status'], string> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  erledigt: 'Erledigt',
  archiviert: 'Archiviert',
};

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

/** A free-text Arbeiten row, or '' when empty. */
function workRow(label: string, value: unknown): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  return `<tr><th>${esc(label)}</th><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`;
}

export function buildJobCardHtml(input: JobCardDocInput): string {
  const { record: r, workshop: w, photoDataUrls, createdLabel } = input;

  const damaged = r.damagedParts.map(regionLabel).join(', ');
  const carMap = carMapSvgString(new Set(r.damagedParts));

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
  ].join('');

  const kopf = [
    cell('Rep.-Datum', r.repDatum),
    cell('Abholdatum', r.abholdatum),
    cell('Schlüssel-Code', r.schluesselCode),
    cell('Ersatzwagen', r.ersatzwagenKopf),
    cell('Automat', r.automat ? 'Ja' : ''),
    cell('Ersatzteile', r.ersatzteileJa ? (r.ersatzteileText || 'Ja') : ''),
  ].join('');

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

  const photos = photoDataUrls.length
    ? `<div class="section"><h3>Fotos</h3><div class="photos">${photoDataUrls
        .map((u) => `<img src="${u}" alt="">`)
        .join('')}</div></div>`
    : '';

  const contactLine = [w.telefon, w.email, w.website].filter(Boolean).map(esc).join(' · ');

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Arbeitskarte ${esc(r.jobNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
  .shop { display: flex; gap: 12px; align-items: center; }
  .shop img { max-height: 46px; max-width: 150px; object-fit: contain; }
  .shop .name { font-size: 15px; font-weight: 700; }
  .shop .addr { color: #475569; font-size: 10px; line-height: 1.4; }
  .doc { text-align: right; }
  .doc .title { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
  .doc .nr { font-size: 15px; font-weight: 600; color: #2563eb; }
  .doc .status { display: inline-block; margin-top: 3px; padding: 1px 8px; border-radius: 999px; background: #e2e8f0; font-size: 10px; font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .box h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  .cell { display: flex; gap: 6px; padding: 1.5px 0; }
  .cell .lbl { color: #64748b; min-width: 92px; flex-shrink: 0; }
  .cell .val { font-weight: 500; }
  .section { margin-top: 10px; }
  .schaden { display: grid; grid-template-columns: 200px 1fr; gap: 12px; align-items: start; }
  .schaden svg { width: 200px; }
  .schaden .parts { font-size: 11px; }
  .schaden .parts .heading { color: #64748b; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; margin-bottom: 4px; }
  .schaden .parts .list { font-weight: 600; }
  .schaden .parts .notiz { margin-top: 8px; white-space: pre-wrap; }
  table.arb { width: 100%; border-collapse: collapse; }
  table.arb th { text-align: left; vertical-align: top; color: #64748b; font-weight: 600; width: 150px; padding: 3px 8px 3px 0; border-bottom: 1px solid #e2e8f0; }
  table.arb td { vertical-align: top; padding: 3px 0; border-bottom: 1px solid #e2e8f0; }
  h3.sec { margin: 12px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  .photos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .photos img { width: 100%; height: 90px; object-fit: cover; border: 1px solid #cbd5e1; border-radius: 4px; }
  .foot { margin-top: 14px; color: #94a3b8; font-size: 9px; text-align: right; }
</style></head>
<body>
  <div class="head">
    <div class="shop">
      ${w.logoDataUrl ? `<img src="${esc(w.logoDataUrl)}" alt="">` : ''}
      <div>
        <div class="name">${esc(w.name)}</div>
        <div class="addr">${esc(w.strasse)}${w.strasse ? ', ' : ''}${esc(w.plzOrt)}${contactLine ? `<br>${contactLine}` : ''}</div>
      </div>
    </div>
    <div class="doc">
      <div class="title">Arbeitskarte</div>
      ${r.jobNumber ? `<div class="nr">${esc(r.jobNumber)}</div>` : ''}
      <div class="status">${esc(STATUS_LABEL[r.status])}</div>
    </div>
  </div>

  <div class="cols">
    <div class="box"><h3>Kunde / Halter</h3>${kunde || '<div class="cell"><span class="val">—</span></div>'}</div>
    <div class="box"><h3>Fahrzeug</h3>${fahrzeug || '<div class="cell"><span class="val">—</span></div>'}</div>
  </div>

  ${kopf ? `<div class="section"><div class="box"><h3>Auftrag</h3><div class="cols">${kopf}</div></div></div>` : ''}

  <div class="section">
    <div class="box">
      <h3>Schaden</h3>
      <div class="schaden">
        <div>${carMap}</div>
        <div class="parts">
          <div class="heading">Beschädigte Teile</div>
          <div class="list">${damaged ? esc(damaged) : '—'}</div>
          ${r.schadenNotiz ? `<div class="notiz">${esc(r.schadenNotiz)}</div>` : ''}
        </div>
      </div>
    </div>
  </div>

  ${arbeiten ? `<h3 class="sec">Arbeiten / Material</h3><table class="arb">${arbeiten}</table>` : ''}

  ${photos}

  <div class="foot">Erstellt: ${esc(createdLabel)}</div>
</body></html>`;
}
