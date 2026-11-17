/** Loading + structural validation of the hand-edited YAML under content/. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import type { Format } from '../../src/types.ts';
import { FORMATS } from '../../src/types.ts';
import type { BanAnnouncement, ErrataEntry, RegionConfig } from '../../src/lib/legality.ts';

export class ContentError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ContentError(msg);
}
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

async function yamlFile(path: string): Promise<unknown> {
  try {
    return YAML.parse(await readFile(path, 'utf8'));
  } catch (e) {
    throw new ContentError(`${path}: ${(e as Error).message}`);
  }
}

/** A ban/errata card reference: the printed name, plus an optional catalogue spelling. */
export interface NameRef { name: string; match?: string }

export interface BanContent extends Omit<BanAnnouncement, 'bans'> {
  bans: { formats: Format[]; cards: NameRef[] }[];
}

export interface SetContent {
  set_id: string;
  name?: string;
  released: string;
  main: boolean;
  source?: string;
}

export interface ManualCard {
  file: string;
  riftbound_id: string;
  set_id: string;
  base: string;
  name?: string;
  collector_number?: number;
  rarity?: string;
  flags?: { alternate_art?: boolean; overnumbered?: boolean; signature?: boolean };
  image?: string | null;
  localized_images?: Record<string, string>;
  artist?: string | null;
  tcgplayer_id?: string | null;
  sources?: string[];
  disabled?: boolean;
}

export interface Override {
  id: string;
  riftbound_id: string;
  set: Record<string, unknown>;
  sources?: string[];
}

export interface Content {
  bans: BanContent[];
  errata: (ErrataEntry & { match?: string })[];
  regions: Record<string, RegionConfig>;
  sets: SetContent[];
  manualCards: ManualCard[];
  overrides: Override[];
}

export function parseBans(doc: unknown, file = 'bans.yaml'): BanContent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (doc as any)?.announcements;
  check(Array.isArray(list), `${file}: missing announcements list`);
  return list.map((a: Record<string, unknown>, i: number) => {
    const where = `${file} announcement #${i + 1}`;
    for (const k of ['title', 'announced', 'effective', 'source']) check(isStr(a[k]), `${where}: ${k} is required`);
    check(DATE.test(a.announced as string) && DATE.test(a.effective as string), `${where}: dates must be YYYY-MM-DD strings (quote them)`);
    check(Array.isArray(a.bans) && a.bans.length, `${where}: bans list is required`);
    return {
      title: a.title, announced: a.announced, effective: a.effective, source: a.source,
      bans: (a.bans as Record<string, unknown>[]).map((b) => {
        check(Array.isArray(b.formats) && b.formats.length, `${where}: every ban group needs formats`);
        for (const f of b.formats as string[]) check(FORMATS.includes(f as Format), `${where}: unknown format "${f}"`);
        check(Array.isArray(b.cards) && b.cards.length, `${where}: every ban group needs cards`);
        return {
          formats: b.formats as Format[],
          cards: (b.cards as unknown[]).map((c) => {
            if (isStr(c)) return { name: c };
            const o = c as NameRef;
            check(o && isStr(o.name), `${where}: card entries are a name or {name, match}`);
            return { name: o.name, ...(o.match ? { match: o.match } : {}) };
          }),
        };
      }),
    } as BanContent;
  });
}

export function parseErrataDoc(doc: unknown, file = 'errata.yaml') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (doc as any)?.errata;
  check(Array.isArray(list), `${file}: missing errata list`);
  return list.map((e: Record<string, unknown>, i: number) => {
    const where = `${file} #${i + 1} (${String(e?.name)})`;
    for (const k of ['name', 'date', 'source', 'text']) check(isStr(e[k]), `${where}: ${k} is required`);
    check(DATE.test(e.date as string), `${where}: date must be YYYY-MM-DD`);
    return { name: e.name, date: e.date, source: e.source, text: e.text, ...(e.match ? { match: e.match } : {}) };
  }) as (ErrataEntry & { match?: string })[];
}

export function parseRegions(doc: unknown, file = 'regions.yaml'): Record<string, RegionConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regions = (doc as any)?.regions;
  check(regions && typeof regions === 'object', `${file}: missing regions map`);
  for (const r of ['global', 'kr', 'tc']) {
    check(regions[r], `${file}: region "${r}" is required`);
    check(isStr(regions[r].latest_set), `${file}: ${r}.latest_set is required`);
  }
  return regions;
}

export function parseSets(doc: unknown, file = 'sets.yaml'): SetContent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (doc as any)?.sets;
  check(Array.isArray(list), `${file}: missing sets list`);
  return list.map((s: Record<string, unknown>) => {
    check(isStr(s.set_id), `${file}: set_id is required`);
    check(isStr(s.released) && DATE.test(s.released as string), `${file}: ${s.set_id}.released must be YYYY-MM-DD`);
    return { ...s, main: Boolean(s.main) } as SetContent;
  });
}

export async function loadContent(dir = join(process.cwd(), 'content')): Promise<Content> {
  const bans = parseBans(await yamlFile(join(dir, 'bans.yaml')));
  const errata = parseErrataDoc(await yamlFile(join(dir, 'errata.yaml')));
  const regions = parseRegions(await yamlFile(join(dir, 'regions.yaml')));
  const sets = parseSets(await yamlFile(join(dir, 'sets.yaml')));

  const manualCards: ManualCard[] = [];
  const cardDir = join(dir, 'cards');
  for (const f of (await readdir(cardDir)).filter((f) => f.endsWith('.yaml')).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (await yamlFile(join(cardDir, f))) as any;
    check(Array.isArray(doc?.cards), `cards/${f}: missing cards list`);
    for (const c of doc.cards) {
      const set_id = c.set_id ?? doc.set_id;
      const where = `cards/${f} ${c.riftbound_id ?? '?'}`;
      check(isStr(c.riftbound_id) && /^[a-z0-9]+-[a-z0-9*]+(-[a-z0-9]+)?$/.test(c.riftbound_id), `${where}: riftbound_id must look like "sgn-001-003"`);
      check(isStr(set_id), `${where}: set_id is required (per card or per file)`);
      check(isStr(c.base), `${where}: base (riftbound_id of the card it reprints) is required`);
      manualCards.push({ ...c, set_id, file: f });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ov = (await yamlFile(join(dir, 'overrides.yaml'))) as any;
  const overrides: Override[] = (ov?.overrides ?? []).map((o: Override) => {
    check(isStr(o.id) && isStr(o.riftbound_id) && o.set && typeof o.set === 'object', `overrides.yaml: id, riftbound_id and set are required`);
    return o;
  });

  return { bans, errata, regions, sets, manualCards, overrides };
}
