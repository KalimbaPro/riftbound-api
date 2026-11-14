/**
 * Pure assembly of the catalogue from already-fetched sources + content. All IO lives in
 * scripts/build-data.ts, so this is what the tests exercise.
 */
import { createHash } from 'node:crypto';
import type { Card, CardSet, Dataset, LegalityFile } from '../../src/types.ts';
import { cleanName } from '../../src/lib/names.ts';
import { computeLegality, indexByName, resolveName, type MainSet } from '../../src/lib/legality.ts';
import type { Content } from './content.ts';
import { localization, mapGalleryCard, riftboundIdFromGallery, type GalleryCard } from './gallery.ts';

export type IdMap = Record<string, string>;
export type HashState = Record<string, { hash: string; updated_on: string }>;

export interface Sources {
  riftcodexCards: Card[];
  riftcodexSets: CardSet[];
  gallery: Record<'en-us' | 'zh-cn' | 'ko-kr', GalleryCard[]>;
}

export interface BuildResult {
  dataset: Dataset;
  idMap: IdMap;
  hashes: HashState;
  report: string[];
}

export class ValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Data validation failed:\n  - ${problems.join('\n  - ')}`);
  }
}

/** New ids: first 24 hex chars of sha1(riftbound_id) — same shape as RiftCodex's ObjectIds. */
export function newId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 24);
}

/** Frozen id: once written to data/id-map.json an id never changes. */
function idFor(idMap: IdMap, key: string): string {
  return (idMap[key] ??= newId(key));
}

const stableHash = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex');

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) throw new Error(`override path ${path}: ${k} is not an object`);
    o = o[k] as Record<string, unknown>;
  }
  o[keys.at(-1)!] = value;
}

const clone = <T>(v: T): T => structuredClone(v);

export function mainSets(content: Content): MainSet[] {
  return content.sets.filter((s) => s.main).map((s) => ({ set_id: s.set_id, released: s.released }));
}

export function assemble(src: Sources, content: Content, prev: { idMap: IdMap; hashes: HashState; now: string }): BuildResult {
  const idMap: IdMap = { ...prev.idMap };
  const hashes: HashState = { ...prev.hashes };
  const problems: string[] = [];
  const report: string[] = [];
  const ordered = mainSets(content).sort((a, b) => a.released.localeCompare(b.released));
  const newestMain = ordered.at(-1)?.set_id;

  // 1. RiftCodex is the base; its ids are kept verbatim.
  const cards: Card[] = src.riftcodexCards.map(clone);
  const rcRids = new Set(cards.map((c) => c.riftbound_id));
  const ourCards = new Set<Card>(); // cards we added (gallery + manual): updated_on is ours to track

  // 2. Official gallery fills in whatever RiftCodex lacks.
  const en = src.gallery['en-us'];
  const byRid = (list: GalleryCard[]) => new Map(list.map((g) => [riftboundIdFromGallery(g.id), g]));
  const zh = byRid(src.gallery['zh-cn']);
  const ko = byRid(src.gallery['ko-kr']);
  const enByRid = byRid(en);
  let fromGallery = 0;
  for (const g of en) {
    const rid = riftboundIdFromGallery(g.id);
    if (rcRids.has(rid)) continue;
    const mapped = mapGalleryCard(g);
    const card: Card = { id: idFor(idMap, rid), ...mapped, new: mapped.set.set_id === newestMain };
    cards.push(card);
    ourCards.add(card);
    fromGallery++;
  }
  report.push(`gallery: added ${fromGallery} cards RiftCodex lacks`);

  // 3. Localisations (zh-cn, ko-kr) for every card the gallery knows, RiftCodex ones included.
  let localized = 0;
  for (const c of cards) {
    const g = enByRid.get(c.riftbound_id);
    if (!g) continue;
    const locs: NonNullable<Card['localizations']> = {};
    const z = localization(g, zh.get(c.riftbound_id));
    const k = localization(g, ko.get(c.riftbound_id));
    if (z) locs.zh = z;
    if (k) locs.ko = k;
    if (Object.keys(locs).length) {
      c.localizations = locs;
      localized++;
    }
  }
  report.push(`localizations: ${localized} cards`);

  // 4. Sets: RiftCodex's plus the ones in sets.yaml it does not have.
  const setMeta = new Map(content.sets.map((s) => [s.set_id, s]));
  const sets: CardSet[] = src.riftcodexSets.map(clone);
  const setLabel = new Map<string, string>();
  for (const c of src.riftcodexCards) setLabel.set(c.set.set_id, c.set.label);
  for (const g of en) setLabel.set(g.set.value.id, g.set.value.label);
  for (const s of content.sets) {
    if (s.name) setLabel.set(s.set_id, s.name);
    if (sets.some((x) => x.set_id === s.set_id)) continue;
    if (!s.name) problems.push(`sets.yaml: ${s.set_id} is not a RiftCodex set, so it needs a name`);
    sets.push({
      id: idFor(idMap, `set:${s.set_id}`),
      name: s.name ?? s.set_id,
      set_id: s.set_id,
      card_count: 0,
      tcgplayer_id: null,
      cardmarket_id: null,
      published_on: `${s.released}T00:00:00`,
    });
  }

  // 5. Manual cards (promos), each a reprint of a `base` card with its own print details.
  const firstByRid = new Map<string, Card>();
  for (const c of cards) if (!firstByRid.has(c.riftbound_id)) firstByRid.set(c.riftbound_id, c);
  for (const m of content.manualCards) {
    if (m.disabled) {
      report.push(`manual: skipped disabled ${m.riftbound_id} (${m.file})`);
      continue;
    }
    if (firstByRid.has(m.riftbound_id)) {
      problems.push(`cards/${m.file}: ${m.riftbound_id} already exists upstream — use overrides.yaml instead`);
      continue;
    }
    const base = firstByRid.get(m.base);
    if (!base) {
      problems.push(`cards/${m.file} ${m.riftbound_id}: base ${m.base} is not in the catalogue`);
      continue;
    }
    if (!setLabel.has(m.set_id)) problems.push(`cards/${m.file} ${m.riftbound_id}: set ${m.set_id} is not in sets.yaml or RiftCodex`);
    const flags = { alternate_art: false, overnumbered: false, signature: false, ...m.flags };
    const name = m.name ?? base.name.replace(/\s*\([^)]*\)\s*$/g, '');
    const card: Card = {
      ...clone(base),
      id: idFor(idMap, m.riftbound_id),
      name,
      riftbound_id: m.riftbound_id,
      tcgplayer_id: m.tcgplayer_id ?? null,
      collector_number: m.collector_number ?? base.collector_number,
      classification: { ...base.classification, rarity: m.rarity ?? base.classification.rarity },
      set: { set_id: m.set_id, label: setLabel.get(m.set_id) ?? m.set_id },
      media: {
        ...base.media,
        image_url: m.image === undefined ? base.media.image_url : m.image,
        artist: m.artist === undefined ? base.media.artist : m.artist,
      },
      metadata: { ...base.metadata, clean_name: cleanName(name), updated_on: null, ...flags },
      new: false,
    };
    delete card.localizations; // the base's localised images are not this print
    cards.push(card);
    ourCards.add(card);
  }

  // 6. Overrides on upstream cards.
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const o of content.overrides) {
    const c = byId.get(o.id);
    if (!c) {
      problems.push(`overrides.yaml: no card with id ${o.id}`);
      continue;
    }
    if (c.riftbound_id !== o.riftbound_id) {
      problems.push(`overrides.yaml: ${o.id} is ${c.riftbound_id}, not ${o.riftbound_id}`);
      continue;
    }
    for (const [path, value] of Object.entries(o.set)) setPath(c as unknown as Record<string, unknown>, path, value);
  }

  // 7. updated_on for cards we own: bumped only when the card's content actually changes,
  //    so nightly rebuilds of unchanged data produce no diff.
  for (const c of ourCards) {
    const { metadata, ...rest } = c;
    const h = stableHash({ ...rest, metadata: { ...metadata, updated_on: null } });
    const prevState = hashes[c.riftbound_id];
    if (!prevState || prevState.hash !== h) hashes[c.riftbound_id] = { hash: h, updated_on: prev.now };
    c.metadata.updated_on = hashes[c.riftbound_id].updated_on;
  }

  // 8. Deterministic order: main sets by release, then other sets, then collector number.
  const setRank = new Map<string, number>();
  const others = [...sets].sort((a, b) => a.published_on.localeCompare(b.published_on) || a.set_id.localeCompare(b.set_id));
  [...ordered.map((s) => s.set_id), ...others.map((s) => s.set_id)].forEach((s) => {
    if (!setRank.has(s)) setRank.set(s, setRank.size);
  });
  cards.sort(
    (a, b) =>
      (setRank.get(a.set.set_id) ?? 999) - (setRank.get(b.set.set_id) ?? 999) ||
      a.collector_number - b.collector_number ||
      a.riftbound_id.localeCompare(b.riftbound_id) ||
      a.id.localeCompare(b.id),
  );
  for (const s of sets) s.card_count = cards.filter((c) => c.set.set_id === s.set_id).length;
  sets.sort((a, b) => (setRank.get(a.set_id) ?? 999) - (setRank.get(b.set_id) ?? 999));

  // 9. Legality.
  const legalityInput = {
    cards,
    announcements: content.bans.map((a) => ({
      ...a,
      bans: a.bans.map((b) => ({ formats: b.formats, cards: b.cards.map((r) => r.match ?? r.name) })),
    })),
    errata: content.errata.map((e) => ({ ...e, name: e.match ?? e.name })),
    regions: content.regions,
    mainSets: ordered,
  };
  const legalityDraft = computeLegality({ ...legalityInput, updatedAt: '' });
  const legHash = stableHash(legalityDraft.regions);
  if (hashes.__legality__?.hash !== legHash) hashes.__legality__ = { hash: legHash, updated_on: prev.now };
  const legality: LegalityFile = { ...legalityDraft, updated_at: hashes.__legality__.updated_on };

  // 10. Validation — fail loudly.
  problems.push(...validate(cards, sets, content, rcRids, legalityInput));
  if (problems.length) throw new ValidationError(problems);

  for (const r of Object.keys(legality.regions) as (keyof LegalityFile['regions'])[]) {
    const items = legality.regions[r];
    report.push(`legality ${r}: ${items.filter((i) => i.banned).length} banned (standard), ` +
      `${items.filter((i) => i.banned_formats.length).length} banned in any format, ${items.filter((i) => i.errata).length} with errata`);
  }
  return { dataset: { cards, sets, legality }, idMap: sortKeys(idMap), hashes: sortKeys(hashes), report };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

const ID = /^[0-9a-f]{24}$/;

export function validate(
  cards: Card[],
  sets: CardSet[],
  content: Content,
  riftcodexRids: Set<string>,
  legality: { announcements: { title: string; bans: { cards: string[] }[] }[]; errata: { name: string; source: string }[]; regions: Content['regions']; mainSets: MainSet[] },
): string[] {
  const problems: string[] = [];

  // ids: unique, 24 hex.
  const seen = new Map<string, string>();
  for (const c of cards) {
    if (!ID.test(c.id)) problems.push(`${c.riftbound_id}: id "${c.id}" is not 24 hex chars`);
    if (seen.has(c.id)) problems.push(`duplicate id ${c.id} (${seen.get(c.id)} and ${c.riftbound_id})`);
    seen.set(c.id, c.riftbound_id);
  }
  // riftbound_ids: RiftCodex itself repeats some (VEN double imports, OPP metal variants),
  // and we keep those for id stability; every card WE add must be unique.
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.riftbound_id, (counts.get(c.riftbound_id) ?? 0) + 1);
  for (const [rid, n] of counts) {
    if (n > 1 && !riftcodexRids.has(rid)) problems.push(`duplicate riftbound_id ${rid} (${n} cards)`);
  }

  // Schema.
  const setIds = new Set(sets.map((s) => s.set_id));
  for (const c of cards) {
    const where = `${c.riftbound_id} (${c.id})`;
    if (!c.name) problems.push(`${where}: empty name`);
    if (!Number.isInteger(c.collector_number)) problems.push(`${where}: collector_number`);
    if (!c.classification?.type || !c.classification.rarity || !Array.isArray(c.classification.domain)) problems.push(`${where}: classification`);
    if (!setIds.has(c.set.set_id)) problems.push(`${where}: set ${c.set.set_id} has no /sets entry`);
    if (!c.media || !('image_url' in c.media)) problems.push(`${where}: media`);
    if (!Array.isArray(c.tags)) problems.push(`${where}: tags`);
    if (!c.metadata || typeof c.metadata.signature !== 'boolean') problems.push(`${where}: metadata flags`);
    if (c.media.image_url && !/^(https:\/\/|\/images\/)/.test(c.media.image_url)) problems.push(`${where}: image_url must be https:// or /images/…`);
  }

  // Every ban/errata name resolves to at least one card.
  const idx = indexByName(cards);
  for (const a of legality.announcements) {
    for (const b of a.bans) {
      for (const n of b.cards) {
        if (!resolveName(idx, n).length) problems.push(`bans.yaml "${a.title}": "${n}" matches no card (add match: <catalogue name>)`);
      }
    }
  }
  for (const e of legality.errata) {
    if (!resolveName(idx, e.name).length) problems.push(`errata.yaml: "${e.name}" (${e.source}) matches no card (add match: <catalogue name>)`);
  }

  // Regions point at main sets.
  const main = new Set(legality.mainSets.map((s) => s.set_id));
  for (const [r, cfg] of Object.entries(legality.regions)) {
    if (cfg.latest_set !== 'latest' && !main.has(cfg.latest_set)) problems.push(`regions.yaml: ${r}.latest_set ${cfg.latest_set} is not a main set in sets.yaml`);
  }
  for (const s of content.sets) if (s.main && !setIds.has(s.set_id)) problems.push(`sets.yaml: main set ${s.set_id} has no cards`);
  return problems;
}
