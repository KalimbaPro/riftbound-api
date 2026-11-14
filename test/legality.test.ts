import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { banAppliesIn, computeLegality, regionCutoff, applyLegality } from '../src/lib/legality.ts';
import { parseBans, parseRegions, parseSets } from '../scripts/lib/content.ts';
import { card } from './helpers.ts';

const yaml = (f: string) => YAML.parse(readFileSync(`content/${f}`, 'utf8'));
const bans = parseBans(yaml('bans.yaml'));
const sets = parseSets(yaml('sets.yaml'));
const regions = parseRegions(yaml('regions.yaml'));
const mainSets = sets.filter((s) => s.main).map((s) => ({ set_id: s.set_id, released: s.released }));

// One synthetic card per banned name (with the catalogue spelling where one is given).
const announcements = bans.map((a) => ({
  ...a,
  bans: a.bans.map((b) => ({ formats: b.formats, cards: b.cards.map((r) => r.match ?? r.name) })),
}));
const allNames = [...new Set(announcements.flatMap((a) => a.bans.flatMap((b) => b.cards)))];
const cards = allNames.map((name) => card({ name: name.replace(', ', ' - ') }));
const nov23 = announcements.find((a) => a.effective === '2026-11-23')!;

function legality(regionCfg = regions) {
  return computeLegality({ cards, announcements, errata: [], regions: regionCfg, mainSets, updatedAt: 'x' });
}
const bannedNames = (items: { id: string; banned_formats: string[] }[]) =>
  items.filter((i) => i.banned_formats.length).map((i) => cards.find((c) => c.id === i.id)!.name);

describe('regional ban rule (SPEC §1 Regions)', () => {
  it('content has the four announcements incl. the 2v2-only Master Yi', () => {
    expect(bans.map((b) => b.effective)).toEqual(['2026-03-31', '2026-07-24', '2026-09-18', '2026-11-23']);
    const yi = bans[1].bans.find((b) => b.cards.some((c) => c.name === 'Master Yi, Wuju Bladesman'))!;
    expect(yi.formats).toEqual(['2v2']);
  });

  it('global has every ban, including the November 23 ones', () => {
    const l = legality();
    const names = bannedNames(l.regions.global);
    expect(names).toHaveLength(allNames.length);
    for (const n of nov23.bans[0].cards) expect(names).toContain(n.replace(', ', ' - '));
    const yi = l.regions.global.find((i) => cards.find((c) => c.id === i.id)!.name === 'Master Yi - Wuju Bladesman')!;
    expect(yi).toMatchObject({ banned: false, banned_formats: ['2v2'] });
    const riven = l.regions.global.find((i) => cards.find((c) => c.id === i.id)!.name === 'Riven - Broken Blade')!;
    expect(riven).toMatchObject({ banned: true, banned_formats: ['standard', '2v2'] });
  });

  it('kr and tc (latest set OGN) have no bans at all', () => {
    const l = legality();
    expect(l.regions.kr).toEqual([]);
    expect(l.regions.tc).toEqual([]);
  });

  it("moving kr's latest set to RAD makes every ban apply there", () => {
    const l = legality({ ...regions, kr: { label: 'Korea', latest_set: 'RAD' } });
    expect(bannedNames(l.regions.kr)).toHaveLength(allNames.length);
    expect(l.regions.kr).toEqual(l.regions.global);
    expect(l.regions.tc).toEqual([]);
  });

  it('a region on VEN gets everything except the Radiance-season (Nov 23) bans', () => {
    const l = legality({ ...regions, kr: { label: 'Korea', latest_set: 'VEN' } });
    const names = bannedNames(l.regions.kr);
    for (const n of nov23.bans[0].cards) expect(names).not.toContain(n.replace(', ', ' - '));
    expect(names).toContain('Ekko - Recurrent');
    expect(names).toContain('Called Shot');
  });

  it('cutoff is the global release of the set after the region’s latest set', () => {
    expect(regionCutoff({ label: '', latest_set: 'OGN' }, mainSets)).toBe('2026-02-13');
    expect(regionCutoff({ label: '', latest_set: 'UNL' }, mainSets)).toBe('2026-07-31');
    expect(regionCutoff({ label: '', latest_set: 'RAD' }, mainSets)).toBeNull();
    expect(regionCutoff({ label: '', latest_set: 'latest' }, mainSets)).toBeNull();
    expect(() => regionCutoff({ label: '', latest_set: 'SGN' }, mainSets)).toThrow();
    expect(banAppliesIn({ effective: '2026-07-24' }, '2026-07-31')).toBe(true);
    expect(banAppliesIn({ effective: '2026-07-31' }, '2026-07-31')).toBe(false);
  });
});

describe('errata + applyLegality', () => {
  it('latest errata wins and attaches to every printing by name', () => {
    const a = card({ name: 'Foo - Bar' });
    const b = card({ name: 'Foo - Bar (Alternate Art)' });
    const l = computeLegality({
      cards: [a, b], announcements: [], mainSets, regions, updatedAt: 'x',
      errata: [
        { name: 'Foo, Bar', date: '2026-01-01', source: 's', text: 'new' },
        { name: 'Foo, Bar', date: '2025-01-01', source: 's', text: 'old' },
      ],
    });
    expect(l.regions.kr.map((i) => [i.id, i.errata, i.errata_date, i.banned])).toEqual([
      [a.id, 'new', '2026-01-01', false],
      [b.id, 'new', '2026-01-01', false],
    ]);
    const out = applyLegality(a, l.regions.kr[0]);
    expect(out.errata).toBe('new');
    expect('banned' in out).toBe(false);
  });
});
