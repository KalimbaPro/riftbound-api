import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemble, newId, ValidationError, type Sources } from '../scripts/lib/pipeline.ts';
import type { Content } from '../scripts/lib/content.ts';
import type { GalleryCard } from '../scripts/lib/gallery.ts';
import { card } from './helpers.ts';

const sample = JSON.parse(readFileSync('test/fixtures/gallery-sample.json', 'utf8')) as Record<string, GalleryCard[]>;

function fixture() {
  // RiftCodex has OGN-066 (with its real id) but no Radiance.
  const ahri = card({
    id: '69bc5bcad308c64675ca86fd', name: 'Ahri - Alluring', riftbound_id: 'ogn-066-298',
    set: { set_id: 'OGN', label: 'Origins' },
  });
  const sources: Sources = {
    riftcodexCards: [ahri],
    riftcodexSets: [{ id: '69bc5bf6e195be3e561d1eb1', name: 'Origins', set_id: 'OGN', card_count: 352,
      tcgplayer_id: null, cardmarket_id: null, published_on: '2025-10-31T00:00:00' }],
    gallery: {
      'en-us': sample['en-us'].filter((g) => ['ogn-066-298', 'rad-001-167', 'ogn-303-star-298', 'ogn-255-298'].includes(g.id)),
      'zh-cn': sample['zh-cn'],
      'ko-kr': sample['ko-kr'],
    },
  };
  const content: Content = {
    bans: [{ title: 'T', announced: '2026-03-30', effective: '2026-03-31', source: 's',
      bans: [{ formats: ['standard', '2v2'], cards: [{ name: 'Ahri, Alluring' }] }] }],
    errata: [{ name: 'Amateur Demolitionist', date: '2026-10-09', source: 's', text: 'New text' }],
    regions: { global: { label: 'G', latest_set: 'latest' }, kr: { label: 'K', latest_set: 'OGN' }, tc: { label: 'T', latest_set: 'OGN' } },
    sets: [
      { set_id: 'OGN', released: '2025-10-31', main: true },
      { set_id: 'RAD', name: 'Radiance', released: '2026-10-23', main: true },
      { set_id: 'SGN', name: 'Secret Garden', released: '2026-07-10', main: false },
    ],
    manualCards: [{ file: 'x.yaml', riftbound_id: 'sgn-001-003', set_id: 'SGN', base: 'ogn-066-298',
      collector_number: 1, rarity: 'Promo', image: '/images/promo/x.webp', artist: null,
      localized_images: { zh: '/images/promo/x-zh.webp' } }],
    overrides: [{ id: '69bc5bcad308c64675ca86fd', riftbound_id: 'ogn-066-298', set: { 'media.artist': 'Fixed' } }],
  };
  return { sources, content };
}
const prev = { idMap: {}, hashes: {}, now: '2026-11-14T10:00:00+00:00' };

describe('assemble()', () => {
  it('keeps RiftCodex ids, adds gallery cards with sha1 ids, and promos', () => {
    const { sources, content } = fixture();
    const r = assemble(sources, content, prev);
    const by = (rid: string) => r.dataset.cards.find((c) => c.riftbound_id === rid)!;
    expect(by('ogn-066-298').id).toBe('69bc5bcad308c64675ca86fd');
    expect(by('rad-001-167').id).toBe(newId('rad-001-167'));
    expect(by('rad-001-167').id).toMatch(/^[0-9a-f]{24}$/);
    expect(by('rad-001-167').new).toBe(true);
    expect(by('ogn-303*-298').metadata.signature).toBe(true);
    expect(r.idMap['rad-001-167']).toBe(newId('rad-001-167'));
    const promo = by('sgn-001-003');
    expect(promo).toMatchObject({ name: 'Ahri - Alluring', set: { set_id: 'SGN', label: 'Secret Garden' },
      classification: { rarity: 'Promo' }, media: { image_url: '/images/promo/x.webp' } });
    expect(by('ogn-066-298').media.artist).toBe('Fixed');
    expect(by('ogn-066-298').localizations?.zh?.name).toBe('阿狸 - 嫣然狐媚');
    expect(promo.localizations).toEqual({ zh: { ...by('ogn-066-298').localizations!.zh, image_url: '/images/promo/x-zh.webp' } });
    expect(r.dataset.sets.find((s) => s.set_id === 'OGN')!.card_count).toBe(3);
    expect(r.dataset.sets.find((s) => s.set_id === 'RAD')!.id).toBe(newId('set:RAD'));
  });

  it('never changes an id already in the id map', () => {
    const { sources, content } = fixture();
    const frozen = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const r = assemble(sources, content, { ...prev, idMap: { 'rad-001-167': frozen } });
    expect(r.dataset.cards.find((c) => c.riftbound_id === 'rad-001-167')!.id).toBe(frozen);
  });

  it('bans by name reach promos; region kr (OGN) is unaffected before SFD', () => {
    const { sources, content } = fixture();
    const r = assemble(sources, content, prev);
    const ids = r.dataset.legality.regions.global.filter((i) => i.banned).map((i) => i.riftbound_id).sort();
    expect(ids).toEqual(['ogn-066-298', 'sgn-001-003']);
    // This fixture has no SFD: the set after OGN is RAD, so a March ban predates the cutoff.
    expect(r.dataset.legality.regions.kr.filter((i) => i.banned)).toHaveLength(2);
    expect(r.dataset.legality.regions.global.find((i) => i.riftbound_id === 'rad-001-167')!.errata).toBe('New text');
  });

  it('updated_on is stable across identical rebuilds', () => {
    const { sources, content } = fixture();
    const a = assemble(sources, content, prev);
    const b = assemble(sources, content, { idMap: a.idMap, hashes: a.hashes, now: '2027-01-01T00:00:00+00:00' });
    expect(b.dataset.cards.find((c) => c.riftbound_id === 'rad-001-167')!.metadata.updated_on).toBe(prev.now);
    expect(b.dataset.legality.updated_at).toBe(prev.now);
  });

  it('fails loudly on unknown names, duplicate riftbound_ids and bad overrides', () => {
    const { sources, content } = fixture();
    content.bans[0].bans[0].cards.push({ name: 'No Such Card' });
    content.manualCards.push({ ...content.manualCards[0] });
    content.overrides.push({ id: '69bc5bcad308c64675ca86fd', riftbound_id: 'ogn-999-298', set: {} });
    try {
      assemble(sources, content, prev);
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const p = (e as ValidationError).problems.join('\n');
      expect(p).toContain('"No Such Card" matches no card');
      expect(p).toContain('duplicate riftbound_id sgn-001-003');
      expect(p).toContain('is ogn-066-298, not ogn-999-298');
    }
  });
});
