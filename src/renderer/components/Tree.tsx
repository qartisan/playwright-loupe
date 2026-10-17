import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { plural } from '../format.js';
import { revealRequest } from '../layout.js';
import { hrefTo, navigate } from '../navigation.js';
import { splitForMiddleEllipsis } from '../paths.js';
import type { Route } from '../router.js';
import { ancestorKeys, groupKeys, testKey, visibleRows, type GroupNode, type TestNode, type VisibleRow } from '../tree.js';
import { ChevronIcon, OutcomeIcon } from './icons.js';

/**
 * The test tree, rendered as a flat list of the visible rows (ARIA tree with
 * aria-level). Children of collapsed nodes are never rendered, nor even
 * visited. Keyboard: arrows, Home / End, Enter / Space; one row is tabbable
 * (roving tabindex).
 */
export function Tree({
  roots,
  route,
  prefix,
  expandAll,
  emptyMessage,
}: {
  roots: GroupNode[];
  route: Route;
  /** Folder shared by every file, left out of the tree and shown once above it. */
  prefix: string;
  /** Opens every group, whenever the roots change: a filtered tree shows its matches. */
  expandAll: boolean;
  emptyMessage: string;
}) {
  const selectedKey = route.page === 'test' ? testKey(route.id, route.repeatEachIndex) : null;
  // Projects start expanded; the rest opens on demand.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(roots.map((root) => root.key)));
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const rowElements = useRef(new Map<string, HTMLLIElement>());
  const focusPending = useRef(false);
  const revealPending = useRef(false);
  // A group revealed from the dashboard stays highlighted until another one is, or a test is opened.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  // Focused once its row is rendered (the group may only now be expanded or the sidebar shown).
  const revealFocus = useRef<string | null>(null);
  const request = revealRequest.value;

  useLayoutEffect(() => {
    if (!request || !roots.some((root) => root.key === request.key)) return;
    setRevealedKey(request.key);
    setExpanded((previous) => (previous.has(request.key) ? previous : new Set([...previous, request.key])));
    revealFocus.current = request.key;
    setFocusedKey(request.key);
  }, [roots, request]);

  useLayoutEffect(() => {
    if (selectedKey) setRevealedKey(null);
  }, [selectedKey]);

  // Opening a test (link, URL, back button) reveals it in the tree. A layout
  // effect, so it runs right after the route changes: a passive effect could
  // run late (Preact flushes it before the next render) and undo a focus move.
  useLayoutEffect(() => {
    if (!selectedKey) return;
    const ancestors = ancestorKeys(roots, selectedKey);
    if (!ancestors) return;
    revealPending.current = true;
    setFocusedKey(selectedKey);
    setExpanded((previous) => (ancestors.every((key) => previous.has(key)) ? previous : new Set([...previous, ...ancestors])));
  }, [roots, selectedKey]);

  useLayoutEffect(() => {
    if (!expandAll) return;
    const keys = groupKeys(roots);
    setExpanded((previous) => (keys.every((key) => previous.has(key)) ? previous : new Set([...previous, ...keys])));
  }, [roots, expandAll]);

  const rows = useMemo(() => visibleRows(roots, expanded), [roots, expanded]);
  const indexByKey = useMemo(() => new Map(rows.map((row, index) => [row.node.key, index])), [rows]);
  const activeKey =
    focusedKey !== null && indexByKey.has(focusedKey)
      ? focusedKey
      : selectedKey !== null && indexByKey.has(selectedKey)
        ? selectedKey
        : (rows[0]?.node.key ?? null);

  // Layout effect: focus must move before the next key press is handled.
  useLayoutEffect(() => {
    if (revealPending.current && selectedKey && rowElements.current.has(selectedKey)) {
      revealPending.current = false;
      rowElements.current.get(selectedKey)?.scrollIntoView({ block: 'nearest' });
    }
    const revealed = revealFocus.current !== null ? rowElements.current.get(revealFocus.current) : undefined;
    if (revealed) {
      revealFocus.current = null;
      revealed.focus({ preventScroll: true });
      revealed.scrollIntoView({ block: 'nearest' });
    }
    if (focusPending.current && activeKey) {
      focusPending.current = false;
      rowElements.current.get(activeKey)?.focus();
    }
  });

  const prefixLine = prefix !== '' && (
    <p class="tree-prefix" title="Folder shared by every test file, left out of the tree">
      <span class="visually-hidden">Files in </span>
      {prefix}
    </p>
  );

  const moveFocus = (row: VisibleRow | undefined): void => {
    if (!row) return;
    focusPending.current = true;
    setFocusedKey(row.node.key);
  };

  const setOpen = (key: string, open: boolean): void => {
    setExpanded((previous) => {
      if (previous.has(key) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (activeKey === null || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = indexByKey.get(activeKey) ?? 0;
    const row = rows[index];
    if (!row) return;
    const { node } = row;
    const isGroup = node.kind !== 'test';
    const isOpen = isGroup && expanded.has(node.key);

    switch (event.key) {
      case 'ArrowDown':
        moveFocus(rows[index + 1]);
        break;
      case 'ArrowUp':
        moveFocus(rows[index - 1]);
        break;
      case 'Home':
        moveFocus(rows[0]);
        break;
      case 'End':
        moveFocus(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (isGroup && !isOpen) setOpen(node.key, true);
        else if (isOpen) moveFocus(rows[index + 1]);
        break;
      case 'ArrowLeft':
        if (isOpen) setOpen(node.key, false);
        else if (row.parentKey !== null) moveFocus(rows[indexByKey.get(row.parentKey) ?? -1]);
        break;
      case 'Enter':
      case ' ':
        if (node.kind === 'test') navigate({ page: 'test', id: node.testId, repeatEachIndex: node.repeatEachIndex });
        else setOpen(node.key, !isOpen);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div class="tree-section">
      <div class="tree-toolbar">
        <h2 id="tree-heading">Tests</h2>
        <button type="button" class="text-button" onClick={() => setExpanded(new Set(groupKeys(roots)))}>
          Expand all
        </button>
        <button type="button" class="text-button" onClick={() => setExpanded(new Set())}>
          Collapse all
        </button>
      </div>
      {prefixLine}
      {roots.length === 0 ? (
        <p class="tree-empty">{emptyMessage}</p>
      ) : (
        <ul class="tree" role="tree" aria-labelledby="tree-heading" onKeyDown={onKeyDown}>
          {rows.map((row) => {
            const { key } = row.node;
            const ref = (element: HTMLLIElement | null): void => {
              if (element) rowElements.current.set(key, element);
              else rowElements.current.delete(key);
            };
            // `key` is passed explicitly below: in a spread, the automatic JSX runtime renders it as an attribute.
            const common = {
              ref,
              role: 'treeitem' as const,
              'aria-level': row.level,
              'aria-setsize': row.siblings,
              'aria-posinset': row.position,
              tabIndex: key === activeKey ? 0 : -1,
              style: { '--level': row.level },
              onFocus: () => setFocusedKey(key),
            };
            return row.node.kind === 'test' ? (
              <li key={key} {...common} class="tree-row tree-test" aria-selected={key === selectedKey}>
                <TestRow node={row.node} />
              </li>
            ) : (
              <li
                key={key}
                {...common}
                class={`tree-row tree-group tree-${row.node.kind}${key === revealedKey ? ' revealed' : ''}`}
                aria-expanded={expanded.has(key)}
              >
                <GroupRow node={row.node} onToggle={() => setOpen(key, !expanded.has(key))} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TestRow({ node }: { node: TestNode }) {
  return (
    <a class="row-content" tabIndex={-1} href={hrefTo({ page: 'test', id: node.testId, repeatEachIndex: node.repeatEachIndex })}>
      <OutcomeIcon outcome={node.outcome} />
      <span class="row-label">{node.title}</span>
      {node.repeatEachIndex > 0 && <span class="row-note">repeat {node.repeatEachIndex}</span>}
    </a>
  );
}

/**
 * A file name cut in the middle when it does not fit, never at the start, the
 * extension kept. The full path is what assistive technologies read.
 */
function FileName({ name, path }: { name: string; path: string }) {
  const [head, tail] = splitForMiddleEllipsis(name);
  return (
    <span class="label-part file-name">
      <span class="name-head" aria-hidden="true">
        {head}
      </span>
      {tail && (
        <span class="name-tail" aria-hidden="true">
          {tail}
        </span>
      )}
      <span class="visually-hidden">{path}</span>
    </span>
  );
}

function GroupRow({ node, onToggle }: { node: GroupNode; onToggle: () => void }) {
  const { counts } = node;
  const summary = [plural(counts.total, 'test'), `${counts.failed} failed`, ...(counts.flaky > 0 ? [`${counts.flaky} flaky`] : [])].join(', ');
  const [first = '', ...rest] = node.labels;
  const tooltip = [node.kind === 'folder' ? `${node.path ?? first}/` : (node.path ?? first), ...rest].join(' › ');
  return (
    <div class="row-content" onClick={onToggle}>
      <ChevronIcon class="chevron" />
      <span class="row-label" title={tooltip}>
        {node.kind === 'file' ? <FileName name={first} path={node.path ?? first} /> : <span class="label-part">{first}</span>}
        {rest.map((label, index) => (
          <span key={index} class="label-part">
            {label}
          </span>
        ))}
      </span>
      <span class="row-counts" title={summary}>
        <span class="visually-hidden">{summary}</span>
        {counts.failed > 0 && (
          <span class="badge badge-failed" aria-hidden="true">
            {counts.failed}
          </span>
        )}
        <span class="row-total" aria-hidden="true">
          {counts.total}
        </span>
      </span>
    </div>
  );
}
