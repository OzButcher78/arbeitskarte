/** Convert a `data:` URL to a Blob. `fetch` on a data URL works in the browser,
 *  Electron renderer, and the Android WebView alike. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Read a Blob as a `data:` URL (for rendering a stored blob in an <img>). */
export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
