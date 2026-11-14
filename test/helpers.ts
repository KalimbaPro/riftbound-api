import type { Card } from '../src/types.ts';

let n = 0;
/** A minimal valid card; override anything. */
export function card(p: Partial<Card> & { name: string }): Card {
  n++;
  const base: Card = {
    id: n.toString(16).padStart(24, '0'),
    name: p.name,
    riftbound_id: `tst-${String(n).padStart(3, '0')}-999`,
    tcgplayer_id: null,
    collector_number: n,
    attributes: { energy: 1, might: 1, power: null },
    classification: { type: 'Unit', supertype: null, rarity: 'Common', domain: ['Fury'] },
    text: { rich: '<p>Hello</p>', plain: 'Hello', flavour: null },
    set: { set_id: 'TST', label: 'Test' },
    media: { image_url: 'https://example.com/x.png', artist: null, accessibility_text: null },
    tags: [],
    orientation: 'portrait',
    metadata: { clean_name: p.name, updated_on: null, alternate_art: false, overnumbered: false, signature: false },
    new: false,
  };
  return { ...base, ...p };
}
