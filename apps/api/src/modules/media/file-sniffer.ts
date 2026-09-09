import { MediaKind } from '@jecks/shared';

/**
 * Content-based type detection — PRD-COMPLETION M1.1 ("MIME sniffing").
 *
 * The browser-supplied `Content-Type` and the file extension are both attacker
 * controlled. Before anything is stored, the first bytes are read and compared against
 * the closed set of formats the platform accepts. A file whose contents disagree with
 * its claimed type is refused rather than trusted.
 */

export interface SniffedType {
  mimeType: string;
  extension: string;
  kind: MediaKind;
}

interface Signature {
  mimeType: string;
  extension: string;
  kind: MediaKind;
  /** Bytes that must match at `offset`; `null` in the pattern means "any byte". */
  offset: number;
  magic: Array<number | null>;
  /** Extra check for containers whose magic alone is ambiguous. */
  verify?: (buffer: Buffer) => boolean;
}

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

const SIGNATURES: Signature[] = [
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    kind: MediaKind.IMAGE,
    offset: 0,
    magic: [0xff, 0xd8, 0xff],
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    kind: MediaKind.IMAGE,
    offset: 0,
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    mimeType: 'image/gif',
    extension: 'gif',
    kind: MediaKind.IMAGE,
    offset: 0,
    magic: ascii('GIF8'),
  },
  {
    // RIFF container; the WEBP tag four bytes later is what makes it a WebP.
    mimeType: 'image/webp',
    extension: 'webp',
    kind: MediaKind.IMAGE,
    offset: 0,
    magic: ascii('RIFF'),
    verify: (buffer) => buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    // ISO base media file format. The brand at offset 8 separates AVIF from MP4.
    mimeType: 'image/avif',
    extension: 'avif',
    kind: MediaKind.IMAGE,
    offset: 4,
    magic: ascii('ftyp'),
    verify: (buffer) => ['avif', 'avis'].includes(buffer.subarray(8, 12).toString('ascii')),
  },
  {
    mimeType: 'video/mp4',
    extension: 'mp4',
    kind: MediaKind.VIDEO,
    offset: 4,
    magic: ascii('ftyp'),
    verify: (buffer) =>
      ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(
        buffer.subarray(8, 12).toString('ascii'),
      ),
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    kind: MediaKind.VIDEO,
    offset: 0,
    magic: [0x1a, 0x45, 0xdf, 0xa3],
  },
  {
    // glTF binary: "glTF" magic, then a little-endian version that must be 2.
    mimeType: 'model/gltf-binary',
    extension: 'glb',
    kind: MediaKind.MODEL_3D,
    offset: 0,
    magic: ascii('glTF'),
    verify: (buffer) => buffer.length >= 12 && buffer.readUInt32LE(4) === 2,
  },
  {
    mimeType: 'application/pdf',
    extension: 'pdf',
    kind: MediaKind.DOCUMENT,
    offset: 0,
    magic: ascii('%PDF-'),
  },
];

/** Enough bytes for every signature above, including the ISO-BMFF brand. */
export const SNIFF_BYTES = 32;

export function sniffFileType(buffer: Buffer): SniffedType | null {
  for (const signature of SIGNATURES) {
    if (!matches(buffer, signature)) continue;
    if (signature.verify && !signature.verify(buffer)) continue;
    return {
      mimeType: signature.mimeType,
      extension: signature.extension,
      kind: signature.kind,
    };
  }

  // SVG is text, so it has no magic number. It is treated separately and never
  // rendered inline by the storefront, because an SVG can carry script.
  if (looksLikeSvg(buffer)) {
    return { mimeType: 'image/svg+xml', extension: 'svg', kind: MediaKind.IMAGE };
  }

  return null;
}

function matches(buffer: Buffer, signature: Signature): boolean {
  if (buffer.length < signature.offset + signature.magic.length) return false;
  return signature.magic.every((byte, index) => {
    if (byte === null) return true;
    return buffer[signature.offset + index] === byte;
  });
}

/** An SVG is XML whose root element is `<svg`, possibly after a declaration. */
function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString('utf8').trimStart();
  if (!head.startsWith('<')) return false;
  return /<svg[\s>]/i.test(head);
}

/**
 * SVG uploaded by staff is stored, but flagged: it is served with a content type that
 * browsers will not execute, and never inlined into a page.
 */
export function isScriptableImage(mimeType: string): boolean {
  return mimeType === 'image/svg+xml';
}
