/** Contract checks on the committed, generated data (what the apps actually receive). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Card, CardSet, LegalityFile } from '../src/types.ts';

const cards = JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as Card[];
const sets = JSON.parse(readFileSync('public/data/sets.json', 'utf8')) as CardSet[];
const legality = JSON.parse(readFileSync('public/data/legality.json', 'utf8')) as LegalityFile;
const idMap = JSON.parse(readFileSync('data/id-map.json', 'utf8')) as Record<string, string>;

describe('generated data', () => {
  it('every card has the fields the apps decode', () => {
    for (const c of cards) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.name).toBe('string');
      expect(typeof c.riftbound_id).toBe('string');
      expect(Number.isInteger(c.collector_number)).toBe(true);
      expect(c.classification.type).toBeTruthy();
      expect(Array.isArray(c.classification.domain)).toBe(true);
      expect(c.set.set_id).toBeTruthy();
      expect(typeof c.metadata.alternate_art).toBe('boolean');
      expect('banned' in c).toBe(false); // legality is resolved per request, never baked in
    }
  });

  it('ids are unique and every id we minted is frozen in data/id-map.json', () => {
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    const minted = new Set(Object.values(idMap));
    const rad = cards.filter((c) => c.set.set_id === 'RAD');
    expect(rad.length).toBeGreaterThan(200);
    for (const c of rad) expect(minted.has(c.id)).toBe(true);
  });

  it('has Radiance and the promo sets', () => {
    for (const s of ['RAD', 'SGN', 'T1S', 'T1A']) expect(sets.find((x) => x.set_id === s)?.card_count).toBeGreaterThan(0);
    expect(cards.filter((c) => c.set.set_id === 'SGN').map((c) => c.riftbound_id)).toEqual(['sgn-001-003', 'sgn-002-003', 'sgn-003-003']);
  });

  it('legality: Nov 23 bans globally, nothing banned in kr/tc', () => {
    const name = (id: string) => cards.find((c) => c.id === id)!.name;
    const global = legality.regions.global.filter((i) => i.banned).map((i) => name(i.id));
    expect(global).toContain('Riven - Broken Blade');
    expect(global).toContain("Zhonya's Hourglass");
    expect(legality.regions.kr.some((i) => i.banned_formats.length)).toBe(false);
    expect(legality.regions.tc.some((i) => i.banned_formats.length)).toBe(false);
    expect(legality.updated_at).not.toContain('.');
  });

  it('keeps the two RiftCodex Ahri promo ids', () => {
    const pr = cards.find((c) => c.id === '69bc5beed308c64675ca89bb')!;
    expect(pr.riftbound_id).toBe('pr-066-298');
    expect(pr.media.image_url).toBe('/images/promo/pr-066-298-ahri-launch-exclusive.jpg');
    const opp = cards.find((c) => c.id === '69bc5befd308c64675ca89d0')!;
    expect(opp.name).toBe('Ahri - Nine-Tailed Fox (Release Event)');
  });
});
