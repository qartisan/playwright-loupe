import type { Step } from '../../schema/v1.js';

/**
 * The step tree of the test detail. The report keeps every step
 * (docs/schema/v1.md, Step); the default view shows `test.step` steps and
 * every step with an error, with the ancestors needed to place them. "Show
 * all" shows every category.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export type StepMode = 'default' | 'all';

export interface StepNode {
  step: Step;
  /** Position in the full tree (`0.2.1`): the same in both modes. */
  key: string;
  children: StepNode[];
  /** On the path to the failing step, the failing step included. */
  onFailingPath: boolean;
  /** The deepest step of the failing path. */
  failing: boolean;
}

/**
 * Keys of the failing path: the last top-level step with an error, then
 * within it its last child with an error, and so on down. Empty when no step
 * failed.
 */
export function failingPath(steps: readonly Step[]): string[] {
  const path: string[] = [];
  let level = steps;
  let prefix = '';
  for (;;) {
    let found = -1;
    for (let index = level.length - 1; index >= 0; index--) {
      if (level[index]?.error) {
        found = index;
        break;
      }
    }
    if (found === -1) return path;
    const key = `${prefix}${found}`;
    path.push(key);
    level = (level[found] as Step).steps;
    prefix = `${key}.`;
  }
}

/** Shown by itself in the default view. */
function isKey(step: Step): boolean {
  return step.category === 'test.step' || step.error !== null;
}

/** The visible tree for a mode: in the default view, other steps are kept only as ancestors of visible ones. */
export function stepTree(steps: readonly Step[], mode: StepMode): StepNode[] {
  const path = new Set(failingPath(steps));
  const deepest = [...path].pop();
  const build = (level: readonly Step[], prefix: string): StepNode[] =>
    level.flatMap((step, index) => {
      const key = `${prefix}${index}`;
      const children = build(step.steps, `${key}.`);
      if (mode === 'default' && !isKey(step) && children.length === 0) return [];
      return [{ step, key, children, onFailingPath: path.has(key), failing: key === deepest }];
    });
  return build(steps, '');
}

/** The steps along a key path, from the top level down. */
export function stepsAt(steps: readonly Step[], keys: readonly string[]): Step[] {
  const result: Step[] = [];
  let level = steps;
  for (const key of keys) {
    const step = level[Number(key.split('.').pop())];
    if (!step) break;
    result.push(step);
    level = step.steps;
  }
  return result;
}

/**
 * The failing step and up to `count` steps before it at the same level, in
 * order. Null when no step failed.
 */
export function failingStepContext(steps: readonly Step[], count = 5): { path: Step[]; preceding: Step[] } | null {
  const keys = failingPath(steps);
  if (keys.length === 0) return null;
  const path = stepsAt(steps, keys);
  const siblings = path.length > 1 ? (path[path.length - 2] as Step).steps : steps;
  const position = Number((keys[keys.length - 1] as string).split('.').pop());
  return { path, preceding: siblings.slice(Math.max(0, position - count), position) };
}
