# riftbound-api

Self-hosted Riftbound TCG card API for the ScanRift iOS/Android apps. It mirrors
[api.riftcodex.com](https://api.riftcodex.com/docs) (same paths, parameters, envelope and card
schema), so the apps only change their base URL, and adds:

- **Radiance** (RAD) and every other card RiftCodex lacks, from Riot's official card gallery
- **bans** (Standard and 2v2) and **official errata**, attached to every printing of a card
- **regional legality** (`global`, `kr`, `tc`)
- **zh / ko localisations** (names, text, localised images)
- **promo cards** RiftCodex does not have (Secret Garden, T1, Korea-exclusive Ahri, …)

There is no database: `npm run build-data` generates JSON under `public/data/`, and a tiny
[Hono](https://hono.dev) app serves it. The same code runs on **Cloudflare Workers** (catalogue
and images as Workers Static Assets) and on **Node in Docker**.

## Endpoints

| Path | Notes |
|---|---|
| `GET /cards?page&size&set_id&sort&dir&new` | `size` 1–100 (default 50); `set_id` case-insensitive; `sort` = name, collector_number, public_code, type, supertype, rarity, domain, artist, set_id, set_label, energy, might, power; `dir` 1 / -1 |
| `GET /cards/search?query=` | words matched against name, text, tags, type and code |
| `GET /cards/name?exact=` / `?fuzzy=` | case-insensitive; `exact` also accepts "Name, Title" for "Name - Title" |
| `GET /cards/{id}` | 404 `{"detail": …}` if unknown |
| `GET /cards/riftbound/{riftbound_id}` | case-insensitive prefix match, returns an array |
| `GET /sets`, `/sets/set-id/{set_id}`, `/sets/{id}` | |
| `GET /legality?region=global\|kr\|tc` | every card banned **or** errata'd in that region |
| `GET /health` | |

All card endpoints accept `?region=` (default `global`). Responses are CORS-open and cached
for an hour (`Cache-Control: public, max-age=3600`); `/health` is `no-store`. Bad parameters
return 422 `{"detail": "…"}`.

Card JSON is RiftCodex's plus these optional fields (absent ⇒ false / null):

```json
"banned": true,
"banned_formats": ["standard", "2v2"],
"errata": "Full new text of the card",
"errata_date": "2026-10-09",
"localizations": { "zh": {"name": "…", "text": "…", "image_url": "…"}, "ko": { … } }
```

`banned` means banned in Standard; a card banned only in 2v2 (Master Yi, Wuju Bladesman) has
`banned_formats: ["2v2"]` and no `banned: true`. Card `id`s are stable forever: RiftCodex's are
kept; cards RiftCodex lacks get `sha1(riftbound_id)` hex[:24], frozen in `data/id-map.json`.
Images we host ourselves (promos) are stored as `/images/…` and returned as absolute URLs.

## How the data is built

`npm run build-data` (add `-- --offline` to rebuild from `.cache/` without network):

