// The projects of fixtures/rerun.config.ts. KIT_LOUPE adds the Loupe reporter, once, to produce the report the commands come from.
require('./redaction-values.ts');

// For the paths in the titles of rerun/paths-in-titles.spec.ts.
process.env.LOUPE_FIXTURE_RERUN_ROOT = require('node:path').join(__dirname, 'rerun');

const plain = /plain\.spec\.ts$/;
const loupe = process.env.KIT_LOUPE
  ? [[process.env.KIT_LOUPE, { outputFolder: process.env.KIT_LOUPE_OUTPUT, redact: { env: ['LOUPE_FIXTURE_SECRET'] } }]]
  : [];

module.exports = {
  testDir: './rerun',
  reporter: [['./selection-reporter.cjs'], ...loupe],
  projects: [
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    { name: 'main', testMatch: /\.spec\.ts$/, dependencies: ['setup'] },
    { name: 'other', testMatch: plain },
    { name: 'v1.2', testMatch: plain },
    { name: 'star*name', testMatch: plain },
    { name: 'Mobile (iOS) + x', testMatch: plain },
    { name: 'Sécu "q" $x %y% `z` !', testMatch: plain },
    { name: 'Case', testMatch: plain },
    { name: 'case', testMatch: plain },
    { name: 'off-by-default', testMatch: plain, default: false },
    { testMatch: plain },
  ],
};
