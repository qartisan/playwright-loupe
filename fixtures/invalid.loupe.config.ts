// Intentionally invalid Loupe config (a typo in "title"), loaded through
// LOUPE_CONFIG by the integration tests to check that the run stops.
// Not typed with defineConfig on purpose: the compiler would reject the typo.

export default {
  titel: 'Typo in the key',
};
