import { describe, expect, it } from 'vitest';
import { LINE_STEP, pageStep, scrollMove, type ScrollKeyContext, type ScrollKeyEvent } from '../src/renderer/scrollKeys.js';

const key = (name: string, modifiers: Partial<ScrollKeyEvent> = {}): ScrollKeyEvent => ({
  key: name,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  defaultPrevented: false,
  isComposing: false,
  ...modifiers,
});
const idle: ScrollKeyContext = { focusOnBody: true, dialogOpen: false, pageHeight: 800 };
const page = pageStep(800);

describe('pageStep', () => {
  it('is most of the visible height, at least one line', () => {
    expect(pageStep(800)).toBe(700);
    expect(pageStep(10)).toBe(LINE_STEP);
  });
});

describe('scrollMove', () => {
  it.each([
    ['PageDown', {}, { by: { top: page, left: 0 } }],
    ['PageUp', {}, { by: { top: -page, left: 0 } }],
    [' ', {}, { by: { top: page, left: 0 } }],
    [' ', { shiftKey: true }, { by: { top: -page, left: 0 } }],
    ['ArrowDown', {}, { by: { top: LINE_STEP, left: 0 } }],
    ['ArrowUp', {}, { by: { top: -LINE_STEP, left: 0 } }],
    ['ArrowRight', {}, { by: { top: 0, left: LINE_STEP } }],
    ['ArrowLeft', {}, { by: { top: 0, left: -LINE_STEP } }],
    ['Home', {}, { to: 'start' }],
    ['End', {}, { to: 'end' }],
  ] as const)('forwards %j %j while nothing has focus', (name, modifiers, move) => {
    expect(scrollMove(key(name, modifiers), idle)).toEqual(move);
  });

  it.each(['j', 'k', '/', '?', '[', 'Enter', 'Escape', 'Tab'])('leaves %j to the shortcuts and the browser', (name) => {
    expect(scrollMove(key(name), idle)).toBeNull();
  });

  it('does nothing when an element has focus, a dialog is open, or a handler took the key', () => {
    expect(scrollMove(key('PageDown'), { ...idle, focusOnBody: false })).toBeNull();
    expect(scrollMove(key('PageDown'), { ...idle, dialogOpen: true })).toBeNull();
    expect(scrollMove(key('PageDown', { defaultPrevented: true }), idle)).toBeNull();
    expect(scrollMove(key('PageDown', { isComposing: true }), idle)).toBeNull();
  });

  it('does nothing with a modifier, except Shift for Space', () => {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      expect(scrollMove(key('PageDown', { [modifier]: true }), idle)).toBeNull();
      expect(scrollMove(key(' ', { [modifier]: true }), idle)).toBeNull();
    }
    for (const name of ['PageDown', 'ArrowDown', 'Home', 'End']) expect(scrollMove(key(name, { shiftKey: true }), idle)).toBeNull();
  });
});
