// Circuit adapter: contracts/types.ts Diagram -> VisualDocument.
//
//   nodes       -> places   (the student stands on a node)
//   components  -> links    (following R1 from node A moves to its other terminal)
//   terminals   -> one undirected 'connection' relation per component, via the component
//   tour order  -> components in the approved order (nodes are reached by exploring)
//
// Values are copied verbatim. No topology (series/parallel), no calculations.
import type { Diagram } from '../../../../../contracts/types';
import { validateDocument } from '../model';
import type { VisualDocument } from '../model';

export function circuitToVisual(diagram: Diagram): VisualDocument {
  const nodes = (diagram.nodes ?? []).filter((n): n is string => typeof n === 'string' && n.length > 0);
  const components = (diagram.components ?? []).filter(
    (c) => c && typeof c.id === 'string' && Array.isArray(c.terminals) && c.terminals.length === 2,
  );
  const doc: VisualDocument = {
    type: 'circuit',
    summary: String(diagram.description ?? '').trim(),
    elements: [
      ...components.map((c) => ({
        id: c.id,
        label: c.id,
        category: c.kind,
        attributes: [{ name: 'value', value: c.value }],
        role: 'link' as const,
      })),
      ...nodes.map((n) => ({ id: `node:${n}`, label: n, category: 'node', attributes: [], role: 'place' as const })),
    ],
    relations: components.map((c) => ({
      from: `node:${c.terminals[0]}`,
      to: `node:${c.terminals[1]}`,
      kind: 'connection' as const,
      via: c.id,
      directed: false,
    })),
    readingOrder: components.map((c) => c.id),
    startAt: nodes.length ? `node:${nodes[0]}` : undefined,
  };
  return validateDocument(doc);
}
