import type { Attempt, LoupeError, Step, TestCase } from '../../schema/v1.js';
import { mergeAnnotations } from '../../shared/annotations.js';
import { isFrameLine } from '../../shared/frames.js';
import { NO_CATEGORY } from '../dashboard.js';
import { parseStack } from '../failure-points/frames.js';
import { attemptLabel } from './attempts.js';
import { failingStepContext } from './steps.js';

/**
 * The AI prompt of the test detail: a text in English describing one attempt
 * of a test, for the viewer to paste in the assistant of their choice. It is
 * only copied to the clipboard; Loupe never sends it anywhere.
 *
 * Pure function, no DOM: unit-tested in Node.
 */

export interface AiPromptOptions {
  /** Include each error's stack trace. Config: `aiPrompt.includeStack`. */
  includeStack: boolean;
}

const INSTRUCTION =
  'A Playwright test failed. Explain the most likely cause of the failure, say whether the problem is more likely in the test or in the application under test, and suggest a fix.';

/** A fenced block whose fence is longer than any backtick run in the text; trailing blank lines dropped. */
function fenced(raw: string): string {
  const text = raw.replace(/\s+$/, '');
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

function location(error: LoupeError): string | null {
  return error.location ? `${error.location.file}:${error.location.line}:${error.location.column}` : null;
}

/**
 * The stack from its first frame line: its head repeats the message, printed
 * just before. Lines after the first frame (a nested cause) are kept. Null
 * without a frame line, or when the only line left is a frame at the error's
 * location (same file and line), printed above.
 */
function stackFrames(error: LoupeError): string | null {
  const lines = error.stack?.split('\n') ?? [];
  const first = lines.findIndex(isFrameLine);
  if (first === -1) return null;
  const frames = lines.slice(first).join('\n').replace(/\s+$/, '');
  const [only] = parseStack(frames);
  const atLocation = error.location !== null && only?.path === error.location.file && only.line === error.location.line;
  return atLocation && !frames.includes('\n') ? null : frames;
}

function stepText(step: Step): string {
  return step.subtitle ? `${step.title} (${step.subtitle})` : step.title;
}

function errorSection(error: LoupeError, index: number, total: number, options: AiPromptOptions): string[] {
  const lines = [`## Error${total > 1 ? ` ${index + 1} of ${total}` : ''}`, '', `Category: ${error.category ?? NO_CATEGORY}`];
  const where = location(error);
  if (where) lines.push(`Location: ${where}`);
  lines.push('', 'Message:', fenced(error.message));
  if (error.snippet) lines.push('', 'Code:', fenced(error.snippet));
  const frames = options.includeStack ? stackFrames(error) : null;
  if (frames) lines.push('', 'Stack:', fenced(frames));
  return lines;
}

export function buildAiPrompt(test: TestCase, attempt: Attempt, options: AiPromptOptions): string {
  const position = test.attempts.findIndex((candidate) => candidate.index === attempt.index) + 1;
  const lines = [
    INSTRUCTION,
    '',
    '## Test',
    '',
    `- Title: ${[...test.suitePath, test.title].join(' › ')}`,
    `- File: ${test.file}`,
    `- Project: ${test.project || '(unnamed)'}`,
    `- Outcome: ${test.outcome}`,
    `- Attempt: ${position} of ${test.attempts.length} (${attemptLabel(attempt.index).toLowerCase()}), status ${attempt.status}`,
    `- Error category: ${attempt.errors[0]?.category ?? test.category ?? 'none'}`,
  ];
  if (test.tags.length > 0) lines.push(`- Tags: ${test.tags.join(', ')}`);
  const annotations = mergeAnnotations(test.annotations, attempt.annotations);
  if (annotations.length > 0) {
    lines.push(`- Annotations: ${annotations.map(({ type, description }) => (description ? `${type}: ${description}` : type)).join('; ')}`);
  }

  attempt.errors.forEach((error, index) => lines.push('', ...errorSection(error, index, attempt.errors.length, options)));
  if (attempt.errors.length === 0) lines.push('', '## Error', '', 'This attempt reported no error.');

  const context = failingStepContext(attempt.steps);
  if (context) {
    lines.push('', '## Failing step', '', context.path.map(stepText).join(' › '));
    if (context.preceding.length > 0) {
      lines.push('', 'Steps before it, at the same level:', ...context.preceding.map((step, index) => `${index + 1}. ${stepText(step)}`));
    }
  }

  if (attempt.attachments.length > 0) {
    lines.push('', '## Attachments (not included)', '', ...attempt.attachments.map((attachment) => `- ${attachment.name} (${attachment.contentType})`));
  }
  return `${lines.join('\n')}\n`;
}
