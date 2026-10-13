import { defineConfig } from '../src/config/define.js';

// Loupe config of the fixture suite, also picked up by merge.config.ts (same
// directory). Each option exercises a feature; see fixtures/README.md.

export default defineConfig({
  // Overridden by the inline `title` in playwright.config.ts (inline options win).
  title: 'Loupe fixture suite (from loupe.config.ts)',
  environment: 'fixtures',
  categories: {
    rules: [
      // Wins over the built-in "Assertion" rule for the screenshot comparison failure.
      // No color: it gets the first palette color.
      { name: 'Visual regression', match: /toHaveScreenshot/, on: 'message' },
    ],
  },
  dimensions: {
    definitions: [
      // Replaces the automatic "layer" dimension. "ui" is used by the suite but
      // deliberately missing here, and no test uses "e2e".
      { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'e2e'] },
      { name: 'Bug', from: 'annotation', type: 'bug' },
    ],
  },
  screenshots: { defaultView: 'slider' },
  theme: 'dark',
});
