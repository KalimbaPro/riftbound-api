/**
 * npm run check-sources
 *
 * Looks for ban / errata articles on playriftbound.com that content/ does not reference
 * yet. Bans are editorial (dates, formats, regional clauses), so this never edits content;
 * it prints the new articles and, with --github-output, writes `new_articles` (markdown)
 * for the workflow to open an issue. Exit code 0 either way; 1 only on fetch/parse errors.
 */
import { appendFile, readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { listArticles, unknownArticles } from './lib/announcements.ts';
import { fetchText } from './lib/sources.ts';
import { ERRATA_ARTICLES } from './parse-errata.ts';

const LISTING = 'https://playriftbound.com/en-us/news/announcements/';

async function main() {
  const bans = YAML.parse(await readFile('content/bans.yaml', 'utf8')) as { announcements: { source: string }[] };
  const errata = YAML.parse(await readFile('content/errata.yaml', 'utf8')) as { errata: { source: string }[] };
  const known = [...bans.announcements.map((a) => a.source), ...errata.errata.map((e) => e.source), ...ERRATA_ARTICLES];

  const listed = listArticles(await fetchText(LISTING));
  if (!listed.length) throw new Error('announcement listing parsed to 0 articles — page layout changed?');
  const fresh = unknownArticles(listed, known);

  console.log(`${listed.length} articles listed, ${fresh.length} new ban/errata article(s)`);
  for (const a of fresh) console.log(`  NEW ${a.date} ${a.title} — ${a.url}`);

  const out = process.env.GITHUB_OUTPUT;
  if (process.argv.includes('--github-output') && out) {
    const body = fresh.map((a) => `- ${a.date} **${a.title}** — ${a.url}`).join('\n');
    await appendFile(out, `count=${fresh.length}\n`);
    await appendFile(out, `titles=${fresh.map((a) => a.title).join(' / ')}\n`);
    await appendFile(out, `new_articles<<EOF\n${body}\nEOF\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
