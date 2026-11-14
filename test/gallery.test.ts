import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { flagsFromCode, localization, mapGalleryCard, riftboundIdFromGallery, type GalleryCard } from '../scripts/lib/gallery.ts';

const sample = JSON.parse(readFileSync('test/fixtures/gallery-sample.json', 'utf8')) as Record<string, GalleryCard[]>;
const en = (id: string) => sample['en-us'].find((g) => g.id === id)!;
const loc = (l: string, id: string) => sample[l].find((g) => g.id === id);

describe('gallery → RiftCodex schema', () => {
  it('normalises star ids', () => {
    expect(riftboundIdFromGallery('ogn-303-star-298')).toBe('ogn-303*-298');
    expect(riftboundIdFromGallery('rad-010-167')).toBe('rad-010-167');
  });

  it('derives flags from the printed code', () => {
    expect(flagsFromCode('OGN-066a/298')).toEqual({ alternate_art: true, overnumbered: false, signature: false });
    expect(flagsFromCode('OGN-303/298')).toEqual({ alternate_art: false, overnumbered: true, signature: false });
    expect(flagsFromCode('OGN-303*/298')).toEqual({ alternate_art: false, overnumbered: false, signature: true });
    expect(flagsFromCode('RAD-SP1/005')).toEqual({ alternate_art: false, overnumbered: false, signature: false });
    expect(flagsFromCode('UNL-T01').overnumbered).toBe(false);
    expect(flagsFromCode('RAD-R01a').alternate_art).toBe(true);
  });

  it('maps a Radiance unit', () => {
    const c = mapGalleryCard(en('rad-001-167'));
    expect(c).toMatchObject({
      name: 'Amateur Demolitionist',
      riftbound_id: 'rad-001-167',
      collector_number: 1,
      attributes: { energy: 2, might: 1, power: null },
      classification: { type: 'Unit', supertype: null, rarity: 'Common', domain: ['Chaos'] },
      set: { set_id: 'RAD', label: 'Radiance' },
      media: { artist: 'Kudos Productions' },
      metadata: { clean_name: 'Amateur Demolitionist', alternate_art: false, overnumbered: false, signature: false },
    });
    expect(c.text.plain).toBe(c.text.rich!.replace(/<[^>]+>/g, ''));
  });

  it('names legends "Champion - Title" with the variant suffix, like RiftCodex', () => {
    expect(mapGalleryCard(en('ogn-255-298')).name).toBe('Ahri - Nine-Tailed Fox');
    const sig = mapGalleryCard(en('ogn-303-star-298'));
    expect(sig.name).toBe('Ahri - Nine-Tailed Fox (Signature)');
    expect(sig.riftbound_id).toBe('ogn-303*-298');
    expect(sig.metadata.signature).toBe(true);
    expect(mapGalleryCard(en('ogn-066-298')).name).toBe('Ahri - Alluring');
  });

  it('runes have no "[NO TEXT]"; equipment has no might; effects are kept', () => {
    expect(mapGalleryCard(en('rad-r01a')).text.rich).toBeNull();
    expect(mapGalleryCard(en('sfd-161-221')).attributes.might).toBeNull();
    expect(mapGalleryCard(en('rad-150-167')).text.rich).toContain('[Ganking]');
  });

  it('localisations only carry what differs from English', () => {
    const zh = localization(en('ogn-066-298'), loc('zh-cn', 'ogn-066-298'))!;
    expect(zh.name).toBe('阿狸 - 嫣然狐媚');
    expect(zh.image_url).toMatch(/^https:/);
    const ko = localization(en('rad-001-167'), loc('ko-kr', 'rad-001-167'));
    // ko-kr serves English for Radiance: nothing to add.
    expect(ko?.image_url).toBeUndefined();
  });
});
