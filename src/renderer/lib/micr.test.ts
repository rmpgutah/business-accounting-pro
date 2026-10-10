import { describe, it, expect } from 'vitest';
import * as m from './micr';

describe('micr', () => {
  it('canonical layout with check number', () => {
    expect(m.buildMicrCanonical({ routing: '123456789', account: '0001234567', checkNumber: '1042' })).toBe('O1042O T123456789T 0001234567O');
  });
  it('routing padded to 9 digits', () => {
    expect(m.buildMicrCanonical({ routing: '12345', account: '99' }).includes('T000012345T')).toBeTruthy();
  });
  it('no aux field when checkNumber absent', () => {
    expect(!m.buildMicrCanonical({ routing: '123456789', account: '5' }).startsWith('O')).toBeTruthy();
  });
  it('amount field never emitted', () => {
    expect(!m.buildMicrCanonical({ routing: '123456789', account: '5', checkNumber: '1' }).includes('A')).toBeTruthy();
  });
  it('glyph map converts tokens (T->A, O->C)', () => {
    const g = m.buildMicrLine({ routing: '123456789', account: '0001234567', checkNumber: '1042' });
    expect(!/[TO]/.test(g), 'no raw tokens left').toBeTruthy();
    expect(g.startsWith('C1042C A123456789A'), 'mapped glyphs').toBeTruthy();
  });
  it('unicode fallback uses real MICR symbols, no token letters', () => {
    const u = m.buildMicrUnicode({ routing: '123456789', account: '0001234567', checkNumber: '1042' });
    expect(!/[TOAD]/.test(u), 'no raw tokens left').toBeTruthy();
    expect(u.includes('⑆123456789⑆'), 'transit symbol flanks routing').toBeTruthy();
    expect(u.endsWith('⑉'), 'on-us symbol closes the line').toBeTruthy();
  });
});
