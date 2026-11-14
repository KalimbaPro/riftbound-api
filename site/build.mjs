// Builds the ScanRift website from site/src into site/public.
//
// Pages are plain HTML with three placeholders, so the site needs no framework:
//   {{icon:name}}   a Phosphor icon from site/icons, inlined as SVG
//   {{header:page}} the shared header; `page` marks the current nav link
//   {{footer}}      the shared footer with the Riot Games disclaimer
// Every other file in site/src (CSS, riot.txt, the logo) is copied as is.

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = dirname(fileURLToPath(import.meta.url));
const SRC = join(SITE, 'src');
const OUT = join(SITE, 'public');

const ANDROID_REPO = 'https://github.com/KalimbaPro/ScanRiftAndroid';

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
for (const file of await walk(SRC)) {
  const target = join(OUT, relative(SRC, file));
  await mkdir(dirname(target), { recursive: true });
  if (extname(file) === '.html') await writeFile(target, await render(await readFile(file, 'utf8')));
  else await cp(file, target);
}
console.log(`site built into ${relative(process.cwd(), OUT) || OUT}`);
