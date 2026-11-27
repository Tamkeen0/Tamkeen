// Universal visual exploration engine: one consistent interaction for every diagram type.
//
// Three independent states (a question about an element never resets the tour):
//   tour      — guided reading order position (adapter-defined order)
//   position  — where the student "stands" for relationship exploration, with history
//   detail    — 'brief' (default) or 'detailed'
//
// It only describes approved data (labels, categories, attributes, relations). It never
// computes, infers relationships, or invents labels. All wording comes from the language
// packs (English and Arabic); nothing is hardcoded here.
import { PACKS } from '../lang';
import type { ElementRef, ElementView, LinkView, VisualResponses } from '../lang/types';
import { getLanguage } from '../language';
import type { VoiceLanguage } from '../language';
import { hasArabic } from '../normalize';
import type { ExploreAction } from './commands';
import type { VisualDocument, VisualElement, VisualRelation } from './model';
import { matchesLabel, resolveRef } from './refs';

export type DetailLevel = 'brief' | 'detailed';

type Arrival = { via?: string; from: string; label?: string } | null;

export interface ExplorerSnapshot {
  tour: { active: boolean; index: number; count: number };
  position: string | null;
  detail: DetailLevel;
}

export class VisualExplorer {
  readonly doc: VisualDocument;
  detail: DetailLevel = 'brief';
  /** Element most recently described (pronoun focus, subject of "more detail"). */
  lastElement: string | null = null;
  private readonly byId: Map<string, VisualElement>;
  private tourActive = false;
  private tourIndex = -1;
  private position: string | null = null;
  private arrived: Arrival = null;
  private readonly history: { at: string; arrived: Arrival }[] = [];

  constructor(doc: VisualDocument) {
    this.doc = doc;
    this.byId = new Map(doc.elements.map((e) => [e.id, e]));
  }

  get snapshot(): ExplorerSnapshot {
    return {
      tour: { active: this.tourActive, index: this.tourIndex, count: this.doc.readingOrder.length },
      position: this.position,
      detail: this.detail,
    };
  }

  /** True once the student has started a tour or chosen a position. */
  get isActive(): boolean {
    return this.tourActive || this.position !== null;
  }

  /** Perform one exploration action and return the reply in the requested language. */
  act(action: ExploreAction, language?: VoiceLanguage, utterance = ''): string {
    const lang: VoiceLanguage = hasArabic(utterance) ? 'ar' : (language ?? getLanguage());
    const r = (PACKS[lang] ?? PACKS.en).visual.responses;
    switch (action.type) {
      case 'tourStart':
        return this.startTour(r, true);
      case 'tourRestart':
        return this.doc.readingOrder.length ? r.tourRestart(this.startTour(r, false)) : r.emptyDiagram;
      case 'tourNext':
        return this.moveTour(r, +1);
      case 'tourPrev':
        return this.moveTour(r, -1);
      case 'tourRepeat':
        return this.tourActive ? this.part(r) : r.tourNotActive;
      case 'tourStop':
        this.tourActive = false;
        return r.tourStopped;
      case 'where':
        return r.where(
          this.tourActive ? { position: this.tourIndex + 1, count: this.doc.readingOrder.length, label: this.name(this.tourId()!) } : null,
          this.position ? this.name(this.position) : null,
        );
      case 'goTo':
        return this.goTo(r, action.ref);
      case 'whatHere': {
        const at = this.here();
        if (!at) return r.noPosition;
        const e = this.byId.get(at)!;
        this.lastElement = at;
        return e.role === 'link' ? r.atLink(this.ref(at), this.view(at).ends) : r.here(this.view(at));
      }
      case 'whatNext':
        return this.follow(r, null, false);
      case 'follow':
        return this.follow(r, action.ref, true);
      case 'elseHere': {
        const at = this.position;
        if (!at) return r.noPosition;
        const others = this.view(at).out.filter((o) => !this.isArrival(o));
        return others.length ? r.elseHere(this.ref(at), others) : r.nothingElse(this.ref(at));
      }
      case 'stepBack': {
        const prev = this.history.pop();
        if (!prev) return r.nothingToGoBack;
        this.position = prev.at;
        this.arrived = prev.arrived;
        return r.stepBack(this.describe(r, prev.at));
      }
      case 'cameFrom': {
        if (!this.position) return r.noPosition;
        const incoming = this.view(this.position).incoming;
        if (!this.arrived) return r.cameFrom(null, null, incoming);
        return r.cameFrom(this.ref(this.arrived.from), this.arrived.via ? this.ref(this.arrived.via) : null, incoming);
      }
      case 'brief':
        this.detail = 'brief';
        return r.briefOn;
      case 'detailed': {
        this.detail = 'detailed';
        const subject = this.lastElement ?? this.here();
        return subject ? `${r.detailedOn} ${this.describe(r, subject)}` : r.detailedOn;
      }
    }
  }

  // ---------- tour ----------

  private tourId(): string | null {
    return this.tourActive ? this.doc.readingOrder[this.tourIndex] ?? null : null;
  }

  private part(r: VisualResponses): string {
    const id = this.tourId()!;
    return r.tourPart(this.tourIndex + 1, this.doc.readingOrder.length, this.describe(r, id));
  }

