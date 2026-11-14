/** Network sources with an on-disk cache (.cache/), so `--offline` rebuilds are reproducible. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CardSet } from '../../src/types.ts';
import { extractNextData, galleryItems, type GalleryCard } from './gallery.ts';

export const RIFTCODEX = process.env.RIFTCODEX_URL ?? 'https://api.riftcodex.com';
export const GALLERY = (locale: string) => `https://playriftbound.com/${locale}/card-gallery/`;
const UA = 'riftbound-api-build/1.0 (+https://github.com/KalimbaPro/riftbound-api)';

export const CACHE_DIR = join(process.cwd(), '.cache');
export const offline = process.argv.includes('--offline') || process.env.OFFLINE === '1';

async function cached<T>(name: string, produce: () => Promise<T>): Promise<T> {
  const file = join(CACHE_DIR, name);
  if (offline) {
    if (!existsSync(file)) throw new Error(`--offline but ${file} is not cached`);
    return JSON.parse(await readFile(file, 'utf8')) as T;
  }
  try {
    const value = await produce();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return value;
  } catch (e) {
    // A flaky upstream must not break the nightly build if we have yesterday's copy:
    // the validation step still guarantees what we publish is consistent.
    if (existsSync(file)) {
      console.warn(`! ${name}: ${(e as Error).message}; using cached copy`);
      return JSON.parse(await readFile(file, 'utf8')) as T;
    }
    throw e;
  }
}

export async function fetchText(url: string, attempts = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

const fetchJson = async <T>(url: string) => JSON.parse(await fetchText(url)) as T;

interface Envelope<T> { items: T[]; total: number; page: number; size: number; pages: number }

async function allPages<T extends { id: string }>(path: string): Promise<T[]> {
  const first = await fetchJson<Envelope<T>>(`${RIFTCODEX}${path}?page=1&size=100`);
  const items = [...first.items];
  for (let p = 2; p <= first.pages; p++) {
    items.push(...(await fetchJson<Envelope<T>>(`${RIFTCODEX}${path}?page=${p}&size=100`)).items);
  }
  const unique = [...new Map(items.map((i) => [i.id, i])).values()];
  if (unique.length !== first.total) {
    throw new Error(`RiftCodex ${path}: got ${unique.length} unique items, envelope says ${first.total}`);
  }
  return unique;
}

export const riftcodexCards = () => cached('riftcodex-cards.json', () => allPages<Card>('/cards'));
export const riftcodexSets = () => cached('riftcodex-sets.json', () => allPages<CardSet>('/sets'));

export const gallery = (locale: string): Promise<GalleryCard[]> =>
  cached(`gallery-${locale}.json`, async () => galleryItems(extractNextData(await fetchText(GALLERY(locale)))));
