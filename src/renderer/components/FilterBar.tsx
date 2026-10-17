import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { Outcome } from '../../schema/v1.js';
import type { Colors } from './widgets.js';
import { setFilters } from '../filters/store.js';
import { activeFacets, clearFilters, facetDimension, withFacetValue, type FacetId, type FilterDomain, type FilterState } from '../filters/url.js';
import { UNNAMED_PROJECT } from '../tree.js';
import { CategoryBadge } from './CategoryBadge.js';
import { ChevronIcon, CloseIcon, OutcomeIcon, outcomeLabel } from './icons.js';

/** Filter bar of the Tests view: one multi-select menu per facet, then the active filters as removable chips. */

export function facetLabel(facet: FacetId): string {
  const dimension = facetDimension(facet);
  if (dimension !== null) return dimension;
  return { status: 'Status', project: 'Project', tag: 'Tag', category: 'Category' }[facet as 'status'];
}

/** A value as text, for chips and accessible names. */
function valueText(facet: FacetId, value: string): string {
  if (facet === 'status') return outcomeLabel(value as Outcome);
  if (facet === 'project') return value || UNNAMED_PROJECT;
  return value;
}

function ValueLabel({ facet, value, colors }: { facet: FacetId; value: string; colors: Colors }) {
  if (facet === 'status') return <OutcomeIcon outcome={value as Outcome} labelled />;
  if (facet === 'category') return <CategoryBadge name={value} color={colors.get(value)} />;
  return <span class="facet-value">{valueText(facet, value)}</span>;
}

/**
 * A facet as a disclosure holding checkboxes, each value with the number of
 * tests it would give (the other filters applied). Escape or a click outside
 * closes it.
 */
function FacetMenu({
  state,
  facet,
  values,
  counts,
  colors,
}: {
  state: FilterState;
  facet: FacetId;
  values: ReadonlySet<string>;
  counts: ReadonlyMap<string, number> | undefined;
  colors: Colors;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const selected = state.facets[facet] ?? [];
  const label = facetLabel(facet);

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      const element = details.current;
      if (element?.open && !element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    const element = details.current;
    if (event.key !== 'Escape' || !element?.open) return;
    element.open = false;
    element.querySelector('summary')?.focus();
    event.stopPropagation();
  };

  return (
    <details class="facet" ref={details} onKeyDown={onKeyDown} data-facet={facet}>
      <summary class="facet-button">
        <span>{label}</span>
        {selected.length > 0 && (
          <span class="facet-selected">
            {selected.length}
            <span class="visually-hidden"> selected</span>
          </span>
        )}
        <ChevronIcon class="chevron" />
      </summary>
      <fieldset class="facet-menu">
        <legend class="visually-hidden">{label}</legend>
        {[...values].map((value) => {
          const count = counts?.get(value) ?? 0;
          const checked = selected.includes(value);
          return (
            <label key={value} class={`facet-option${count === 0 && !checked ? ' facet-option-empty' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setFilters(withFacetValue(state, facet, value, event.currentTarget.checked))}
              />
              <ValueLabel facet={facet} value={value} colors={colors} />
              <span class="facet-count">
                {count}
                <span class="visually-hidden"> {count === 1 ? 'test' : 'tests'}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </details>
  );
}

export function FacetMenus({
  state,
  domain,
  counts,
  colors,
}: {
  state: FilterState;
  domain: FilterDomain;
  counts: ReadonlyMap<FacetId, ReadonlyMap<string, number>>;
  colors: Colors;
}) {
  // A single project gives nothing to choose from.
  const facets = [...domain].filter(([facet, values]) => facet !== 'project' || values.size > 1);
  return (
    <div class="facets" role="group" aria-label="Filters">
      {facets.map(([facet, values]) => (
        <FacetMenu key={facet} state={state} facet={facet} values={values} counts={counts.get(facet)} colors={colors} />
      ))}
    </div>
  );
}

interface Chip {
  key: string;
  label: string;
  remove: (state: FilterState) => FilterState;
}

function chips(state: FilterState): Chip[] {
  const list: Chip[] = [];
  if (state.q.trim() !== '') list.push({ key: 'q', label: `Search: ${state.q.trim()}`, remove: (current) => ({ ...current, q: '' }) });
  for (const [facet, values] of activeFacets(state.facets)) {
    for (const value of values) {
      list.push({
        key: `${facet}\u0000${value}`,
        label: `${facetLabel(facet)}: ${valueText(facet, value)}`,
        remove: (current) => withFacetValue(current, facet, value, false),
      });
    }
  }
  return list;
}

/** The active filters as removable chips, and "Clear all". Removing a chip moves focus to its neighbour. */
export function FilterChips({ state }: { state: FilterState }) {
  const list = chips(state);
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const buttons = [...(container.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    // The neighbour chip, else "Clear all", else the filter group.
    const target = buttons[Math.min(pendingFocus.current, buttons.length - 2)] ?? buttons[buttons.length - 1];
    pendingFocus.current = null;
    if (target) target.focus();
    else document.querySelector<HTMLElement>('.facets summary')?.focus();
  });

  if (list.length === 0) return null;
  return (
    <div class="filter-chips" ref={container}>
      <ul aria-label="Active filters">
        {list.map((chip, index) => (
          <li key={chip.key}>
            <button
              type="button"
              class="chip"
              aria-label={`Remove filter ${chip.label}`}
              onClick={() => {
                pendingFocus.current = index;
                setFilters(chip.remove(state));
              }}
            >
              <span>{chip.label}</span>
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        class="text-button"
        onClick={() => {
          pendingFocus.current = 0;
          setFilters(clearFilters(state));
        }}
      >
        Clear all
      </button>
    </div>
  );
}
