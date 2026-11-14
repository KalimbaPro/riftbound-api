/**
 * Official card gallery (playriftbound.com/{locale}/card-gallery/) → RiftCodex card schema.
 * The gallery inlines every card in __NEXT_DATA__ at props.pageProps.page.blades[*].cards.items.
 */
import type { Card, Localization } from '../../src/types.ts';
import { cleanName } from '../../src/lib/names.ts';

export interface GalleryLabelled { id?: string | number; label: string }
export interface GalleryCard {
  id: string;
  collectorNumber: number;
  name: string;
  subtitle?: string;
  set: { value: { id: string; label: string } };
  cardType: { type?: GalleryLabelled[]; superType?: GalleryLabelled[] };
  publicCode: string;
  rarity: { value: GalleryLabelled };
  domain: { values: GalleryLabelled[] };
  cardImage: { url: string; accessibilityText?: string };
  orientation: string;
  illustrator?: { values: GalleryLabelled[] };
  text?: { richText?: { body?: string } };
  effect?: { richText?: { body?: string } };
  energy?: { value: { id: number } };
  might?: { value: { id: number } };
  power?: { value: { id: number } };
  mightBonus?: { value: { id: number } };
  tags?: { tags?: string[] };
}

export function extractNextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No __NEXT_DATA__ in page');
  return JSON.parse(m[1]);
}

export function galleryItems(nextData: unknown): GalleryCard[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blades: any[] = (nextData as any)?.props?.pageProps?.page?.blades ?? [];
  const items = blades.flatMap((b) => b?.cards?.items ?? []) as GalleryCard[];
  if (!items.length) throw new Error('Gallery __NEXT_DATA__ has no cards (page layout changed?)');
  return items;
}

/** Gallery "ogn-303-star-298" → RiftCodex "ogn-303*-298". */
export function riftboundIdFromGallery(galleryId: string): string {
  return galleryId.toLowerCase().replace(/-([0-9a-z]+)-star-/, '-$1*-');
}

export interface CodeFlags {
  alternate_art: boolean;
  signature: boolean;
  overnumbered: boolean;
}

/**
 * Flags from the printed code: "OGN-066a/298" alt art, "SFD-225*\/221" signature,
 * number above the printed set total overnumbered (signatures are not also overnumbered,
 * matching RiftCodex). Tokens ("UNL-T01") and runes ("RAD-R01a") have no total.
 */
export function flagsFromCode(publicCode: string): CodeFlags {
  const m = publicCode.match(/^[A-Z0-9]+-([A-Z]*)(\d+)([a-z]*)(\*?)(?:\/(\d+))?/i);
  if (!m) return { alternate_art: false, overnumbered: false, signature: false };
  const [, prefix, num, letters, star, total] = m;
  const signature = star === '*';
  const alternate_art = /a/.test(letters);
  const overnumbered = !signature && !prefix && total !== undefined && Number(num) > Number(total);
  return { alternate_art, overnumbered, signature };
}

export function stripTags(html: string | null): string | null {
  if (html == null) return null;
  // RiftCodex's `plain` is the rich text with tags removed and nothing else changed.
  return html.replace(/<[^>]+>/g, '');
}

const label = (l?: GalleryLabelled[]) => l?.[0]?.label ?? null;

/** RiftCodex display name: "Ahri - Alluring", Legends "Ahri - Nine-Tailed Fox", plus variant suffix. */
export function displayName(g: Pick<GalleryCard, 'name' | 'subtitle' | 'cardType' | 'tags'>, flags?: CodeFlags): string {
  // Signature spells/gear carry their champion as a subtitle; RiftCodex leaves it out.
  const sub = label(g.cardType.superType) === 'Signature' ? undefined : g.subtitle;
  let n = sub && sub !== 'Starter' ? `${g.name} - ${sub}` : g.name;
  const champion = g.tags?.tags?.[0];
  if (label(g.cardType.type) === 'Legend' && champion && !n.toLowerCase().includes(champion.toLowerCase())) {
    n = `${champion} - ${n}`;
  }
  if (sub === 'Starter') n += ' (Starter)';
  if (flags?.signature) n += ' (Signature)';
  else if (flags?.overnumbered) n += ' (Overnumbered)';
  else if (flags?.alternate_art) n += ' (Alternate Art)';
  return n;
}

function richText(g: GalleryCard): string | null {
  const parts = [g.text?.richText?.body, g.effect?.richText?.body]
    .filter((b): b is string => !!b && b !== '<p>[NO TEXT]</p>');
  return parts.length ? parts.join('') : null;
}

/** Map one gallery record. `id`, `updated_on` and `new` are filled in by the build. */
export function mapGalleryCard(g: GalleryCard): Omit<Card, 'id'> {
  const flags = flagsFromCode(g.publicCode);
  const name = displayName(g, flags);
  const rich = richText(g);
  const artists = (g.illustrator?.values ?? []).map((v) => v.label).filter(Boolean);
  return {
    name,
    riftbound_id: riftboundIdFromGallery(g.id),
    tcgplayer_id: null,
    collector_number: g.collectorNumber,
    attributes: {
      energy: g.energy?.value?.id ?? null,
      // Equipment prints a Might *bonus*; RiftCodex leaves `might` null for it.
      might: g.mightBonus ? null : (g.might?.value?.id ?? null),
      power: g.power?.value?.id ?? null,
    },
    classification: {
      type: label(g.cardType.type) ?? 'Unknown',
      supertype: label(g.cardType.superType),
      rarity: g.rarity.value.label,
      domain: g.domain.values.map((d) => d.label),
    },
    text: { rich, plain: stripTags(rich), flavour: null },
    set: { set_id: g.set.value.id, label: g.set.value.label },
    media: {
      image_url: g.cardImage.url,
      artist: artists.length ? artists.join(', ') : null,
      accessibility_text: g.cardImage.accessibilityText ?? null,
    },
    tags: g.tags?.tags ?? [],
    orientation: g.orientation,
    metadata: { clean_name: cleanName(name), updated_on: null, ...flags },
    new: null,
  };
}

/**
 * Localised name/text/image for a card, only where the locale actually differs from en-us
 * (ko-kr serves English for most sets; zh-cn has English images for some sets).
 */
export function localization(en: GalleryCard, loc: GalleryCard | undefined): Localization | null {
  if (!loc) return null;
  const out: Localization = {};
  const locName = loc.subtitle ? `${loc.name} - ${loc.subtitle}` : loc.name;
  const enName = en.subtitle ? `${en.name} - ${en.subtitle}` : en.name;
  if (locName !== enName) out.name = locName;
  const locText = stripTags(richText(loc));
  if (locText && locText !== stripTags(richText(en))) out.text = locText;
  if (loc.cardImage.url !== en.cardImage.url) out.image_url = loc.cardImage.url;
  return Object.keys(out).length ? out : null;
}
