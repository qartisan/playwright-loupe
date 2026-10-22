import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

/**
 * Runs axe-core on a page and sorts what it finds. axe-core is a
 * devDependency injected into the page by the browser tests only: it is never
 * imported by `src/`, so it cannot reach the report bundle.
 *
 * - `failures`: violations of a WCAG rule with a `serious` or `critical`
 *   impact, not allowlisted. They fail the test.
 * - `listed`: WCAG violations with a `moderate` or `minor` impact, and
 *   best-practice violations of any impact. Printed, never failing.
 * - `incomplete`: what axe could not decide (mostly `color-contrast` under an
 *   overlay or on single characters). Printed as counts.
 * - `allowed`: findings matched by an allowlist entry, violations or
 *   incomplete, so unused entries can be reported.
 */

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA, plus axe's best practices. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;
export const AXE_TAGS = [...WCAG_TAGS, 'best-practice'] as const;

/** An accepted finding: one rule on the elements matching `selector`, with the reason it is accepted. */
export interface AllowEntry {
  rule: string;
  selector: string;
  reason: string;
}

export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface Finding {
  rule: string;
  impact: Impact | null;
  /** True for a WCAG rule, false for a best practice. */
  wcag: boolean;
  help: string;
  /** axe selectors of the elements concerned. */
  targets: string[];
}

export interface AxeAudit {
  failures: Finding[];
  listed: Finding[];
  incomplete: Finding[];
  allowed: Array<{ entry: AllowEntry; finding: Finding }>;
}

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/** A finding as returned from the page, each node with the index of the allowlist entry matching it, or -1. */
interface RawFinding {
  rule: string;
  impact: Impact | null;
  tags: string[];
  help: string;
  nodes: Array<{ target: string; allowedBy: number }>;
}

/** Runs axe on the whole document in its current state and applies `allowlist`. */
export async function audit(page: Page, allowlist: readonly AllowEntry[] = []): Promise<AxeAudit> {
  if (!(await page.evaluate('typeof window.axe !== "undefined"'))) await page.addScriptTag({ content: AXE_SOURCE });
  const raw = await page.evaluate<{ violations: RawFinding[]; incomplete: RawFinding[] }>(`(async () => {
    const allowlist = ${JSON.stringify(allowlist.map(({ rule, selector }) => ({ rule, selector })))};
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} },
      resultTypes: ['violations', 'incomplete'],
    });
    const allowedBy = (rule, target) => {
      // Targets inside an iframe or a shadow root are arrays: never allowlisted.
      const element = target.length === 1 && typeof target[0] === 'string' ? document.querySelector(target[0]) : null;
      return element ? allowlist.findIndex((entry) => entry.rule === rule && element.matches(entry.selector)) : -1;
    };
    const slim = (results) => results.map((rule) => ({
      rule: rule.id,
      impact: rule.impact ?? null,
      tags: rule.tags,
      help: rule.help,
      nodes: rule.nodes.map((node) => ({ target: node.target.join(' '), allowedBy: allowedBy(rule.id, node.target) })),
    }));
    return { violations: slim(result.violations), incomplete: slim(result.incomplete) };
  })()`);

  const result: AxeAudit = { failures: [], listed: [], incomplete: [], allowed: [] };
  const split = (findings: RawFinding[], kind: 'violation' | 'incomplete'): void => {
    for (const { rule, impact, tags, help, nodes } of findings) {
      const wcag = tags.some((tag) => (WCAG_TAGS as readonly string[]).includes(tag));
      const finding = (targets: string[]): Finding => ({ rule, impact, wcag, help, targets });
      for (const [index, entry] of allowlist.entries()) {
        const targets = nodes.filter((node) => node.allowedBy === index).map((node) => node.target);
        if (targets.length > 0) result.allowed.push({ entry, finding: finding(targets) });
      }
      const targets = nodes.filter((node) => node.allowedBy === -1).map((node) => node.target);
      if (targets.length === 0) continue;
      if (kind === 'incomplete') result.incomplete.push(finding(targets));
      else if (wcag && (impact === 'serious' || impact === 'critical')) result.failures.push(finding(targets));
      else result.listed.push(finding(targets));
    }
  };
  split(raw.violations, 'violation');
  split(raw.incomplete, 'incomplete');
  return result;
}

/** One line per finding: rule, impact, kind and targets, for assertion messages and the printed summary. */
export function describeFinding({ rule, impact, wcag, help, targets }: Finding): string {
  return `${rule} (${impact ?? 'no impact'}, ${wcag ? 'WCAG' : 'best practice'}): ${help} — ${targets.join(', ')}`;
}
