/**
 * Coerce a `Uint8Array` to `BufferSource` for the DOM byte APIs
 * (`crypto.subtle.digest`, `new Blob([...])`, `new Response(...)`).
 *
 * TS 5.7 made the typed-array types generic over their backing buffer
 * (`Uint8Array<ArrayBufferLike>`), and `ArrayBufferLike` includes
 * `SharedArrayBuffer`. The DOM lib's `BufferSource` / `BlobPart` / `BodyInit`
 * expect a non-shared (`ArrayBuffer`-backed) view, so a plain `Uint8Array`
 * value is no longer assignable. Every byte buffer we pass here comes from
 * ArrayBuffer-backed reads, never a SharedArrayBuffer, so this is purely a
 * type-layer coercion with no runtime effect.
 */
export function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}
