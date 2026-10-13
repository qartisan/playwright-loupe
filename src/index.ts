import { LoupeReporter } from './core/reporter.js';

export default LoupeReporter;
export { LoupeReporter };
export { defineConfig } from './config/index.js';
export type {
  AnnotationDimensionConfig,
  CategoriesConfig,
  CategoryMode,
  CategoryRuleConfig,
  CategoryTarget,
  DimensionConfig,
  DimensionsConfig,
  LoupeConfig,
  LoupeReporterOptions,
  ScreenshotView,
  TagDimensionConfig,
  Theme,
} from './config/types.js';
export type { RendererSettings } from './core/inject.js';
export type * from './schema/v1.js';
