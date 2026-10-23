import { describe, expect, it } from 'vitest';
import { shortcutKey } from '../src/renderer/shortcutKeys.js';

describe('shortcutKey', () => {
  it('keeps a letter typed alone', () => {
    expect(shortcutKey({ key: 'j', shiftKey: false })).toBe('j');
  });

  it('matches a letter typed with Caps Lock in lower case', () => {
    expect(shortcutKey({ key: 'J', shiftKey: false })).toBe('j');
    expect(shortcutKey({ key: 'O', shiftKey: false })).toBe('o');
  });

  it('leaves Shift+letter free', () => {
    expect(shortcutKey({ key: 'J', shiftKey: true })).toBe('J');
  });

  it('keeps symbols typed with Shift, as on AZERTY keyboards', () => {
    expect(shortcutKey({ key: '?', shiftKey: true })).toBe('?');
    expect(shortcutKey({ key: '/', shiftKey: true })).toBe('/');
    expect(shortcutKey({ key: '/', shiftKey: false })).toBe('/');
  });

  it('keeps named keys', () => {
    expect(shortcutKey({ key: 'Escape', shiftKey: false })).toBe('Escape');
    expect(shortcutKey({ key: 'ArrowDown', shiftKey: false })).toBe('ArrowDown');
  });
});
