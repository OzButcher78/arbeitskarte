// ============================================================================
// Native HTML printing on Android via the PrinterPlugin (Android Print Framework).
// ----------------------------------------------------------------------------
// The Android WebView's own window.print() is a no-op, so the browser fallback
// showed no preview and trapped the user. This routes print to the OS print
// dialog (printer picker + "Als PDF speichern"). No-op elsewhere.
// ============================================================================

import { registerPlugin } from '@capacitor/core';
import { isAndroid } from './detect';

interface PrinterPlugin {
  printHtml(options: { html: string; jobName?: string }): Promise<void>;
}

const Printer = registerPlugin<PrinterPlugin>('Printer');

/** True where native system printing is available. */
export function canNativePrint(): boolean {
  return isAndroid();
}

/** Hand self-contained HTML to the Android system print dialog. */
export async function nativePrintHtml(html: string, jobName?: string): Promise<void> {
  console.log('[AKPrint] nativePrintHtml invoked, html length =', html.length);
  try {
    await Printer.printHtml({ html, jobName: jobName || 'Arbeitskarte' });
    console.log('[AKPrint] Printer.printHtml resolved');
  } catch (e) {
    console.error('[AKPrint] Printer.printHtml rejected:', e);
    throw e;
  }
}
