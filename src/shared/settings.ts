/**
 * Renderer settings: presentation choices injected next to the report data.
 * Not part of the data contract (see "Renderer settings" in docs/schema/v1.md).
 * In src/shared: the core writes them, the renderer reads them, and the
 * renderer never imports src/core.
 */
export interface RendererSettings {
  title: string;
  theme: 'system' | 'light' | 'dark';
  screenshots: { defaultView: 'side-by-side' | 'slider' | 'overlay' | 'diff' };
  /** The copyable AI prompt of the test detail. */
  aiPrompt: { includeStack: boolean };
  /** Folder of the trace viewer, relative to the report; set only after a successful copy, null otherwise. */
  traceViewer: string | null;
}

export const DEFAULT_RENDERER_SETTINGS: RendererSettings = {
  title: 'Loupe report',
  theme: 'system',
  screenshots: { defaultView: 'side-by-side' },
  aiPrompt: { includeStack: true },
  traceViewer: null,
};