  private startTour(r: VisualResponses, intro: boolean): string {
    if (!this.doc.readingOrder.length) return r.emptyDiagram;
    this.tourActive = true;
    this.tourIndex = 0;
    const first = this.part(r);
    return intro ? `${r.tourIntro(this.doc.summary, this.doc.readingOrder.length, this.doc.type)} ${first}` : first;
  }

  private moveTour(r: VisualResponses, step: number): string {
    if (!this.tourActive) return r.tourNotActive;
    const next = this.tourIndex + step;
    if (next < 0) return r.tourAtFirst;
    if (next >= this.doc.readingOrder.length) return r.tourEnd;
    this.tourIndex = next;
    return this.part(r);
  }

  // ---------- relationship exploration ----------

  /** Current place: the chosen position, else the current tour part. */
  private here(): string | null {
    return this.position ?? this.tourId();
  }

  private moveTo(id: string, arrived: Arrival): void {
    if (this.position) this.history.push({ at: this.position, arrived: this.arrived });
    this.position = id;
    this.arrived = arrived;
  }

  private goTo(r: VisualResponses, ref: string): string {
    const matches = resolveRef(this.doc, ref);
    if (!matches.length) return r.notFound(ref, this.examples());
    if (matches.length > 1) return r.ambiguous(ref, matches.map((m) => this.ref(m.id)));
    const target = matches[0];
    this.lastElement = target.id;
    if (target.role === 'link') return r.atLink(this.ref(target.id), this.view(target.id).ends);
    this.moveTo(target.id, null);
    return r.moved(this.describe(r, target.id));
  }

  private follow(r: VisualResponses, ref: string | null, move: boolean): string {
    let at = this.position;
    // Following from a tour part that is a place starts exploring there.
    if (!at) {
      const tourPlace = this.tourId();
      if (tourPlace && this.byId.get(tourPlace)?.role === 'place') {
        this.position = at = tourPlace;
        this.arrived = null;
      } else if (tourPlace) {
        return r.atLink(this.ref(tourPlace), this.view(tourPlace).ends);
      } else {
        return r.noPosition;
      }
    }
    const options = this.view(at).out;
    let chosen: LinkView[];
    if (ref === null) {
      if (!options.length) return r.deadEnd(this.ref(at));
      if (options.length > 1 || !move) {
        if (options.length > 1) return r.chooseLink(this.ref(at), options);
      }
      chosen = options;
    } else {
      chosen = options.filter(
        (o) =>
          (o.via && (matchesLabel(ref, o.via.label) || matchesLabel(ref, o.via.id))) ||
          matchesLabel(ref, o.label) ||
          resolveRef(this.doc, ref, [this.byId.get(o.to.id)!]).length > 0,
      );
      if (!chosen.length) {
        const exists = resolveRef(this.doc, ref).length > 0;
        return exists ? r.noSuchLink(ref, this.ref(at), options) : r.notFound(ref, this.examples());
      }
      if (chosen.length > 1) return r.chooseLink(this.ref(at), chosen);
    }
    const link = chosen[0];
    this.moveTo(link.to.id, { via: link.via?.id, from: at, label: link.label });
    return r.followed(link, this.describe(r, link.to.id));
  }

  private isArrival(o: LinkView): boolean {
    const a = this.arrived;
    if (!a) return false;
    if (a.via) return o.via?.id === a.via;
    return o.to.id === a.from && !o.directed;
  }

  // ---------- views ----------

  private name(id: string): string {
    const e = this.byId.get(id)!;
    return e.label;
  }

  private ref(id: string): ElementRef {
    const e = this.byId.get(id)!;
    return { id: e.id, label: e.label, category: e.category, primary: e.attributes[0]?.value };
  }

  private examples(): ElementRef[] {
    const order = this.doc.readingOrder.length ? this.doc.readingOrder : this.doc.elements.map((e) => e.id);
    return order.slice(0, 6).map((id) => this.ref(id));
  }

  private view(id: string): ElementView {
    const e = this.byId.get(id)!;
    const touches = (rel: VisualRelation) => rel.from === id || (!rel.directed && rel.to === id);
    const out: LinkView[] =
      e.role === 'place'
        ? this.doc.relations.filter(touches).map((rel) => ({
            to: this.ref(rel.from === id ? rel.to : rel.from),
            via: rel.via ? this.ref(rel.via) : undefined,
            label: rel.label,
            directed: rel.directed,
          }))
        : [];
    const incoming = e.role === 'place' ? this.doc.relations.filter((rel) => rel.directed && rel.to === id).map((rel) => this.ref(rel.from)) : [];
    const ends: ElementRef[] = [];
    if (e.role === 'link') {
      for (const rel of this.doc.relations.filter((x) => x.via === id)) {
        for (const end of [rel.from, rel.to]) if (!ends.some((x) => x.id === end)) ends.push(this.ref(end));
      }
    }
    return {
      element: { ...this.ref(id), role: e.role, attributes: e.attributes, detail: e.detail, uncertain: e.uncertain },
      docType: this.doc.type,
      out,
      incoming,
      ends,
    };
  }

  private describe(r: VisualResponses, id: string, level: DetailLevel = this.detail): string {
    this.lastElement = id;
    return r.describe(this.view(id), level);
  }
}
