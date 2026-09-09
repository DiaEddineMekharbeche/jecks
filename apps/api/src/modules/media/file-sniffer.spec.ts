import { describe, expect, it } from 'vitest';
import { isScriptableImage, sniffFileType } from './file-sniffer.js';

/** Builds a buffer from byte values, padded so every signature has room to read. */
function bytes(...values: number[]): Buffer {
  const buffer = Buffer.alloc(64);
  Buffer.from(values).copy(buffer);
  return buffer;
}

function ascii(text: string, at = 0): Buffer {
  const buffer = Buffer.alloc(64);
  buffer.write(text, at, 'ascii');
  return buffer;
}

describe('sniffFileType', () => {
  it('detects JPEG', () => {
    expect(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toMatchObject({
      mimeType: 'image/jpeg',
      kind: 'IMAGE',
    });
  });

  it('detects PNG', () => {
    expect(
      sniffFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toMatchObject({ mimeType: 'image/png' });
  });

  it('detects GIF', () => {
    expect(sniffFileType(ascii('GIF89a'))).toMatchObject({ mimeType: 'image/gif' });
  });

  it('detects WebP only when the RIFF container declares it', () => {
    const webp = ascii('RIFF');
    webp.write('WEBP', 8, 'ascii');
    expect(sniffFileType(webp)).toMatchObject({ mimeType: 'image/webp' });

    // A RIFF wave file is not an image and must not be accepted as one.
    const wave = ascii('RIFF');
    wave.write('WAVE', 8, 'ascii');
    expect(sniffFileType(wave)).toBeNull();
  });

  it('separates AVIF from MP4 by the ISO brand, not the magic', () => {
    const avif = ascii('ftyp', 4);
    avif.write('avif', 8, 'ascii');
    expect(sniffFileType(avif)).toMatchObject({ mimeType: 'image/avif', kind: 'IMAGE' });

    const mp4 = ascii('ftyp', 4);
    mp4.write('isom', 8, 'ascii');
    expect(sniffFileType(mp4)).toMatchObject({ mimeType: 'video/mp4', kind: 'VIDEO' });
  });

  it('rejects an ISO container with an unknown brand', () => {
    const unknown = ascii('ftyp', 4);
    unknown.write('qt  ', 8, 'ascii');
    expect(sniffFileType(unknown)).toBeNull();
  });

  it('detects WebM', () => {
    expect(sniffFileType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toMatchObject({
      mimeType: 'video/webm',
    });
  });

  it('detects a glTF binary and checks its version', () => {
    const glb = ascii('glTF');
    glb.writeUInt32LE(2, 4);
    expect(sniffFileType(glb)).toMatchObject({ mimeType: 'model/gltf-binary', kind: 'MODEL_3D' });

    // glTF 1 is a different, incompatible format; the viewer would fail on it.
    const legacy = ascii('glTF');
    legacy.writeUInt32LE(1, 4);
    expect(sniffFileType(legacy)).toBeNull();
  });

  it('detects PDF', () => {
    expect(sniffFileType(ascii('%PDF-1.7'))).toMatchObject({
      mimeType: 'application/pdf',
      kind: 'DOCUMENT',
    });
  });

  it('detects SVG, which is text and has no magic number', () => {
    expect(sniffFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject(
      { mimeType: 'image/svg+xml' },
    );
  });

  it('detects SVG after an XML declaration and leading whitespace', () => {
    // The declaration comes first, so the check cannot require <svg at index 0.
    const svg = Buffer.from('  <?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>');
    expect(sniffFileType(svg)).toMatchObject({ mimeType: 'image/svg+xml' });
  });

  it('rejects an executable disguised with an image extension', () => {
    expect(sniffFileType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });

  it('rejects a ZIP, which is what an office document or an archive looks like', () => {
    expect(sniffFileType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
  });

  it('rejects plain text and an empty file', () => {
    expect(sniffFileType(Buffer.from('just some text'))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it('rejects HTML that merely mentions svg', () => {
    expect(sniffFileType(Buffer.from('<html><body>svg</body></html>'))).toBeNull();
  });
});

describe('isScriptableImage', () => {
  it('flags SVG, which can carry script', () => {
    expect(isScriptableImage('image/svg+xml')).toBe(true);
  });

  it('does not flag raster formats', () => {
    expect(isScriptableImage('image/png')).toBe(false);
    expect(isScriptableImage('image/jpeg')).toBe(false);
  });
});
