import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.ts';
import type { Dataset } from './types.ts';

const root = process.env.PUBLIC_DIR ?? join(process.cwd(), 'public');
const port = Number(process.env.PORT ?? 8787);

let cached: Promise<Dataset> | null = null;
const readJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(join(root, p), 'utf8')) as T;

/** Same app as the Worker; static files come from public/ like Workers Static Assets. */
export function loadFromDisk(): Promise<Dataset> {
  cached ??= Promise.all([
    readJson<Dataset['cards']>('data/cards.json'),
    readJson<Dataset['sets']>('data/sets.json'),
    readJson<Dataset['legality']>('data/legality.json'),
  ]).then(([cards, sets, legality]) => ({ cards, sets, legality }));
  return cached;
}

const server = new Hono();
server.use('/images/*', serveStatic({ root }));
server.use('/data/*', serveStatic({ root }));
server.route('/', createApp(() => loadFromDisk()));

process.on('SIGHUP', () => {
  cached = null; // reload data after a refresh without restarting
});

serve({ fetch: server.fetch, port }, (info) => console.log(`riftbound-api listening on :${info.port}`));
