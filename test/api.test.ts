import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { Dataset } from '../src/types.ts';
import { card } from './helpers.ts';

const cards = [
  card({ name: 'Ahri - Alluring', riftbound_id: 'ogn-066-298', set: { set_id: 'OGN', label: 'Origins' }, collector_number: 66 }),
  card({ name: 'Ahri - Alluring (Alternate Art)', riftbound_id: 'ogn-066a-298', set: { set_id: 'OGN', label: 'Origins' }, collector_number: 66 }),
  card({ name: 'Blazing Scorcher', riftbound_id: 'ogn-001-298', set: { set_id: 'OGN', label: 'Origins' }, collector_number: 1,
    text: { rich: null, plain: 'Accelerate fire', flavour: null } }),
  ...Array.from({ length: 120 }, (_, i) => card({ name: `Radiant ${i}`, riftbound_id: `rad-${String(i + 1).padStart(3, '0')}-167`,
    set: { set_id: 'RAD', label: 'Radiance' }, collector_number: i + 1, attributes: { energy: i % 7, might: null, power: null } })),
  card({ name: 'Lillia - Bashful Bloom', riftbound_id: 'sgn-001-003', set: { set_id: 'SGN', label: 'Secret Garden' },
    media: { image_url: '/images/promo/sgn.webp', artist: null, accessibility_text: null } }),
];
const ahri = cards[0];
const data: Dataset = {
  cards,
  sets: [
    { id: 'a'.repeat(24), name: 'Origins', set_id: 'OGN', card_count: 3, tcgplayer_id: null, cardmarket_id: null, published_on: '2025-10-31T00:00:00' },
    { id: 'b'.repeat(24), name: 'Radiance', set_id: 'RAD', card_count: 120, tcgplayer_id: null, cardmarket_id: null, published_on: '2026-10-23T00:00:00' },
  ],
  legality: {
    updated_at: '2026-11-14T10:00:00+00:00',
    regions: {
      global: [{ id: ahri.id, riftbound_id: ahri.riftbound_id, banned: true, banned_formats: ['standard', '2v2'], errata: 'E', errata_date: '2025-10-28' }],
      kr: [{ id: ahri.id, riftbound_id: ahri.riftbound_id, banned: false, banned_formats: [], errata: 'E', errata_date: '2025-10-28' }],
      tc: [],
    },
  },
  version: { tag: '0123456789abcdef', generated_at: '2026-11-14T10:00:00+00:00', card_count: 3 },
};
const app = createApp(async () => data);
const get = async (path: string) => {
  const res = await app.request(`http://api.test${path}`);
  return { res, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe('RiftCodex-compatible endpoints', () => {
  it('/health', async () => {
    const { res, body } = await get('/health');
    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
  });

  it('/cards paginates with the RiftCodex envelope (default size 50, max 100)', async () => {
    const { body, res } = await get('/cards');
    expect(Object.keys(body)).toEqual(['items', 'total', 'page', 'size', 'pages']);
    expect(body).toMatchObject({ total: 124, page: 1, size: 50, pages: 3 });
    expect(body.items).toHaveLength(50);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect((await get('/cards?size=101')).res.status).toBe(422);
    expect((await get('/cards?page=0')).res.status).toBe(422);
    expect((await get('/cards?page=3&size=50')).body.items).toHaveLength(24);
  });

  it('set_id is case-insensitive; sort/dir work', async () => {
    const { body } = await get('/cards?set_id=rad&size=3&sort=collector_number&dir=-1');
    expect(body.total).toBe(120);
    expect(body.items.map((c: { collector_number: number }) => c.collector_number)).toEqual([120, 119, 118]);
    expect((await get('/cards?sort=bogus')).res.status).toBe(422);
  });

  it('search, name exact/fuzzy, riftbound prefix', async () => {
    expect((await get('/cards/search?query=ahri')).body.total).toBe(2);
    expect((await get('/cards/search?query=accelerate')).body.items[0].name).toBe('Blazing Scorcher');
    expect((await get('/cards/search')).res.status).toBe(422);
    expect((await get('/cards?search=ahri')).body.total).toBe(2);
    expect((await get('/cards/name?exact=ahri - alluring')).body.total).toBe(2);
    expect((await get('/cards/name?exact=Ahri, Alluring')).body.total).toBe(2);
    expect((await get('/cards/name?fuzzy=allur')).body.total).toBe(2);
    const { body } = await get('/cards/riftbound/OGN-066');
    expect(body.map((c: { riftbound_id: string }) => c.riftbound_id)).toEqual(['ogn-066-298', 'ogn-066a-298']);
  });

  it('/cards/{id} and 404s', async () => {
    expect((await get(`/cards/${ahri.id}`)).body.name).toBe('Ahri - Alluring');
    const nf = await get('/cards/nope');
    expect(nf.res.status).toBe(404);
    expect(nf.body.detail).toBeTruthy();
  });

  it('/sets, /sets/set-id, /sets/{id}', async () => {
    expect((await get('/sets')).body).toMatchObject({ total: 2, page: 1, size: 50, pages: 1 });
    expect((await get('/sets/set-id/rad')).body.name).toBe('Radiance');
    expect((await get(`/sets/${'a'.repeat(24)}`)).body.set_id).toBe('OGN');
    expect((await get('/sets/set-id/xyz')).res.status).toBe(404);
  });

  it('self-hosted image paths become absolute', async () => {
    const { body } = await get('/cards?set_id=SGN');
    expect(body.items[0].media.image_url).toBe('http://api.test/images/promo/sgn.webp');
  });
});

describe('legality and ?region=', () => {
  it('card endpoints resolve banned/errata for the region (default global)', async () => {
    const g = (await get(`/cards/${ahri.id}`)).body;
    expect(g).toMatchObject({ banned: true, banned_formats: ['standard', '2v2'], errata: 'E', errata_date: '2025-10-28' });
    const kr = (await get(`/cards/${ahri.id}?region=KR`)).body;
    expect('banned' in kr).toBe(false);
    expect(kr.errata).toBe('E');
    const tc = (await get(`/cards/${ahri.id}?region=tc`)).body;
    expect('errata' in tc).toBe(false);
    const list = (await get('/cards?set_id=OGN&sort=collector_number&region=global')).body.items;
    expect(list.find((c: { id: string }) => c.id === ahri.id).banned).toBe(true);
    expect((await get('/cards?region=eu')).res.status).toBe(422);
  });

  it('/version returns the data tag', async () => {
    const { res, body } = await get('/version');
    expect(res.status).toBe(200);
    expect(body).toEqual({ tag: '0123456789abcdef', generated_at: '2026-11-14T10:00:00+00:00', card_count: 3 });
  });

  it('/legality?region=', async () => {
    const { body } = await get('/legality?region=kr');
    expect(body).toEqual({ region: 'kr', updated_at: '2026-11-14T10:00:00+00:00', items: data.legality.regions.kr });
    expect((await get('/legality')).body.region).toBe('global');
    expect((await get('/legality?region=xx')).res.status).toBe(422);
  });
});
