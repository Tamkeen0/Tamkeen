// English phrases and replies for the universal visual exploration engine.
// Replies are built only from approved labels, categories and values in the view.
import type { ElementRef, ElementView, LinkView, VisualPack } from './types';

const CATEGORIES: Record<string, [string, string]> = {
  node: ['node', 'nodes'],
  start: ['start', 'starts'],
  end: ['end', 'ends'],
  process: ['step', 'steps'],
  decision: ['decision', 'decisions'],
  input: ['input step', 'input steps'],
  output: ['output step', 'output steps'],
};

function cat(category: string, plural = false): string {
  const known = CATEGORIES[category.toLowerCase()];
  if (known) return plural ? known[1] : known[0];
  return plural ? `${category}s` : category;
}

/** End a sentence without doubling punctuation ("Item in stock?" stays as is). */
const end = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** Category spoken after a label, unless the label already says it ("Start", "End"). */
const catAfter = (label: string, category: string) => (label.trim().toLowerCase() === cat(category).toLowerCase() ? '' : `, ${cat(category)}`);

function join(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** How a place is named aloud: "node B" in a circuit, the step text in a flowchart. */
function place(ref: ElementRef): string {
  return ref.category === 'node' ? `node ${ref.label}` : ref.label;
}

function short(ref: ElementRef): string {
  return `${ref.label} (${cat(ref.category)}${ref.primary ? `, ${ref.primary}` : ''})`;
}

function optionName(o: LinkView): string {
  if (o.via) return o.via.label;
  if (o.label) return `${o.label}, to ${o.to.label}`;
  return o.to.label;
}

function outgoingText(view: ElementView): string {
  const out = view.out;
  if (view.docType === 'circuit') return out.length ? `Connected to ${join(out.map((o) => o.via?.label ?? place(o.to)))}.` : 'Nothing is connected here.';
  if (!out.length) return view.element.category === 'end' ? 'This is an end of the flowchart.' : 'No arrow leaves this step.';
  if (out.length === 1 && !out[0].label) return end(`Next: ${out[0].to.label}`);
  return end(`Arrows: ${out.map((o) => `${o.label ?? 'unlabelled'}, to ${o.to.label}`).join('; ')}`);
}

function extras(view: ElementView): string[] {
  const e = view.element;
  const parts: string[] = [];
  for (const a of e.attributes.slice(1)) parts.push(`${a.name}: ${a.value}.`);
  if (e.detail) parts.push(e.detail.trim().replace(/([^.!?])$/, '$1.'));
  return parts;
}

function uncertain(view: ElementView): string {
  return view.element.uncertain ? ' Marked uncertain in the approved diagram.' : '';
}

function describe(view: ElementView, level: 'brief' | 'detailed'): string {
  const e = view.element;
  const detailed = level === 'detailed';
  let text: string;
  if (e.role === 'link') {
    text = `${e.label}, ${cat(e.category)}${e.primary ? `, ${e.primary}` : ''}. Connects ${join(view.ends.map(place))}.`;
  } else if (view.docType === 'circuit') {
    text = detailed && view.out.length
      ? `Node ${e.label}. ${view.out.map((o) => `${o.via ? short(o.via) : ''} leads to ${place(o.to)}`).join('; ')}.`
      : `Node ${e.label}. ${outgoingText(view)}`;
  } else {
    text = `${end(`${e.label}${catAfter(e.label, e.category)}`)} ${outgoingText(view)}`;
  }
  if (detailed) {
    const more = extras(view);
    if (view.incoming.length) more.push(end(`Arrows in from: ${join(view.incoming.map((r) => r.label))}`));
    if (more.length) text += ` ${more.join(' ')}`;
  }
  return text + uncertain(view);
}

export const visualEn: VisualPack = {
  commands: {
    tourStart: [
      'walk me through this diagram', 'walk me through the diagram', 'walk me through this circuit', 'walk me through the circuit',
      'walk me through this flowchart', 'walk me through the flowchart', 'walk me through it', 'start the tour', 'start tour',
      'begin the tour', 'give me a tour', 'take me through the diagram', 'tour the diagram',
    ],
    tourNext: ['next part', 'next step', 'next element', 'next item', 'continue the tour'],
    tourPrev: ['previous part', 'previous step', 'previous element', 'last part', 'the part before', 'go back a part'],
    tourRepeat: ['repeat this part', 'repeat this step', 'repeat the part', 'say this part again', 'repeat part'],
    tourRestart: [
      'go back to the beginning', 'back to the beginning', 'go to the beginning', 'start from the beginning', 'from the beginning',
      'restart the tour', 'start the tour again', 'start over the tour',
    ],
    tourStop: ['stop the tour', 'end the tour', 'exit the tour', 'leave the tour', 'finish the tour'],
    where: ['where am i in the diagram', 'where am i in the tour', 'where am i on the diagram', 'where am i', 'what part is this', 'which part am i on'],
    whatHere: [
      'what is connected here', 'whats connected here', 'what is here', 'whats here', 'what is at this point', 'what connects here',
      'what is connected to this node', 'what is at this node', 'describe this point',
    ],
    whatNext: ['what happens next', 'what comes next', 'whats next', 'what is next', 'where does it go', 'where does this go', 'where does it lead', 'what follows'],
    elseHere: ['what else is here', 'what else is connected here', 'what else is connected', 'anything else here', 'what other parts are here'],
    stepBack: ['step back', 'go back a step', 'go back one step', 'back a step', 'one step back', 'go back to where i was', 'previous position'],
    cameFrom: ['where did i come from', 'how did i get here', 'where was i before', 'what was before this'],
    brief: ['describe briefly', 'brief mode', 'back to brief mode', 'be brief', 'briefly', 'less detail', 'shorter', 'brief'],
    detailed: ['give me more detail', 'more detail', 'more details', 'in detail', 'detailed mode', 'tell me more', 'more information', 'describe in detail', 'full detail'],
  },
  goTo: ['start at', 'start from', 'go to', 'jump to', 'move to', 'take me to', 'begin at', 'explore from', 'stand on'],
  follow: ['follow', 'take', 'go along', 'go through', 'move along'],
  refFillers: ['the', 'a', 'branch', 'path', 'arrow', 'wire', 'line', 'component', 'element', 'part', 'please'],
  categories: CATEGORIES,
  responses: {
    category: cat,
    describe,
    here: (view) => {
      if (view.docType === 'circuit') {
        return view.out.length
          ? `At node ${view.element.label}: ${view.out.map((o) => `${o.via ? short(o.via) : ''} to ${place(o.to)}`).join('; ')}.`
          : `Nothing is connected to node ${view.element.label}.`;
      }
      return `At ${view.element.label}: ${outgoingText(view)}`;
    },
    tourIntro: (summary, count) =>
      `${summary ? `${summary.replace(/([^.!?])$/, '$1.')} ` : ''}The tour has ${count} ${count === 1 ? 'part' : 'parts'}. Say next part to continue, or stop the tour at any time.`,
    tourPart: (k, n, body) => `Part ${k} of ${n}. ${body}`,
    tourEnd: 'That was the last part. Say go back to the beginning to hear the tour again, or stop the tour.',
    tourAtFirst: 'This is the first part. Say next part to continue.',
    tourNotActive: 'The tour has not started. Say start the tour.',
    tourStopped: 'Tour stopped. You can still ask about any part, or say start the tour.',
    tourRestart: (body) => `From the beginning. ${body}`,
    emptyDiagram: 'This diagram has no parts to explore.',
    where: (tour, at) => {
      const parts = [
        tour ? `In the tour: part ${tour.position} of ${tour.count}, ${tour.label}.` : '',
        at ? `You are at ${at}.` : '',
      ].filter(Boolean);
      return parts.length ? parts.join(' ') : 'You are not exploring a part yet. Say start the tour, or start at, then a name.';
    },
    noPosition: 'Choose where to start first: say start at, then the name of a part.',
    moved: (body) => body,
    followed: (link, body) =>
      `Following ${link.via ? link.via.label : link.label ? `the ${link.label} arrow` : 'the arrow'}. ${body}`,
    atLink: (link, ends) =>
      `${link.label} is a ${cat(link.category)} that connects ${join(ends.map(place))}.${ends.length ? ` Say start at ${place(ends[0])} to explore from there.` : ''}`,
    chooseLink: (at, options) => `From ${place(at)}, you can follow ${join(options.map(optionName))}. Say follow, then one of them.`,
    noSuchLink: (ref, at, options) =>
      options.length
        ? `${ref} is not connected to ${place(at)}. From here you can follow ${join(options.map(optionName))}.`
        : `Nothing leads on from ${place(at)}.`,
    deadEnd: (at) => (at.category === 'node' ? `Nothing else is connected to ${place(at)}.` : `No arrow leaves ${at.label}.`),
    elseHere: (at, options) => `Also at ${place(at)}: ${join(options.map(optionName))}.`,
    nothingElse: (at) => `There is nothing else at ${place(at)}.`,
    stepBack: (body) => `Back. ${body}`,
    nothingToGoBack: 'There is no earlier position to go back to.',
    cameFrom: (prev, via, incoming) =>
      `${prev ? `You came from ${place(prev)}${via ? ` along ${via.label}` : ''}.` : 'This is where you started exploring.'}${
        incoming.length ? ` Arrows into this step come from ${join(incoming.map((r) => r.label))}.` : ''
      }`,
    notFound: (ref, examples) => `There is no ${ref} in this diagram. Parts include ${join(examples.map((e) => (e.category === 'node' ? place(e) : e.label)))}.`,
    ambiguous: (ref, matches) => `More than one part matches ${ref}: ${join(matches.map((m) => m.label))}. Say the full name.`,
    briefOn: 'Brief descriptions.',
    detailedOn: 'Detailed descriptions.',
  },
};