1. **RiftCodex** — all `/sets` and `/cards`, ids kept. (RiftCodex repeats some
   `riftbound_id`s — Vendetta double-imports, OPP metal variants. They are kept as-is so no
   user's collection loses a foreign key; every card *we* add must be unique.)
2. **Official gallery** `playriftbound.com/en-us/card-gallery/` (`__NEXT_DATA__` →
   `props.pageProps.page.blades[*].cards.items`) — every card RiftCodex lacks is mapped to the
   RiftCodex schema (`scripts/lib/gallery.ts`): `riftbound_id` from the gallery id
   (`ogn-303-star-298` → `ogn-303*-298`), alt-art / signature / overnumbered flags from the
   printed code, rich + plain text, domains, rarity, type/supertype, tags, clean name, media.
3. **zh-cn and ko-kr galleries** → `localizations` (only what differs from English).
4. **content/** (hand-edited YAML, below) — promos, overrides, bans, errata, regions.
5. **Validation**, failing the build loudly: unique ids, unique `riftbound_id`s for everything
   we add, schema, every ban/errata name resolves to ≥ 1 card, regions point at main sets.
6. **Output**: `public/data/cards.json` (one card per line, so diffs are readable),
   `sets.json`, `legality.json` (pre-resolved per region), `data/id-map.json`,
   `data/card-hashes.json` (our cards' `updated_on` only moves when their content changes, so a
   no-op nightly build commits nothing), and **`dist/seed/cards.json`** — the RiftCodex envelope
   with every card and global legality, for the apps' offline bundle (`res/raw/cards.json` on
   Android, the bundled `cards.json` on iOS).

## Editing content

Everything editorial lives in `content/`. Push to `main` and the `refresh-data` workflow
rebuilds, validates, commits the data and deploys. Locally: `npm run build-data && npm test`.

### Adding a ban announcement — `content/bans.yaml`

Append an entry:

```yaml
  - title: Some Ban List Update
    announced: "2027-01-08"        # article date (quote dates)
    effective: "2027-01-12"        # drives the regional rule
    source: https://playriftbound.com/en-us/news/announcements/…/
    bans:
      - formats: [standard, 2v2]   # 2v2 = "the Standard list plus…", so list both
        cards: [Some Card, "Champion, Title"]
      - formats: [2v2]             # 2v2-only bans
        cards: [Other Legend, Its Title]
```

Names are written as in the article; matching ignores case, punctuation and
"Name, Title" vs "Name - Title", and Legends also answer to their title alone. If a name
doesn't resolve the build tells you; write `{ name: Article Spelling, match: Catalogue Name }`.
A ban attaches to every printing with that name (alt art, overnumbered, signature, promo).

### Adding errata — `content/errata.yaml`

Add the article URL to `ERRATA_ARTICLES` in `scripts/parse-errata.ts`, then
`npm run parse-errata` (it regenerates the file from all articles; `match:` fields you added by
hand survive). Or add an entry by hand: `name`, `date`, `source`, `text`. The latest-dated
entry for a card wins. Save the article as a test fixture if you want the parser test to cover
it: see `test/fixtures/articles/`.

### A set releasing in a region — `content/regions.yaml`

Riot (2026-11-13): a region behind the global schedule uses the global ban list **as it stood
at the end of the season of the latest set released there**. Formally: a ban applies in a
region iff its `effective` date is before the **global** `released` date (`content/sets.yaml`)
of the main set following the region's `latest_set`. `latest` = always the newest set.

When Spiritforged releases in Korea, change one line: `kr: latest_set: SFD`. Today
`kr` and `tc` are on `OGN`, so nothing is banned there (the first bans are from 2026-03-31,
after Spiritforged's global release on 2026-02-13).

When a new main set releases **globally**, add it to `content/sets.yaml` with `main: true` and
its global release date (needed for the rule above).

### Adding a promo card — `content/cards/*.yaml`

```yaml
set_id: SGN                       # default for the file; sets.yaml needs a name for new sets
cards:
  - riftbound_id: sgn-001-003     # printed code lower-cased: "SGN • 001/003" → sgn-001-003
    base: unl-189-219             # the card it reprints: gameplay fields are copied from it
    name: Lillia - Bashful Bloom  # optional (default: base name without "(…)" suffix)
    collector_number: 1
    rarity: Promo
    flags: { alternate_art: false, overnumbered: false, signature: false }
    image: /images/promo/sgn-001-003-lillia.webp   # file in public/images/promo/, or https://…
    artist: null
    sources: [https://…]
    # disabled: true              # keep an unverified card documented but out of the data
```

The apps derive the scannable code from `riftbound_id` (`sgn-001-003` → `SGN-001/003`), so
use the printed code. Images go in `public/images/promo/`.

### Fixing an upstream card — `content/overrides.yaml`

`id` + expected `riftbound_id` + dotted paths, e.g. `media.image_url`. Ids are never changed.

## Local development

```bash
npm install
npm run build-data          # or: npm run build-data -- --offline
npm test                    # vitest
npm run typecheck
npx wrangler dev            # Worker + static assets on http://localhost:8787
npm start                   # same app on Node (PORT=8787)
npm run check-sources       # list ban/errata articles not referenced by content/
```

```bash
curl localhost:8787/health
curl 'localhost:8787/cards?set_id=RAD&size=3'
curl 'localhost:8787/legality?region=kr'
```

## Deploying to Cloudflare (workers.dev) — checklist

1. Create a free Cloudflare account. Workers → pick your `*.workers.dev` subdomain
   (e.g. `kalimbapro` → `https://riftbound-api.kalimbapro.workers.dev`).
2. Locally: `npx wrangler login`, then `npx wrangler deploy` once. It uploads the Worker
   (`src/worker.ts`) plus `public/` as static assets (data ≈ 3 MB, promo images ≈ 2 MB; the
   per-file limit is 25 MB).
3. If your subdomain is not `kalimbapro`, update `PUBLIC_BASE_URL` in `wrangler.toml` and the
   default in `scripts/build-data.ts` (used for absolute image URLs in the seed file).
4. Dashboard → My Profile → API Tokens → **Create Token** → template **Edit Cloudflare
   Workers** → copy the token. Account ID: Workers & Pages overview, right column.
5. GitHub repo → Settings → Secrets and variables → Actions → add `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. Until they exist, the deploy steps are skipped with a warning.
6. Workflows (Actions tab — enable if prompted):
   - `ci.yml` — typecheck + tests on every push / PR
   - `deploy.yml` — `wrangler deploy` on every push to `main`
   - `refresh-data.yml` — nightly (and on `content/**` changes): rebuild, test, commit if the
     data changed, deploy
   - `check-sources.yml` — every 6 h: opens an issue when playriftbound.com publishes a ban or
     errata article that `content/` does not reference
7. Optional custom domain: Workers & Pages → `riftbound-api` → Settings → Domains & Routes →
   add `api.<your-domain>` (the domain must be on Cloudflare).
8. Put the final URL in both apps (`Constants.API.baseURL` on iOS, `Constants.Api.BASE_URL` on
   Android) and copy `dist/seed/cards.json` into both apps' bundled catalogue.
9. Smoke test: `/health`, `/sets`, `/cards?set_id=RAD&size=5`, `/legality?region=kr`.
10. Free plan: 100k requests/day, which is far more than the apps need (a few requests per
    update check per user; responses are edge-cacheable for an hour).

## Alternative: kalimba-nas (Docker)

```bash
ssh kalimbapro@kalimba-nas
cd /opt/stacks && git clone git@github.com:KalimbaPro/riftbound-api.git && cd riftbound-api
docker compose up -d --build          # listens on 127.0.0.1:8787 only
curl localhost:8787/health
```

Expose it publicly with a **Cloudflare Tunnel** (recommended: no port forwarding, TLS and
caching for free): Cloudflare Zero Trust → Networks → Tunnels → create a tunnel → public
hostname `api.<your-domain>` → service `http://api:8787`; put the token in `.env` as
`TUNNEL_TOKEN=…` and run `docker compose --profile tunnel up -d`. The alternative is your
reverse proxy + a router port forward + a TLS certificate.

Data updates: keep the nightly build in GitHub Actions and pull it on the NAS, e.g. a host cron
`git -C /opt/stacks/riftbound-api pull -q && docker compose -f /opt/stacks/riftbound-api/compose.yaml kill -s HUP api`
(`public/` is bind-mounted; SIGHUP reloads the JSON without a restart). The container
healthcheck hits `/health` every 5 minutes and logs nothing to disk. Then follow steps 8–9
above with your tunnel hostname.

## Website (ScanRift landing page)

`site/` holds the app's public website: the landing page, the privacy policy and the
support page that the App Store and Google Play listings link to, plus Riot's
`riot.txt` verification file at the root. It is plain HTML with a tiny build step that
inlines Phosphor icons (`site/icons/`) and the shared header and footer:

```bash
node site/build.mjs                          # site/src → site/public
npx wrangler dev --config site/wrangler.toml # preview locally
```

The Deploy workflow publishes it as a second, assets-only Worker named `scanrift`
(`https://scanrift.kalimbapro.workers.dev`) with the same Cloudflare secrets. Edit the
pages in `site/src/`; the privacy policy's date lives at the top of
`site/src/privacy/index.html`.

## Repository layout

```
src/            app.ts (Hono routes), worker.ts (Cloudflare), node.ts (Docker/Node), lib/ (pure)
scripts/        build-data.ts, parse-errata.ts, check-sources.ts, lib/ (gallery mapper, pipeline, …)
content/        bans.yaml errata.yaml regions.yaml sets.yaml overrides.yaml cards/*.yaml
data/           id-map.json (frozen ids), card-hashes.json (updated_on tracking)
public/         data/*.json (generated) and images/promo/ — served as static assets
dist/seed/      cards.json — offline seed for the apps
test/           vitest + fixtures (saved official articles, gallery sample, announcement list)
```

Card data and images © Riot Games; this project is unofficial fan content under Riot's
"Legal Jibber Jabber" policy.
