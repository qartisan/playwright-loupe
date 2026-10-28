import type { FullConfig, TestCase } from '@playwright/test/reporter';
import { describe, expect, it } from 'vitest';
import { isFocused, nonDefaultProjects } from '../src/core/build.js';

/**
 * Playwright internals Loupe reads, with every shape a Playwright release could
 * give them: a missing or reshaped internal never throws and gives the
 * fallback value. test/internals.integration.test.ts checks the same in real runs.
 */

/** A config holding `internal` under a symbol described like Playwright's. */
function configWith(internal: unknown): FullConfig {
  return { [Symbol('configInternalSymbol')]: internal } as unknown as FullConfig;
}

describe('nonDefaultProjects (Playwright 1.64+ internal config)', () => {
  it('lists the projects with default: false', () => {
    const internal = {
      projects: [
        { default: true, project: { name: 'main' } },
        { default: false, project: { name: 'nightly' } },
      ],
    };
    expect(nonDefaultProjects(configWith(internal))).toEqual(['nightly']);
  });

  it('is undefined without the internal config', () => {
    expect(nonDefaultProjects({} as FullConfig)).toBeUndefined();
    // Another symbol is not Playwright's.
    expect(nonDefaultProjects({ [Symbol('other')]: { projects: [] } } as unknown as FullConfig)).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['a string', 'internal'],
    ['a function', () => ({ projects: [] })],
    ['an object without projects', {}],
    ['projects that are not an array', { projects: { main: { default: true } } }],
  ])('is undefined when the internal config is %s', (_name, internal) => {
    expect(nonDefaultProjects(configWith(internal))).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'main'],
    ['without default (before 1.64)', { project: { name: 'main' } }],
    ['with a non-boolean default', { default: 'false', project: { name: 'main' } }],
    ['without project', { default: false }],
    ['with a null project', { default: false, project: null }],
    ['with a non-string name', { default: false, project: { name: 7 } }],
  ])('is undefined when a project entry is %s, without throwing', (_name, entry) => {
    const internal = { projects: [{ default: false, project: { name: 'nightly' } }, entry] };
    expect(() => nonDefaultProjects(configWith(internal))).not.toThrow();
    expect(nonDefaultProjects(configWith(internal))).toBeUndefined();
  });
});

describe('isFocused (internal _only flag)', () => {
  /** A test inside a describe inside a file, each node with the given `_only` value (absent when undefined). */
  function testWith(only: { test?: unknown; describe?: unknown; file?: unknown }): TestCase {
    const node = (parent: object | undefined, value: unknown, hasValue: boolean): object =>
      hasValue ? { parent, _only: value } : { parent };
    const file = node(undefined, only.file, 'file' in only);
    const group = node(file, only.describe, 'describe' in only);
    return node(group, only.test, 'test' in only) as TestCase;
  }

  it('is true when the test or an ancestor has _only', () => {
    expect(isFocused(testWith({ test: true }))).toBe(true);
    expect(isFocused(testWith({ describe: true }))).toBe(true);
    expect(isFocused(testWith({ test: false, describe: false, file: true }))).toBe(true);
  });

  it('is false when no node has _only, or the flag is missing', () => {
    expect(isFocused(testWith({ test: false, describe: false, file: false }))).toBe(false);
    expect(isFocused(testWith({}))).toBe(false);
  });

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['an object', {}],
    ['null', null],
  ])('treats a flag that is %s as not focused', (_name, value) => {
    expect(isFocused(testWith({ test: value, describe: value, file: value }))).toBe(false);
  });

  it('stops at a null parent', () => {
    const test = { _only: false, parent: { _only: false, parent: null } } as unknown as TestCase;
    expect(isFocused(test)).toBe(false);
  });
});
