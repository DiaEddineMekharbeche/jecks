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

export async function writePlaceholderImage(key: string, options: PlaceholderOptions): Promise<void> {
  const path = join(STORAGE_ROOT, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, svg(options), 'utf8');
}

export function placeholderStorageRoot(): string {
  return STORAGE_ROOT;
}
