// Invented secrets for the redaction tests of the fixture suite (see
// fixtures/README.md). They must never appear in the report.
//
// The suite sets its own environment variable so a run is self-contained. A
// real suite gets such values from its environment (CI secrets) and lists only
// the variable names in `redact.env`, never the values.

export const FIXTURE_PASSWORD = 'Fixture-Pa55word-Inv3nted';

export const FIXTURE_SECRET_ENV = 'LOUPE_FIXTURE_SECRET';
export const FIXTURE_SECRET = 'fixture-Env-Inv3nted-77';

process.env[FIXTURE_SECRET_ENV] ??= FIXTURE_SECRET;
