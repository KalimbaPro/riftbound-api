import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { listArticles, unknownArticles } from '../scripts/lib/announcements.ts';

const html = readFileSync('test/fixtures/announcements.html', 'utf8');

describe('announcement watcher', () => {
  it('lists articles with absolute urls', () => {
    const a = listArticles(html);
    expect(a.length).toBeGreaterThan(20);
    expect(a.find((x) => x.title.startsWith('Radiance Ban List'))?.url)
      .toBe('https://playriftbound.com/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026');
  });

  it('flags only ban/errata titles that content does not reference', () => {
    const listed = listArticles(html);
    const all = unknownArticles(listed, []);
    expect(all.map((a) => a.title)).toEqual(expect.arrayContaining([
      'Radiance Ban List Updates (Effective November 23, 2026)', 'Radiance Errata Updates', 'July Ban List Updates',
    ]));
    expect(all.some((a) => /Merch/.test(a.title))).toBe(false);
    const known = all.filter((a) => !a.title.startsWith('Radiance Ban')).map((a) => `${a.url}/`);
    expect(unknownArticles(listed, known).map((a) => a.title)).toEqual(['Radiance Ban List Updates (Effective November 23, 2026)']);
  });
});
