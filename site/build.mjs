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

const SITE_URL = 'https://scanrift.lol';
const ANDROID_REPO = 'https://github.com/KalimbaPro/ScanRiftAndroid';
const escapeAttr = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

// English pages live at the root, French ones under /fr/ with the same slugs, so a
// page's counterpart is always its path with the /fr prefix added or removed.
const LANGS = ['en', 'fr'];
const OG_LOCALE = { en: 'en_US', fr: 'fr_FR' };
const pathIn = (path, lang) => (lang === 'fr' ? '/fr' + path : path);

const T = {
  en: {
    support: 'Support', privacy: 'Privacy', home: 'Home', privacyPolicy: 'Privacy policy', source: 'Source code',
    switchLabel: 'Français', switchTitle: 'Lire cette page en français',
    disclaimer: "ScanRift isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Riftbound, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.",
  },
  fr: {
    support: 'Aide', privacy: 'Confidentialité', home: 'Accueil', privacyPolicy: 'Politique de confidentialité', source: 'Code source',
    switchLabel: 'English', switchTitle: 'Read this page in English',
    disclaimer: "ScanRift n'est pas approuvé par Riot Games et ne reflète pas les opinions ou les points de vue de Riot Games ou de quiconque officiellement impliqué dans la production ou la gestion des propriétés de Riot Games. Riot Games, Riftbound et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.",
  },
};

/** Canonical URL, language alternates and share-preview tags, inserted before </head>. */
function seoTags(html, path, lang) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'ScanRift';
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  const url = SITE_URL + pathIn(path, lang);
  const alternates = LANGS.map((l) => `  <link rel="alternate" hreflang="${l}" href="${SITE_URL}${pathIn(path, l)}">`).join('\n');
  return `  <link rel="canonical" href="${url}">
${alternates}
  <link rel="alternate" hreflang="x-default" href="${SITE_URL}${path}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="ScanRift">
  <meta property="og:locale" content="${OG_LOCALE[lang]}">
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

/** `path` is the page's language-neutral path ("/privacy/"); the switch links to its counterpart. */
function header(page, lang, path) {
  const t = T[lang];
  const other = lang === 'fr' ? 'en' : 'fr';
  const link = (href, label, id) =>
    `<a href="${pathIn(href, lang)}"${id === page ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="top wrap">
  <a class="brand" href="${pathIn('/', lang)}">${logo.replace('<svg ', '<svg aria-hidden="true" ')}<span>ScanRift</span></a>
  <nav aria-label="Site">
    ${link('/support/', t.support, 'support')}
    ${link('/privacy/', t.privacy, 'privacy')}
    <a href="${ANDROID_REPO}">GitHub</a>
    <a class="lang" href="${pathIn(path, other)}" hreflang="${other}" lang="${other}" title="${t.switchTitle}">${t.switchLabel}</a>
  </nav>
</header>`;
}

function footer(lang) {
  const t = T[lang];
  return `<footer class="wrap">
  <div class="links">
    <a href="${pathIn('/', lang)}">${t.home}</a>
    <a href="${pathIn('/support/', lang)}">${t.support}</a>
    <a href="${pathIn('/privacy/', lang)}">${t.privacyPolicy}</a>
    <a href="${ANDROID_REPO}">${t.source}</a>
  </div>
  <p>${t.disclaimer}</p>
</footer>`;
}

async function render(html, lang, path) {
  const icons = [...new Set([...html.matchAll(/\{\{icon:([a-z-]+)\}\}/g)].map((m) => m[1]))];
  for (const name of icons) html = html.replaceAll(`{{icon:${name}}}`, await icon(name));
  html = html.replace(/\{\{header:([a-z]+)\}\}/g, (_, page) => header(page, lang, path));
  html = html.replaceAll('{{footer}}', footer(lang));
  html = html.replaceAll('{{android_repo}}', ANDROID_REPO);
  html = html.replaceAll('{{site_url}}', SITE_URL);
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
const pages = new Set();
for (const file of await walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/');
  const target = join(OUT, rel);
  await mkdir(dirname(target), { recursive: true });
  if (extname(file) !== '.html') {
    await cp(file, target);
    continue;
  }
  const lang = rel.startsWith('fr/') ? 'fr' : 'en';
  // site/src/fr/privacy/index.html → language-neutral path /privacy/
  const path = '/' + rel.replace(/^fr\//, '').replace(/index\.html$/, '').replace(/404\.html$/, '');
  let html = await render(await readFile(file, 'utf8'), lang, path);
  if (!rel.endsWith('404.html')) {
    html = html.replace('</head>', seoTags(html, path, lang) + '</head>');
    pages.add(path);
  }
  await writeFile(target, html);
}

// Every page must exist in every language, or the alternates and the switch would 404.
for (const path of pages) {
  for (const lang of LANGS) {
    const file = join(OUT, pathIn(path, lang), 'index.html');
    await readFile(file).catch(() => {
      throw new Error(`${pathIn(path, lang)} is missing its ${lang} page`);
    });
  }
}

const today = new Date().toISOString().slice(0, 10);
const urls = [...pages].sort().flatMap((path) =>
  LANGS.map((lang) => {
    const alts = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}${pathIn(path, l)}"/>`).join('\n');
    return `  <url>
    <loc>${SITE_URL}${pathIn(path, lang)}</loc>
    <lastmod>${today}</lastmod>
${alts}
  </url>`;
  }),
);
await writeFile(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`,
);
await writeFile(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log(`site built into ${relative(process.cwd(), OUT) || OUT}: ${pages.size} pages × ${LANGS.length} languages`);
