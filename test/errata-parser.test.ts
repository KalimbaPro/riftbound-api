import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { parseErrata, htmlToLines, type Article } from '../scripts/lib/articles.ts';
import { parseErrataDoc } from '../scripts/lib/content.ts';

const article = (slug: string): Article => JSON.parse(readFileSync(`test/fixtures/articles/${slug}.json`, 'utf8'));

describe('errata parser (official articles)', () => {
  const counts: [string, number][] = [
    ['riftbound-origins-card-errata', 31],
    ['riftbound-spiritforged-errata', 16],
    ['unleashed-errata-updates', 8],
    ['vendetta-errata-updates', 8],
    ['radiance-errata-updates', 4],
  ];
  it.each(counts)('%s yields %i entries', (slug, n) => {
    expect(parseErrata(article(slug))).toHaveLength(n);
  });

  it('keeps multi-line new text and drops section headings', () => {
    const sfd = parseErrata(article('riftbound-spiritforged-errata'));
    expect(sfd.map((e) => e.name)).not.toContain('Spiritforged Cards');
    const fs = sfd.find((e) => e.name === 'Falling Star')!;
    expect(fs.text).toBe('Deal 3 to a unit.\nDeal 3 to a unit.');
    expect(fs.old_text).toBe('Do this twice:\nDeal 3 to a unit. (You can choose different units.)');
  });

  it('parses the last entry of an article without swallowing the outro', () => {
    const neeko = parseErrata(article('radiance-errata-updates')).at(-1)!;
    expect(neeko.name).toBe('Neeko, Blending In');
    expect(neeko.text.split('\n')).toHaveLength(3);
    expect(neeko.text).toContain('choose up to 3 different legends');
  });

  it('decodes entities and <br>', () => {
    expect(htmlToLines('<p>A &amp; B<br/>C&#39;s</p>')).toEqual(['A & B', "C's"]);
  });

  it('content/errata.yaml holds every parsed entry with source urls', () => {
    const doc = parseErrataDoc(YAML.parse(readFileSync('content/errata.yaml', 'utf8')));
    expect(doc).toHaveLength(67);
    expect(new Set(doc.map((e) => e.source)).size).toBe(5);
    expect(doc.every((e) => e.source.startsWith('https://playriftbound.com/'))).toBe(true);
  });
});
