/** Official news articles (playriftbound.com): __NEXT_DATA__ → text lines → errata entries. */
import { extractNextData } from './gallery.ts';

export interface Article {
  url: string;
  title: string;
  publishDate: string;
  bodies: string[]; // articleRichText HTML bodies, in page order
}

export function articleFromHtml(html: string): Article {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = (extractNextData(html) as any).props.pageProps.page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blades: any[] = page.blades;
  const mast = blades.find((b) => b.type === 'articleMasthead');
  return {
    url: page.url,
    title: mast?.title ?? '',
    publishDate: mast?.publishDate ?? '',
    bodies: blades.filter((b) => b.type === 'articleRichText').map((b) => b.richText.body as string),
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Block-level HTML to trimmed, non-empty text lines. */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter(Boolean);
}

export interface ParsedErrata {
  name: string;
  text: string;
  old_text: string;
}

const NEW = /^\[NEW TEXT\]$/i;
const OLD = /^\[OLD TEXT\]$/i;
const ARROW = /^▲$/;
const SECTION = /^[\w’' ]+ Cards$/;

/**
 * Errata articles all use the shape
 *   <Card Name> / [NEW TEXT] / new lines… / ▲ / [OLD TEXT] / old lines…
 * with optional "<Set> Cards" section headings between entries.
 */
export function parseErrata(article: Article): ParsedErrata[] {
  const lines = article.bodies.flatMap(htmlToLines);
  const starts = lines.map((l, i) => (NEW.test(l) ? i : -1)).filter((i) => i >= 0);
  const out: ParsedErrata[] = [];
  starts.forEach((start, n) => {
    const name = lines[start - 1];
    if (!name || SECTION.test(name) || ARROW.test(name)) {
      throw new Error(`${article.url}: no card name before [NEW TEXT] at line ${start}`);
    }
    const arrow = lines.findIndex((l, i) => i > start && ARROW.test(l));
    const oldHeader = lines.findIndex((l, i) => i > start && OLD.test(l));
    if (arrow < 0 || oldHeader < 0) throw new Error(`${article.url}: unterminated errata for ${name}`);
    const next = starts[n + 1];
    // Old text runs to the next entry's name line, minus any section heading in between.
    let end = next === undefined ? lines.length : next - 1;
    let oldLines = lines.slice(oldHeader + 1, end);
    while (oldLines.length && SECTION.test(oldLines[oldLines.length - 1])) oldLines = oldLines.slice(0, -1);
    if (next === undefined) {
      // The last entry is followed by the article outro; old text is at most as long as
      // the new text plus a few lines, so cut at the first blank-ish prose break.
      const newLen = arrow - start - 1;
      oldLines = oldLines.slice(0, Math.max(newLen + 2, 1));
    }
    out.push({
      name: name.replace(/\s+/g, ' '),
      text: lines.slice(start + 1, arrow).join('\n'),
      old_text: oldLines.join('\n'),
    });
  });
  return out;
}
