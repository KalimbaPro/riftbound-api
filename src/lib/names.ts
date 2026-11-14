/** Name normalisation shared by the data build (ban/errata matching) and the API (search). */

const VARIANT_SUFFIX = /\s*\([^)]*\)\s*$/;

/** "Ahri - Nine-Tailed Fox (Signature)" -> "Ahri - Nine-Tailed Fox". */
export function baseName(name: string): string {
  let n = name;
  while (VARIANT_SUFFIX.test(n)) n = n.replace(VARIANT_SUFFIX, '');
  return n.trim();
}

/**
 * Comparison key: case, accents, apostrophes and every separator style folded away, so
 * "Draven, Vanquisher", "Draven - Vanquisher" and "draven vanquisher" are all one key.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every key a card answers to when a ban or errata names it. A Legend is stored as
 * "Ahri - Nine-Tailed Fox" but some sources (and RiftCodex's Vendetta data) use only the
 * title, so Legends also answer to the part after the champion prefix.
 */
export function cardKeys(name: string, type: string | null): string[] {
  const base = baseName(name);
  const keys = new Set([nameKey(base)]);
  if (type === 'Legend') {
    const m = base.match(/^[^,-]+?\s(?:-|,)\s(.+)$/);
    if (m) keys.add(nameKey(m[1]));
  }
  return [...keys];
}

/** RiftCodex `metadata.clean_name`: "B.F. Sword" -> "BF Sword", "Nine-Tailed" -> "Nine Tailed". */
export function cleanName(name: string): string {
  return name
    .replace(/['’.]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
