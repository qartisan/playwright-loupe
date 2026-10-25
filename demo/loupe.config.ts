// A user writes `import { defineConfig } from '@qartisan/playwright-loupe'`.
// Inside this repository the build output sits outside node_modules, where
// Playwright's transform cannot load it from a config file. A type-only
// import, erased at runtime, gives the same checking: the run itself uses
// nothing but the built reporter.
import type { LoupeConfig } from '../src/index.js';

// Loupe config of the demo suite, picked up from this folder.

export default {
  title: 'Demo Store · end-to-end suite',
  environment: 'staging',
  // Relative to playwright.config.ts: the report lands at the repository root.
  outputFolder: '../demo-report',
  categories: {
    // `extend` (the default): these rules run before the built-in ones.
    rules: [
      // The checkout shows the provider's message; without this rule it is a plain "Assertion".
      { name: 'Payment provider', match: /Payment provider unavailable/, on: 'message', color: 'gold' },
      // Screenshot comparisons would otherwise count as "Assertion" too.
      { name: 'Visual regression', match: /toHaveScreenshot/, on: 'message' },
    ],
  },
  dimensions: {
    definitions: [
      { name: 'Area', from: 'tag', prefix: 'area', values: ['catalog', 'cart', 'checkout', 'account'] },
      { name: 'Owner', from: 'annotation', type: 'owner', values: ['Storefront', 'Payments', 'Accounts'] },
      { name: 'Bug', from: 'annotation', type: 'bug' },
    ],
  },
} satisfies LoupeConfig;
