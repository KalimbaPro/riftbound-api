/** Announcement listing → ban/errata article titles (for the new-article watcher). */
import { extractNextData } from './gallery.ts';

export interface ListedArticle { title: string; url: string; date: string }

export const WATCH = /ban list|bans\b|errata/i;

/** Walk the listing's __NEXT_DATA__ for {title, action.payload.url} cards. */
export function listArticles(html: string): ListedArticle[] {
  const seen = new Map<string, ListedArticle>();
  const walk = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    const action = r.action as { payload?: { url?: string } } | undefined;
    if (typeof r.title === 'string' && action?.payload?.url) {
      const url = new URL(action.payload.url, 'https://playriftbound.com').toString();
      seen.set(url, { title: r.title, url, date: String(r.publishedAt ?? '').slice(0, 10) });
    }
    Object.values(r).forEach(walk);
  };
  walk(extractNextData(html));
  return [...seen.values()];
}

const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase();

/** Ban/errata articles on the listing that no content file references yet. */
export function unknownArticles(listed: ListedArticle[], knownUrls: string[]): ListedArticle[] {
  const known = new Set(knownUrls.map(norm));
  return listed.filter((a) => WATCH.test(a.title) && !known.has(norm(a.url)));
}
