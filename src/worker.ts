import { createApp } from './app.ts';
import type { Dataset } from './types.ts';

interface Env {
  ASSETS: Fetcher;
}

let cached: Promise<Dataset> | null = null;

async function readJson<T>(env: Env, path: string): Promise<T> {
  const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
  if (!res.ok) throw new Error(`asset ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The catalogue ships as static assets; each isolate loads it once. */
const app = createApp((c) => {
  const env = c.env as Env;
  cached ??= Promise.all([
    readJson<Dataset['cards']>(env, '/data/cards.json'),
    readJson<Dataset['sets']>(env, '/data/sets.json'),
    readJson<Dataset['legality']>(env, '/data/legality.json'),
  ])
    .then(([cards, sets, legality]) => ({ cards, sets, legality }))
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
});

export default app;
