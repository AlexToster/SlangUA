/** Chunk size for the base64 walk below. Any power of two under ~64k works. */
const CHUNK_BYTES = 0x8000;

/**
 * Encode a recorded clip as base64 for `POST /transcribe`, which takes the audio
 * inside a JSON body rather than as multipart.
 *
 * The loop is not an optimization but a correctness fix: the obvious
 * `String.fromCharCode(...bytes)` spreads one argument per byte and overflows
 * the call stack somewhere in the tens of thousands - which a 30-second Opus
 * capture (~120 KB) clears easily, so it would fail only on real recordings and
 * never on a short test clip.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_BYTES));
  }

  return btoa(binary);
}
