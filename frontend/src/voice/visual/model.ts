// Universal visual data model: one representation that the exploration engine
// understands, filled by a domain adapter per diagram type (circuit, flowchart, …).
//
// Everything here is APPROVED data. Adapters copy labels and values verbatim;
// the engine never computes, infers or invents elements or relationships.

/** Diagram types with an adapter and tests. Do not add a type without both. */
export type VisualType = 'circuit' | 'flowchart';

export interface VisualAttribute {
  /** Attribute key, localised by the language pack when known ("value", "text"); else spoken as is. */
  name: string;
  /** Approved value, spoken verbatim. */
  value: string;
}

export interface VisualElement {
  /** Stable identifier from the approved data ("R1", "A", "s3"). */
  id: string;
  /** What the student hears and can say ("R1", "node B", "Check stock"). */
  label: string;
  /** Adapter-defined category, localised by the language pack ("resistor", "node", "decision"). */
  category: string;
  /** Approved attributes in display order; the first is the primary fact for brief mode. */
  attributes: VisualAttribute[];
  /** Extra approved description, detailed mode only. */
  detail?: string;
  /** Marked uncertain in the approved data: always announced, never hidden. */
  uncertain?: boolean;
  /**
   * 'place': a position the student can stand on and move between (circuit node, flowchart step).
   * 'link': an element that joins places (circuit component); following it moves to its other end.
   */
  role: 'place' | 'link';
}

export interface VisualRelation {
  /** Place where the relation starts (or one end, if undirected). */
  from: string;
  /** Place where it ends (or the other end). */
  to: string;
  /** Domain meaning, used to choose wording: 'connection' (circuit), 'arrow' (flowchart). */
  kind: 'connection' | 'arrow';
  /** Link element that forms this relation (circuit component), if any. */
  via?: string;
  /** Printed label on the relation (flowchart branch "yes"/"no"), verbatim. */
  label?: string;
  directed: boolean;
}

export interface VisualDocument {
  type: VisualType;
  /** Approved overview, spoken at the start of a tour. */
  summary: string;
  elements: VisualElement[];
  relations: VisualRelation[];
  /** Element ids in the order a guided tour presents them (decided by the adapter, never by AI). */
  readingOrder: string[];
  /** Where relationship exploration starts if the student does not choose ("start of the flowchart"). */
  startAt?: string;
}

/** Thrown when approved data is structurally inconsistent; the diagram must be fixed, not guessed. */
export class VisualDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualDataError';
  }
}

/** Check references so the engine can never point at something that does not exist. */
export function validateDocument(doc: VisualDocument): VisualDocument {
  const ids = new Set<string>();
  for (const e of doc.elements) {
    if (!e.id || ids.has(e.id)) throw new VisualDataError(`Duplicate or empty element id: "${e.id}"`);
    ids.add(e.id);
  }
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  for (const r of doc.relations) {
    for (const end of [r.from, r.to]) {
      if (byId.get(end)?.role !== 'place') throw new VisualDataError(`Relation end "${end}" is not a known place`);
    }
    if (r.via !== undefined && byId.get(r.via)?.role !== 'link') throw new VisualDataError(`Relation via "${r.via}" is not a known link`);
  }
  for (const id of doc.readingOrder) if (!ids.has(id)) throw new VisualDataError(`Reading order names unknown element "${id}"`);
  if (doc.startAt !== undefined && byId.get(doc.startAt)?.role !== 'place') {
    throw new VisualDataError(`Start "${doc.startAt}" is not a known place`);
  }
  return doc;
}
