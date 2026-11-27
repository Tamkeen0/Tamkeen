// Flowchart adapter: approved flowchart data -> VisualDocument.
//
//   steps   -> places (start, process, decision, input/output, end)
//   arrows  -> directed 'arrow' relations, with the printed branch label ("yes"/"no") verbatim
//   tour    -> from the start step, following arrows in their listed order (depth first);
//              steps not reachable from the start come last, unchanged
//
// NOTE: contracts/types.ts has no flowchart type yet, so this data cannot come from
// the API until the lead approves a contract addition. Used by tests and the dev page.
import { validateDocument, VisualDataError } from '../model';
import type { VisualDocument } from '../model';

export type FlowchartStepKind = 'start' | 'end' | 'process' | 'decision' | 'input' | 'output';

export interface FlowchartStep {
  id: string;
  /** Text printed in the shape, verbatim ("Check stock"). */
  label: string;
  kind: FlowchartStepKind;
  /** Further approved text for detailed mode. */
  detail?: string;
  uncertain?: boolean;
}

export interface FlowchartArrow {
  from: string;
  to: string;
  /** Printed label on the arrow, verbatim ("yes", "no"); omit if none is printed. */
  label?: string;
}

export interface FlowchartData {
  /** Approved overview. */
  description: string;
  steps: FlowchartStep[];
  arrows: FlowchartArrow[];
}

const KINDS = new Set<FlowchartStepKind>(['start', 'end', 'process', 'decision', 'input', 'output']);

export function flowchartToVisual(data: FlowchartData): VisualDocument {
  const steps = data.steps ?? [];
  for (const s of steps) if (!KINDS.has(s.kind)) throw new VisualDataError(`Unknown flowchart step kind "${s.kind}"`);
  const ids = new Set(steps.map((s) => s.id));
  const arrows = (data.arrows ?? []).map((a) => {
    if (!ids.has(a.from) || !ids.has(a.to)) throw new VisualDataError(`Arrow ${a.from} -> ${a.to} names an unknown step`);
    return a;
  });

  // Reading order: depth first from the start step(s), following arrows in their listed order.
  const incoming = new Set(arrows.map((a) => a.to));
  const starts = steps.filter((s) => s.kind === 'start');
  const roots = starts.length ? starts : steps.filter((s) => !incoming.has(s.id)).slice(0, 1);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const a of arrows) if (a.from === id) visit(a.to);
  };
  for (const r of roots) visit(r.id);
  for (const s of steps) if (!seen.has(s.id)) order.push(s.id); // unreachable steps: listed, not connected

  const doc: VisualDocument = {
    type: 'flowchart',
    summary: String(data.description ?? '').trim(),
    elements: steps.map((s) => ({
      id: s.id,
      label: s.label,
      category: s.kind,
      attributes: [],
      detail: s.detail,
      uncertain: s.uncertain,
      role: 'place' as const,
    })),
    relations: arrows.map((a) => ({ from: a.from, to: a.to, kind: 'arrow' as const, label: a.label, directed: true })),
    readingOrder: order,
    startAt: roots[0]?.id,
  };
  return validateDocument(doc);
}
