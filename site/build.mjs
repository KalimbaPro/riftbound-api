// Builds the ScanRift website from site/src into site/public.
//
// Pages are plain HTML with three placeholders, so the site needs no framework:
//   {{icon:name}}   a Phosphor icon from site/icons, inlined as SVG
//   {{header:page}} the shared header; `page` marks the current nav link
//   {{footer}}      the shared footer with the Riot Games disclaimer
// Every other file in site/src (CSS, riot.txt, the logo) is copied as is.
//
// For search engines and link previews, every page also gets a canonical URL and
// Open Graph / Twitter tags built from its own <title> and meta description, and the
// build writes sitemap.xml and robots.txt. SITE_URL is the one line to change when the
// site moves to its own domain.

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = dirname(fileURLToPath(import.meta.url));
const SRC = join(SITE, 'src');
const OUT = join(SITE, 'public');

const SITE_URL = 'https://scanrift.kalimbapro.workers.dev';
const ANDROID_REPO = 'https://github.com/KalimbaPro/ScanRiftAndroid';
const escapeAttr = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

/** Canonical URL and share-preview tags, inserted before </head>. */
function seoTags(html, path) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'ScanRift';
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  const url = SITE_URL + path;
  return `  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="ScanRift">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#141311" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)">
`;
}

const logo = (await readFile(join(SRC, 'icon.svg'), 'utf8')).trim();

async function icon(name) {
  const svg = await readFile(join(SITE, 'icons', `${name}.svg`), 'utf8');
  return svg.trim().replace('<svg ', '<svg class="icon" aria-hidden="true" focusable="false" ');
}

function header(page) {
  const link = (href, label, id) =>
    `<a href="${href}"${id === page ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="top wrap">
  <a class="brand" href="/">${logo.replace('<svg ', '<svg aria-hidden="true" ')}<span>ScanRift</span></a>
  <nav aria-label="Site">
    ${link('/support/', 'Support', 'support')}
    ${link('/privacy/', 'Privacy', 'privacy')}
    <a href="${ANDROID_REPO}">GitHub</a>
  </nav>
</header>`;
}

const footer = `<footer class="wrap">
  <div class="links">
    <a href="/">Home</a>
    <a href="/support/">Support</a>
    <a href="/privacy/">Privacy policy</a>
    <a href="${ANDROID_REPO}">Source code</a>
  </div>
  <p>ScanRift isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Riftbound, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
</footer>`;

async function render(html) {
  const icons = [...new Set([...html.matchAll(/\{\{icon:([a-z-]+)\}\}/g)].map((m) => m[1]))];
  for (const name of icons) html = html.replaceAll(`{{icon:${name}}}`, await icon(name));
  html = html.replace(/\{\{header:([a-z]+)\}\}/g, (_, page) => header(page));
  html = html.replaceAll('{{footer}}', footer);
  html = html.replaceAll('{{android_repo}}', ANDROID_REPO);
  html = html.replaceAll('{{logo}}', logo.replace('<svg ', '<svg class="mark" aria-hidden="true" '));
  const left = html.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`unreplaced placeholder ${left[0]}`);
  return html;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await walk(path) : [path]));
  }
  return out;
}

await rm(OUT, { recursive: true, force: true });
const pages = [];
for (const file of await walk(SRC)) {
  const rel = relative(SRC, file);
  const target = join(OUT, rel);
  await mkdir(dirname(target), { recursive: true });
  if (extname(file) !== '.html') {
    await cp(file, target);
    continue;
  }
  let html = await render(await readFile(file, 'utf8'));
  if (rel !== '404.html') {
    // site/src/privacy/index.html is served at /privacy/
    const path = '/' + rel.replace(/index\.html$/, '').split('\\').join('/');
    html = html.replace('</head>', seoTags(html, path) + '</head>');
    pages.push(path);
  }
  await writeFile(target, html);
}

const today = new Date().toISOString().slice(0, 10);
await writeFile(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.sort().map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`,
);
await writeFile(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log(`site built into ${relative(process.cwd(), OUT) || OUT}`);
