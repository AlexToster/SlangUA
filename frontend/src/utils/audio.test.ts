import { blobToBase64 } from './audio';

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

describe('blobToBase64', () => {
  it('encodes bytes exactly, padding included', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);

    const encoded = await blobToBase64(new Blob([bytes]));

    expect(encoded).toBe('AAEC+v8=');
    expect(decode(encoded)).toEqual(bytes);
  });

  it('encodes a blob larger than one chunk byte-for-byte', async () => {
    // Bigger than the internal chunk and than the ~64k argument ceiling that
    // `String.fromCharCode(...bytes)` would hit, so this is the case a naive
    // implementation fails on - and the only case a real recording produces.
    const bytes = new Uint8Array(200_000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;

    const encoded = await blobToBase64(new Blob([bytes]));

    expect(encoded).toHaveLength(Math.ceil(bytes.length / 3) * 4);
    expect(decode(encoded)).toEqual(bytes);
  });

  it('encodes an empty blob as an empty string', async () => {
    expect(await blobToBase64(new Blob([]))).toBe('');
  });
});
