/**
 * Wire types. `Card` is RiftCodex's card schema verbatim plus the optional own-API fields
 * (SPEC §1). Optional fields are omitted when false/null so the payload stays RiftCodex-sized.
 */

export interface Localization {
  name?: string | null;
  image_url?: string | null;
  text?: string | null;
}

export interface Card {
  id: string;
  name: string;
  riftbound_id: string;
  tcgplayer_id: string | null;
  collector_number: number;
  attributes: { energy: number | null; might: number | null; power: number | null };
  classification: {
    type: string;
    supertype: string | null;
    rarity: string;
    domain: string[];
  };
  text: { rich: string | null; plain: string | null; flavour: string | null };
  set: { set_id: string; label: string };
  media: { image_url: string | null; artist: string | null; accessibility_text: string | null };
  tags: string[];
  orientation: string;
  metadata: {
    clean_name: string | null;
    updated_on: string | null;
    alternate_art: boolean;
    overnumbered: boolean;
    signature: boolean;
  };
  new: boolean | null;
  // ---- own-API additions (optional) ----
  banned?: boolean;
  banned_formats?: Format[];
  errata?: string;
  errata_date?: string;
  localizations?: Record<string, Localization>;
}

export interface CardSet {
  id: string;
  name: string;
  set_id: string;
  card_count: number;
  tcgplayer_id: string | null;
  cardmarket_id: string | string[] | null;
  published_on: string;
}

export type Format = 'standard' | '2v2';
export const FORMATS: readonly Format[] = ['standard', '2v2'];

export type Region = 'global' | 'kr' | 'tc';
export const REGIONS: readonly Region[] = ['global', 'kr', 'tc'];

export interface LegalityItem {
  id: string;
  riftbound_id: string;
  banned: boolean;
  banned_formats: Format[];
  errata: string | null;
  errata_date: string | null;
}

export interface LegalityFile {
  updated_at: string;
  regions: Record<Region, LegalityItem[]>;
}

/**
 * Identifies one build of the catalogue. `tag` is a hash of the cards, sets and every
 * region's legality, so it changes exactly when a client would see different data;
 * clients compare it on launch and re-download only when it differs.
 */
export interface DataVersion {
  tag: string;
  generated_at: string;
  card_count: number;
}

export interface Dataset {
  cards: Card[];
  sets: CardSet[];
  legality: LegalityFile;
  version: DataVersion;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}
