import { DEFAULT_RENDERER_SETTINGS, type RendererSettings } from '../core/inject.js';
import type { LoupeReport } from '../schema/v1.js';

export type ReportResult = { ok: true; report: LoupeReport } | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parses the injected report text. Pure: the caller reads it from the page. */
export function parseReport(text: string | null | undefined): ReportResult {
  let data: unknown;
  try {
    data = JSON.parse(text ?? '');
  } catch {
    return { ok: false, message: 'The report data is missing or is not valid JSON.' };
  }
  if (!isObject(data)) return { ok: false, message: 'The report data is not a Loupe report.' };
  if (data['schemaVersion'] !== 1) {
    return {
      ok: false,
      message: `Unsupported report schema version ${JSON.stringify(data['schemaVersion'])}: this renderer reads version 1.`,
    };
  }
  if (!isObject(data['run']) || !Array.isArray(data['tests']) || !Array.isArray(data['projects'])) {
    return { ok: false, message: 'The report data is incomplete: run, projects or tests is missing.' };
  }
  return { ok: true, report: data as unknown as LoupeReport };
}

/** Parses the injected settings; missing or invalid fields fall back to the defaults. */
export function parseSettings(text: string | null | undefined): RendererSettings {
  try {
    const value: unknown = JSON.parse(text ?? '');
    if (!isObject(value)) return DEFAULT_RENDERER_SETTINGS;
    return {
      ...DEFAULT_RENDERER_SETTINGS,
      ...value,
      screenshots: { ...DEFAULT_RENDERER_SETTINGS.screenshots, ...(isObject(value['screenshots']) ? value['screenshots'] : {}) },
    } as RendererSettings;
  } catch {
    return DEFAULT_RENDERER_SETTINGS;
  }
}
