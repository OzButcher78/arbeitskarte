// ============================================================================
// Unit tests for the offline OCR parser's Halter (owner) extraction.
// ----------------------------------------------------------------------------
// Driven by synthetic OcrWord[] — no Tesseract, no real photos, no PII, CI-safe.
// Run: `npm run test` (node:test via tsx). These lock in the region-restriction
// behaviour that fixes the 2-column Fahrzeugausweis jumble.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOcrWords, type OcrWord } from './parseOcrWords';

// Synthetic card geometry — Swiss Halter block sits top-left (see
// defaultRedactionBox); the vehicle column sits on the right.
const W = 1000;
const H = 700;

function word(text: string, x0: number, y0: number, conf = 85): OcrWord {
  const width = Math.max(12, text.length * 12);
  const height = 22;
  return { text, confidence: conf, bbox: { x0, y0, x1: x0 + width, y1: y0 + height } };
}

test('2-column jumble: region restriction yields a clean surname / Vorname / street', () => {
  const words: OcrWord[] = [
    word('Halter', 50, 40),
    // Halter block (left column)
    word('Muster', 55, 85), word('Hans', 170, 85),
    word('Musterweg', 55, 130), word('12', 230, 130),
    word('8840', 55, 175), word('Einsiedeln', 150, 175),
    // vehicle block (right column) — same y bands: would jumble reading order
    // if the columns were banded together. Region restriction drops them.
    word('BMW', 560, 85), word('X5', 560, 130), word('grau', 560, 175),
  ];
  const { fields } = parseOcrWords(words, W, H);
  assert.equal(fields.halterName, 'Muster');
  assert.equal(fields.halterVorname, 'Hans');
  assert.equal(fields.halterStrasse, 'Musterweg 12');
  assert.equal(fields.halterPlz, '8840');
  assert.equal(fields.halterOrt, 'Einsiedeln');
});

test('Swiss "Name, Vornamen" comma convention splits surname and given names', () => {
  const words: OcrWord[] = [
    word('Halter', 50, 40),
    word('Muster,', 55, 85), word('Hans', 175, 85), word('Peter', 250, 85),
    word('Dorfstrasse', 55, 130), word('5', 240, 130),
    word('6430', 55, 175), word('Schwyz', 145, 175),
  ];
  const { fields } = parseOcrWords(words, W, H);
  assert.equal(fields.halterName, 'Muster');
  assert.equal(fields.halterVorname, 'Hans Peter');
});

test('keyword-less street with a house number is captured ("Im Feld 3")', () => {
  const words: OcrWord[] = [
    word('Halter', 50, 40),
    word('Steiner', 55, 85), word('Anna', 175, 85),
    word('Im', 55, 130), word('Feld', 95, 130), word('3', 210, 130),
    word('6440', 55, 175), word('Brunnen', 145, 175),
  ];
  const { fields } = parseOcrWords(words, W, H);
  assert.equal(fields.halterStrasse, 'Im Feld 3');
  assert.equal(fields.halterName, 'Steiner');
  assert.equal(fields.halterVorname, 'Anna');
});

test('stray OCR fragment "Dt" is rejected as the surname (min 3 letters)', () => {
  const words: OcrWord[] = [
    word('Halter', 50, 40),
    word('Dt', 55, 85),
    word('6430', 55, 130), word('Schwyz', 145, 130),
  ];
  const { fields } = parseOcrWords(words, W, H);
  assert.equal(fields.halterName, null);
  assert.equal(fields.halterVorname, null);
  assert.equal(fields.halterPlz, '6430');
  assert.equal(fields.halterOrt, 'Schwyz');
});

test('trilingual label prefix + card number: reads name and street from the lines above the PLZ', () => {
  // Models a real-world card: the printed "Name, Vornamen" / "Wohnort" labels
  // sit to the LEFT of each value on the same row; a card number "123456" sits
  // above the name; birthdate + insurer sit below the PLZ line.
  const words: OcrWord[] = [
    word('123456', 380, 50),
    word('Name,', 40, 95), word('Vornamen', 100, 95), word('Bühler', 210, 95), word('Hans-Ueli', 300, 95),
    word('Wohnort', 40, 140), word('Rütimatt', 150, 140), word('5', 270, 140),
    word('6430', 150, 185), word('Schwyz', 230, 185),
    word('Geburtsdatum', 40, 245), word('01.01.1970', 210, 245),
    word('Zürich', 60, 300),
  ];
  const { fields } = parseOcrWords(words, W, H);
  assert.equal(fields.halterName, 'Bühler');
  assert.equal(fields.halterVorname, 'Hans-Ueli');
  assert.equal(fields.halterStrasse, 'Rütimatt 5');
  assert.equal(fields.halterPlz, '6430');
  assert.equal(fields.halterOrt, 'Schwyz');
});

test('OCR-split name across two bands (no street number read) rejoins as surname + Vorname, not street', () => {
  // Models fahrzeugausweis3: "Zürcher Beat" landed on two separate OCR bands
  // and the street line was not read with a number. The given name "Beat" must
  // NOT become the street.
  const words: OcrWord[] = [
    word('Zürcher', 60, 90),
    word('Beat', 60, 125),
    word('6417', 150, 205), word('Sattel', 230, 205),
  ];
  const { fields } = parseOcrWords(words, W, H);
  assert.equal(fields.halterName, 'Zürcher');
  assert.equal(fields.halterVorname, 'Beat');
  assert.equal(fields.halterStrasse, null);
  assert.equal(fields.halterPlz, '6417');
  assert.equal(fields.halterOrt, 'Sattel');
});

test('Typengenehmigung: the code right of its label, or on the row below it', () => {
  const sameRow: OcrWord[] = [word('24', 520, 300), word('Typengenehmigung', 560, 300), word('1VD653', 800, 300)];
  assert.equal(parseOcrWords(sameRow, W, H).fields.typengenehmigung, '1VD653');

  const below: OcrWord[] = [
    word('Typengenehmigung', 560, 300), word('Réception', 760, 300), word('par', 880, 300), word('type', 930, 300),
    word('1VD653', 580, 335),
  ];
  assert.equal(parseOcrWords(below, W, H).fields.typengenehmigung, '1VD653');
});

test('Typengenehmigung: no label → null, and a bare "24" house number is not an anchor', () => {
  const words: OcrWord[] = [
    word('Musterweg', 55, 130), word('24', 230, 130), word('BMW', 560, 130), word('320d', 640, 130),
    word('1VD653', 580, 400),
  ];
  assert.equal(parseOcrWords(words, W, H).fields.typengenehmigung, null);
});

test('garbage in the Halter region: a clean "6430 Schwyz" lower on the card still fills PLZ/Ort (whole-image fallback)', () => {
  const words: OcrWord[] = [
    word('Halter', 50, 40),
    word('Xy', 55, 85), // no strict name word in the region => region not usable
    word('6430', 55, 500), word('Schwyz', 145, 500), // below the Halter region box
  ];
  const { fields } = parseOcrWords(words, W, H);
  assert.equal(fields.halterPlz, '6430');
  assert.equal(fields.halterOrt, 'Schwyz');
  assert.equal(fields.halterName, null);
});
