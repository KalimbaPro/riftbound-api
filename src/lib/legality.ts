import type { Card, Format, LegalityFile, LegalityItem, Region } from '../types.ts';
import { cardKeys, nameKey } from './names.ts';

export interface BanEntry {
  formats: Format[];
  cards: string[];
}
export interface BanAnnouncement {
  title: string;
  announced: string;
  effective: string;
  source: string;
  bans: BanEntry[];
}
export interface ErrataEntry {
  name: string;
  date: string;
  source: string;
  text: string;
}
export interface MainSet {
  set_id: string;
  released: string; // global release date, YYYY-MM-DD
}
export interface RegionConfig {
  label: string;
  latest_set: string; // a main set_id, or "latest" (always on the newest set)
}

/**
 * SPEC §1 Regions: a region behind the global schedule uses the global ban list as it stood
 * at the end of the season of its latest released set, i.e. every ban whose effective date
 * is before the global release of the set that follows. No following set ⇒ every ban.
 * Returns the cutoff date (exclusive) or null for "no cutoff".
 */
export function regionCutoff(region: RegionConfig, mainSets: MainSet[]): string | null {
  if (region.latest_set === 'latest') return null;
  const ordered = [...mainSets].sort((a, b) => a.released.localeCompare(b.released));
  const idx = ordered.findIndex((s) => s.set_id === region.latest_set);
  if (idx < 0) throw new Error(`Region latest_set ${region.latest_set} is not a main set in sets.yaml`);
  return ordered[idx + 1]?.released ?? null;
}

export function banAppliesIn(ban: { effective: string }, cutoff: string | null): boolean {
  return cutoff === null || ban.effective < cutoff;
}

/** Index cards by every name key they answer to. */
export function indexByName(cards: Card[]): Map<string, Card[]> {
  const idx = new Map<string, Card[]>();
  for (const c of cards) {
    for (const k of cardKeys(c.name, c.classification.type)) {
      const list = idx.get(k) ?? [];
      list.push(c);
      idx.set(k, list);
    }
  }
  return idx;
}

export function resolveName(idx: Map<string, Card[]>, name: string): Card[] {
  return idx.get(nameKey(name)) ?? [];
}

export interface LegalityInput {
  cards: Card[];
  announcements: BanAnnouncement[];
  errata: ErrataEntry[];
  regions: Record<string, RegionConfig>;
  mainSets: MainSet[];
  updatedAt: string;
}

/** Resolve the per-region legality lists (banned or errata'd cards only). */
export function computeLegality(input: LegalityInput): LegalityFile {
  const idx = indexByName(input.cards);

  // Latest errata per card id (a later article supersedes an earlier one).
  const errataById = new Map<string, ErrataEntry>();
  for (const e of [...input.errata].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const c of resolveName(idx, e.name)) errataById.set(c.id, e);
  }

  const regions = {} as Record<Region, LegalityItem[]>;
  for (const [region, cfg] of Object.entries(input.regions)) {
    const cutoff = regionCutoff(cfg, input.mainSets);
    const formatsById = new Map<string, Set<Format>>();
    for (const ann of input.announcements) {
      if (!banAppliesIn(ann, cutoff)) continue;
      for (const ban of ann.bans) {
        for (const name of ban.cards) {
          for (const c of resolveName(idx, name)) {
            const set = formatsById.get(c.id) ?? new Set<Format>();
            ban.formats.forEach((f) => set.add(f));
            formatsById.set(c.id, set);
          }
        }
      }
    }
    const items: LegalityItem[] = [];
    for (const c of input.cards) {
      const formats = formatsById.get(c.id);
      const err = errataById.get(c.id);
      if (!formats && !err) continue;
      const bannedFormats = (['standard', '2v2'] as Format[]).filter((f) => formats?.has(f));
      items.push({
        id: c.id,
        riftbound_id: c.riftbound_id,
        banned: bannedFormats.includes('standard'),
        banned_formats: bannedFormats,
        errata: err?.text ?? null,
        errata_date: err?.date ?? null,
      });
    }
    items.sort((a, b) => a.riftbound_id.localeCompare(b.riftbound_id));
    regions[region as Region] = items;
  }
  return { updated_at: input.updatedAt, regions };
}

/** Overlay a legality item onto a card, emitting only the fields that are set. */
export function applyLegality(card: Card, item: LegalityItem | undefined): Card {
  const out: Card = { ...card };
  delete out.banned;
  delete out.banned_formats;
  delete out.errata;
  delete out.errata_date;
  if (!item) return out;
  if (item.banned_formats.length) {
    out.banned = item.banned;
    out.banned_formats = item.banned_formats;
  }
  if (item.errata) {
    out.errata = item.errata;
    if (item.errata_date) out.errata_date = item.errata_date;
  }
  return out;
}
