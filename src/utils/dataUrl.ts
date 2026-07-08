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

/** Read a Blob as a base64 `data:` URL — needed to INLINE images into print
 *  HTML (object URLs don't resolve in the offscreen printToPDF window). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}
