import { describe, expect, it } from 'vitest';
import { baseName, cardKeys, cleanName, nameKey } from '../src/lib/names.ts';

describe('names', () => {
  it('folds separators, case and apostrophes', () => {
    expect(nameKey('Draven, Vanquisher')).toBe(nameKey('Draven - Vanquisher'));
    expect(nameKey('Reaver’s Row')).toBe(nameKey("Reaver's Row"));
    expect(nameKey("Kai'Sa - Daughter of the Void")).toBe('kaisa daughter of the void');
  });
  it('strips variant suffixes', () => {
    expect(baseName('Ahri - Nine-Tailed Fox (Korea Exclusive) (Signature)')).toBe('Ahri - Nine-Tailed Fox');
  });
  it('legends also answer to their title', () => {
    expect(cardKeys('Master Yi - Wuju Bladesman (Starter)', 'Legend')).toEqual(['master yi wuju bladesman', 'wuju bladesman']);
    expect(cardKeys('Ahri - Alluring', 'Unit')).toEqual(['ahri alluring']);
  });
  it('clean_name matches RiftCodex', () => {
    expect(cleanName('B.F. Sword')).toBe('BF Sword');
    expect(cleanName('Ahri - Nine-Tailed Fox (Overnumbered)')).toBe('Ahri Nine Tailed Fox Overnumbered');
    expect(cleanName("Kai'Sa - Daughter of the Void")).toBe('KaiSa Daughter of the Void');
  });
});
