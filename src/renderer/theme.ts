import { effect, signal } from '@preact/signals';
import type { RendererSettings } from '../core/inject.js';
import { readPreference, writePreference } from './storage.js';

export type ThemeChoice = RendererSettings['theme'];

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

const STORAGE_KEY = 'loupe.theme';

/** The viewer's choice, or the configured default when they never chose. */
export const theme = signal<ThemeChoice>('system');

function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

/** Applies the remembered choice, else `defaultTheme`, and keeps `<html data-theme>` in sync. */
export function initTheme(defaultTheme: ThemeChoice): void {
  const stored = readPreference(STORAGE_KEY);
  theme.value = isThemeChoice(stored) ? stored : isThemeChoice(defaultTheme) ? defaultTheme : 'system';
  effect(() => {
    const root = document.documentElement;
    // No attribute: the stylesheet follows prefers-color-scheme.
    if (theme.value === 'system') delete root.dataset['theme'];
    else root.dataset['theme'] = theme.value;
  });
}

export function setTheme(choice: ThemeChoice): void {
  theme.value = choice;
  writePreference(STORAGE_KEY, choice);
}
