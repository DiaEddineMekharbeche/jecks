import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Demo product imagery.
 *
 * The seed has no photography to work with, so it writes a deterministic SVG per
 * colourway into the local storage root. Real photos replace these by uploading through
 * the admin media library (F-AD-10); the Media rows keep the same ids either way.
 */

/** packages/db/prisma/seed -> repo root, so the path holds wherever the seed is run from. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const STORAGE_ROOT = process.env.LOCAL_STORAGE_DIR
  ? resolve(process.env.LOCAL_STORAGE_DIR)
  : join(REPO_ROOT, 'storage');

export interface PlaceholderOptions {
  title: string;
  subtitle: string;
  hex: string;
}

/** Perceived luminance, so the caption stays readable on both dark and pale swatches. */
function isDark(hex: string): boolean {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A flat cap silhouette — enough to read as a product card in a demo grid. */
function svg({ title, subtitle, hex }: PlaceholderOptions): string {
  const ink = isDark(hex) ? '#F2EDE4' : '#111111';
  const shade = isDark(hex) ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1500" width="1200" height="1500" role="img" aria-label="${escapeXml(title)} ${escapeXml(subtitle)}">
  <rect width="1200" height="1500" fill="#161618"/>
  <g transform="translate(600 700)">
    <path d="M-330 90 C-330 -150 -170 -280 0 -280 C170 -280 330 -150 330 90 Z" fill="${hex}"/>
    <path d="M0 -280 C90 -240 140 -110 150 90 L-150 90 C-140 -110 -90 -240 0 -280 Z" fill="${shade}"/>
    <path d="M-330 90 C-250 150 250 150 470 96 C500 88 500 130 470 142 C240 210 -260 210 -330 140 Z" fill="${hex}"/>
    <circle cx="0" cy="-250" r="22" fill="${shade}"/>
  </g>
  <text x="80" y="1290" fill="${ink}" font-family="Helvetica, Arial, sans-serif" font-size="72" font-weight="700" opacity="0.92">${escapeXml(title)}</text>
  <text x="80" y="1370" fill="${ink}" font-family="Helvetica, Arial, sans-serif" font-size="44" opacity="0.6">${escapeXml(subtitle)}</text>
  <text x="80" y="140" fill="#D9B36A" font-family="Helvetica, Arial, sans-serif" font-size="40" letter-spacing="12">JECK'S</text>
</svg>
`;
}

export async function writePlaceholderImage(
  key: string,
  options: PlaceholderOptions,
): Promise<void> {
  const path = join(STORAGE_ROOT, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, svg(options), 'utf8');
}

export function placeholderStorageRoot(): string {
  return STORAGE_ROOT;
}

/**
 * A minimal but genuinely valid GLB — PRD Section 6.3 and DECISIONS D24.
 *
 * The catalogue ships with no 3D scans, and a fixture file checked into the repository
 * would be a binary nobody can review. This writes a real glTF 2.0 binary instead: an
 * indexed box with a PBR material, which the worker can Draco-compress and the
 * storefront can render, so the whole 3D path is exercised by the seed rather than
 * waiting for someone to have a model to upload.
 */
export function buildPlaceholderGlb(): Buffer {
  // A flattened box, roughly cap-proportioned: 1 x 0.5 x 1.
  const positions = new Float32Array([
    -0.5, 0.0, -0.5, 0.5, 0.0, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.0, 0.5, 0.5, 0.0, 0.5,
    0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);

  const indices = new Uint16Array([
    0,
    1,
    2,
    0,
    2,
    3, // back
    4,
    6,
    5,
    4,
    7,
    6, // front
    0,
    3,
    7,
    0,
    7,
    4, // left
    1,
    5,
    6,
    1,
    6,
    2, // right
    3,
    2,
    6,
    3,
    6,
    7, // top
    0,
    4,
    5,
    0,
    5,
    1, // bottom
  ]);

  const positionBytes = Buffer.from(positions.buffer);
  const indexBytes = Buffer.from(indices.buffer);
  // Every bufferView offset must sit on a four-byte boundary.
  const indexOffset = align4(positionBytes.length);
  const binary = Buffer.alloc(align4(indexOffset + indexBytes.length));
  positionBytes.copy(binary, 0);
  indexBytes.copy(binary, indexOffset);

  const gltf = {
    asset: { version: '2.0', generator: "Jeck's seed" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'cap' }],
    meshes: [
      { name: 'cap', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
    ],
    materials: [
      {
        name: 'brass',
        pbrMetallicRoughness: {
          baseColorFactor: [0.85, 0.7, 0.42, 1],
          metallicFactor: 0.2,
          roughnessFactor: 0.7,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: 8,
        type: 'VEC3',
        min: [-0.5, 0, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      {
        bufferView: 1,
        componentType: 5123, // UNSIGNED_SHORT
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: binary.length }],
  };

  // The JSON chunk pads with spaces and the binary chunk with zeroes; both are what the
  // specification requires, and a viewer will reject the file otherwise.
  const json = padTo4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const bin = padTo4(binary, 0x00);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.write('JSON', 4, 'ascii');

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.write('BIN\0', 4, 'ascii');

  return Buffer.concat([header, jsonHeader, json, binHeader, bin]);
}

export async function writePlaceholderModel(key: string): Promise<number> {
  const glb = buildPlaceholderGlb();
  const path = join(STORAGE_ROOT, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, glb);
  return glb.length;
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function padTo4(buffer: Buffer, fill: number): Buffer {
  const padded = Buffer.alloc(align4(buffer.length), fill);
  buffer.copy(padded, 0);
  return padded;
}
