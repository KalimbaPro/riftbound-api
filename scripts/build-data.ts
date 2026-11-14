/**
 * npm run build-data [-- --offline]
 *
 * RiftCodex (base, ids kept) + official gallery (whatever RiftCodex lacks, zh/ko
 * localisations) + content/*.yaml (bans, errata, regions, sets, promos, overrides)
 * → public/data/{cards,sets,legality}.json and dist/seed/cards.json.
 * Fails (exit 1) on any validation problem; nothing is written in that case.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Card } from '../src/types.ts';
import { applyLegality } from '../src/lib/legality.ts';
import { loadContent } from './lib/content.ts';
import { assemble, type HashState, type IdMap } from './lib/pipeline.ts';
import { gallery, offline, riftcodexCards, riftcodexSets } from './lib/sources.ts';

const ROOT = process.cwd();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://riftbound-api.kalimbapro.workers.dev';

async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  return existsSync(path) ? (JSON.parse(await readFile(path, 'utf8')) as T) : fallback;
}

/** One card per line: compact, yet a data change shows up as a one-line diff. */
const jsonLines = (items: unknown[]) => `[\n${items.map((i) => JSON.stringify(i)).join(',\n')}\n]\n`;
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Whole seconds, "+00:00" like RiftCodex's updated_on. */
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, '+00:00');

async function main() {
  console.log(`build-data${offline ? ' (offline)' : ''}`);
  const content = await loadContent();
  const [rcCards, rcSets, en, zh, ko] = await Promise.all([
    riftcodexCards(), riftcodexSets(), gallery('en-us'), gallery('zh-cn'), gallery('ko-kr'),
  ]);
  console.log(`sources: riftcodex ${rcCards.length} cards / ${rcSets.length} sets; gallery en ${en.length}, zh ${zh.length}, ko ${ko.length}`);

  const idMapPath = join(ROOT, 'data/id-map.json');
  const hashPath = join(ROOT, 'data/card-hashes.json');
  const result = assemble(
    { riftcodexCards: rcCards, riftcodexSets: rcSets, gallery: { 'en-us': en, 'zh-cn': zh, 'ko-kr': ko } },
    content,
    { idMap: await readJsonOr<IdMap>(idMapPath, {}), hashes: await readJsonOr<HashState>(hashPath, {}), now: nowIso() },
  );
  const { cards, sets, legality } = result.dataset;

  await mkdir(join(ROOT, 'public/data'), { recursive: true });
  await mkdir(join(ROOT, 'dist/seed'), { recursive: true });
  await writeFile(join(ROOT, 'public/data/cards.json'), jsonLines(cards));
  await writeFile(join(ROOT, 'public/data/sets.json'), pretty(sets));
  await writeFile(join(ROOT, 'public/data/legality.json'), pretty(legality));
  // The data tag: a hash of everything a client would see. legality.updated_at is left
  // out so a rebuild of identical data keeps its tag; generated_at likewise stays put
  // until the tag moves, so an unchanged nightly build produces no diff.
  const tag = createHash('sha256')
    .update(JSON.stringify({ cards, sets, regions: legality.regions }))
    .digest('hex')
    .slice(0, 16);
  const versionPath = join(ROOT, 'public/data/version.json');
  const previous = await readJsonOr<{ tag?: string; generated_at?: string }>(versionPath, {});
  const version = {
    tag,
    generated_at: previous.tag === tag && previous.generated_at ? previous.generated_at : nowIso(),
    card_count: cards.length,
  };
  await writeFile(versionPath, pretty(version));
  await writeFile(idMapPath, pretty(result.idMap));
  await writeFile(hashPath, pretty(result.hashes));

  // Offline seed for the apps: the RiftCodex envelope, every card, global legality,
  // absolute image URLs (the apps cannot resolve our relative /images paths).
  const global = new Map(legality.regions.global.map((i) => [i.id, i]));
  const seedCards: Card[] = cards.map((c) => {
    const out = applyLegality(c, global.get(c.id));
    const abs = (u: string | null | undefined) => (u && u.startsWith('/') ? PUBLIC_BASE_URL + u : u);
    out.media = { ...out.media, image_url: abs(out.media.image_url) ?? null };
    if (out.localizations) {
      out.localizations = Object.fromEntries(
        Object.entries(out.localizations).map(([k, l]) => [k, { ...l, image_url: abs(l.image_url) }]),
      );
    }
    return out;
  });
  await writeFile(
    join(ROOT, 'dist/seed/cards.json'),
    // `tag` (additive to the envelope) lets an app that just loaded this seed skip the
    // download on first launch when the live API is still on the same data.
    JSON.stringify({ items: seedCards, total: seedCards.length, page: 1, size: seedCards.length, pages: 1, tag }),
  );

  for (const line of result.report) console.log(`  ${line}`);
  const perSet = new Map<string, number>();
  for (const c of cards) perSet.set(c.set.set_id, (perSet.get(c.set.set_id) ?? 0) + 1);
  console.log(`  cards: ${cards.length} total — ${[...perSet].map(([s, n]) => `${s} ${n}`).join(', ')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
