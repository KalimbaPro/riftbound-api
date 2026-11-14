import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Card, Dataset, LegalityItem, Region } from './types.ts';
import { REGIONS } from './types.ts';
import { applyLegality } from './lib/legality.ts';
import {
  QueryError, byExactName, byFuzzyName, filterAndSort, paginate, search, type ListParams,
} from './lib/query.ts';

export type DataLoader = (c: Context) => Promise<Dataset>;

interface Indexed {
  data: Dataset;
  byId: Map<string, Card>;
  legality: Record<Region, Map<string, LegalityItem>>;
}

const indexCache = new WeakMap<Dataset, Indexed>();
function indexed(data: Dataset): Indexed {
  let ix = indexCache.get(data);
  if (!ix) {
    const legality = {} as Indexed['legality'];
    for (const r of REGIONS) {
      legality[r] = new Map((data.legality.regions[r] ?? []).map((i) => [i.id, i]));
    }
    ix = { data, byId: new Map(data.cards.map((c) => [c.id, c])), legality };
    indexCache.set(data, ix);
  }
  return ix;
}

function regionParam(c: Context): Region {
  const r = (c.req.query('region') ?? 'global').toLowerCase();
  if (!(REGIONS as readonly string[]).includes(r)) {
    throw new QueryError(`region must be one of ${REGIONS.join(', ')}`);
  }
  return r as Region;
}

function absolute(url: string | null | undefined, origin: string): string | null | undefined {
  return url && url.startsWith('/') ? origin + url : url;
}

/** Region-resolved legality + absolute URLs for images we host ourselves. */
function present(card: Card, ix: Indexed, region: Region, origin: string): Card {
  const out = applyLegality(card, ix.legality[region].get(card.id));
  if (out.media.image_url?.startsWith('/')) {
    out.media = { ...out.media, image_url: absolute(out.media.image_url, origin) ?? null };
  }
  if (out.localizations) {
    const locs: Card['localizations'] = {};
    for (const [lang, l] of Object.entries(out.localizations)) {
      locs[lang] = { ...l, image_url: absolute(l.image_url, origin) };
    }
    out.localizations = locs;
  }
  return out;
}

function listParams(c: Context): ListParams {
  const q = c.req.query();
  return { page: q.page, size: q.size, sort: q.sort, dir: q.dir, set_id: q.set_id, new: q.new };
}

export function createApp(load: DataLoader, opts: { cacheSeconds?: number } = {}) {
  const app = new Hono();
  const maxAge = opts.cacheSeconds ?? 3600;

  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'OPTIONS'] }));
  app.use('*', async (c, next) => {
    await next();
    if (c.res.status === 200 && !c.res.headers.has('Cache-Control')) {
      c.header('Cache-Control', `public, max-age=${maxAge}`);
    }
  });

  app.onError((err, c) => {
    if (err instanceof QueryError) return c.json({ detail: err.message }, err.status);
    console.error(err);
    return c.json({ detail: 'Internal Server Error' }, 500);
  });
  app.notFound((c) => c.json({ detail: 'Not Found' }, 404));

  const withData = async (c: Context) => indexed(await load(c));
  const origin = (c: Context) => new URL(c.req.url).origin;

  const cardPage = (c: Context, ix: Indexed, cards: Card[]) => {
    const region = regionParam(c);
    const page = paginate(filterAndSort(cards, listParams(c)), listParams(c));
    const o = origin(c);
    return c.json({ ...page, items: page.items.map((card) => present(card, ix, region, o)) });
  };

  app.get('/', (c) =>
    c.json({
      name: 'riftbound-api',
      description: 'RiftCodex-compatible Riftbound card API with bans, errata and regional legality.',
      endpoints: ['/cards', '/cards/search', '/cards/name', '/cards/{id}', '/cards/riftbound/{riftbound_id}',
        '/sets', '/sets/set-id/{set_id}', '/sets/{id}', '/legality', '/health'],
    }),
  );

  app.get('/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'healthy', timestamp: Date.now() / 1000 });
  });

  app.get('/cards', async (c) => {
    const ix = await withData(c);
    // `search` is not a RiftCodex parameter, but the Android client sends it.
    const q = c.req.query('search');
    return cardPage(c, ix, q ? search(ix.data.cards, q) : ix.data.cards);
  });

  app.get('/cards/search', async (c) => {
    const query = c.req.query('query');
    if (!query) throw new QueryError('query is required');
    const ix = await withData(c);
    return cardPage(c, ix, search(ix.data.cards, query));
  });

  app.get('/cards/name', async (c) => {
    const ix = await withData(c);
    const exact = c.req.query('exact');
    const fuzzy = c.req.query('fuzzy');
    if (!exact && !fuzzy) throw new QueryError('exact or fuzzy is required');
    const cards = exact ? byExactName(ix.data.cards, exact) : byFuzzyName(ix.data.cards, fuzzy!);
    return cardPage(c, ix, cards);
  });

  app.get('/cards/riftbound/:rid', async (c) => {
    const ix = await withData(c);
    const region = regionParam(c);
    const rid = c.req.param('rid').toLowerCase();
    const hits = ix.data.cards.filter((card) => card.riftbound_id.toLowerCase().startsWith(rid));
    const o = origin(c);
    return c.json(hits.map((card) => present(card, ix, region, o)));
  });

  app.get('/cards/:id', async (c) => {
    const ix = await withData(c);
    const card = ix.byId.get(c.req.param('id'));
    if (!card) throw new QueryError('Card not found', 404);
    return c.json(present(card, ix, regionParam(c), origin(c)));
  });

  app.get('/sets', async (c) => {
    const ix = await withData(c);
    return c.json(paginate(ix.data.sets, listParams(c)));
  });

  app.get('/sets/set-id/:setId', async (c) => {
    const ix = await withData(c);
    const want = c.req.param('setId').toUpperCase();
    const set = ix.data.sets.find((s) => s.set_id.toUpperCase() === want);
    if (!set) throw new QueryError('Set not found', 404);
    return c.json(set);
  });

  app.get('/sets/:id', async (c) => {
    const ix = await withData(c);
    const set = ix.data.sets.find((s) => s.id === c.req.param('id'));
    if (!set) throw new QueryError('Set not found', 404);
    return c.json(set);
  });

  app.get('/legality', async (c) => {
    const ix = await withData(c);
    const region = regionParam(c);
    return c.json({
      region,
      updated_at: ix.data.legality.updated_at,
      items: ix.data.legality.regions[region] ?? [],
    });
  });

  return app;
}
