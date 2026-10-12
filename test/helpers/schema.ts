import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';

export const SCHEMA_FILE = new URL('../../docs/schema/report-v1.schema.json', import.meta.url);

/** The published JSON Schema, parsed. */
export const schema = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

/** Validates a value against the published schema; returns readable errors, empty when valid. */
export function schemaErrors(value: unknown): string[] {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim());
}
