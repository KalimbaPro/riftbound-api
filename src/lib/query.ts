import type { Card, Page } from '../types.ts';
import { baseName, nameKey } from './names.ts';

export const SORT_FIELDS = [
  'name', 'collector_number', 'public_code', 'type', 'supertype', 'rarity', 'domain',
  'artist', 'set_id', 'set_label', 'energy', 'might', 'power',
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export class QueryError extends Error {
  constructor(message: string, readonly status: 404 | 422 = 422) {
    super(message);
  }
}

/** "ogn-303*-298" -> "OGN-303*\/298" (what the apps derive too). */
export function publicCode(c: Card): string {
  const p = c.riftbound_id.split('-').filter(Boolean);
  if (p.length < 3) return `${c.set.set_id}-${String(c.collector_number).padStart(3, '0')}`;
  return `${p[0].toUpperCase()}-${p[1]}/${p[2]}`;
}

function sortValue(c: Card, f: SortField): string | number | null {
  switch (f) {
    case 'name': return c.name.toLowerCase();
    case 'collector_number': return c.collector_number;
    case 'public_code': return publicCode(c);
    case 'type': return c.classification.type;
    case 'supertype': return c.classification.supertype;
    case 'rarity': return c.classification.rarity;
    case 'domain': return c.classification.domain.join(',') || null;
    case 'artist': return c.media.artist;
    case 'set_id': return c.set.set_id;
    case 'set_label': return c.set.label;
    case 'energy': return c.attributes.energy;
    case 'might': return c.attributes.might;
    case 'power': return c.attributes.power;
  }
}

export interface ListParams {
  page?: string;
  size?: string;
  sort?: string;
  dir?: string;
  set_id?: string;
  new?: string;
}

function intParam(v: string | undefined, name: string, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new QueryError(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function paginate<T>(items: T[], params: ListParams): Page<T> {
  const page = intParam(params.page, 'page', 1, 1, Number.MAX_SAFE_INTEGER);
  const size = intParam(params.size, 'size', 50, 1, 100);
  const total = items.length;
  return {
    items: items.slice((page - 1) * size, page * size),
    total,
    page,
    size,
    pages: Math.ceil(total / size),
  };
}

/** set_id / new filters, then sort/dir, as RiftCodex's list endpoints do. */
export function filterAndSort(cards: Card[], params: ListParams): Card[] {
  let out = cards;
  if (params.set_id) {
    const s = params.set_id.toUpperCase();
    out = out.filter((c) => c.set.set_id.toUpperCase() === s);
  }
  if (params.new !== undefined && params.new !== '') {
    const want = ['true', '1', 'yes'].includes(params.new.toLowerCase());
    out = out.filter((c) => Boolean(c.new) === want);
  }
  if (params.sort) {
    if (!(SORT_FIELDS as readonly string[]).includes(params.sort)) {
      throw new QueryError(`sort must be one of ${SORT_FIELDS.join(', ')}`);
    }
    const dir = params.dir === '-1' ? -1 : 1;
    if (params.dir !== undefined && params.dir !== '1' && params.dir !== '-1') {
      throw new QueryError('dir must be 1 or -1');
    }
    const f = params.sort as SortField;
    out = [...out].sort((a, b) => {
      const va = sortValue(a, f);
      const vb = sortValue(b, f);
      if (va === vb) return a.riftbound_id.localeCompare(b.riftbound_id);
      if (va === null) return 1; // nulls last in both directions
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * dir;
    });
  }
  return out;
}

function haystack(c: Card): string {
  return nameKey([c.name, c.text.plain ?? '', c.tags.join(' '), c.classification.type,
    c.classification.supertype ?? '', c.set.set_id, publicCode(c)].join(' '));
}

/** Full-text search: every query word must appear in the name, text, tags, type or code. */
export function search(cards: Card[], query: string): Card[] {
  const words = nameKey(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  return cards.filter((c) => {
    const h = haystack(c);
    return words.every((w) => h.includes(w));
  });
}

export function byExactName(cards: Card[], name: string): Card[] {
  const want = name.trim().toLowerCase();
  const wantKey = nameKey(name);
  return cards.filter(
    (c) => c.name.toLowerCase() === want || nameKey(baseName(c.name)) === wantKey || nameKey(c.name) === wantKey,
  );
}

/** Fuzzy: every word of the query is a substring of the folded name (order-insensitive). */
export function byFuzzyName(cards: Card[], name: string): Card[] {
  const words = nameKey(name).split(' ').filter(Boolean);
  if (!words.length) return [];
  return cards.filter((c) => {
    const k = nameKey(c.name);
    return words.every((w) => k.includes(w));
  });
}
