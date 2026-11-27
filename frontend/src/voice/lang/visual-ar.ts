// Arabic phrases and replies for the universal visual exploration engine.
// Replies are built only from approved labels, categories and values in the view;
// labels and values are spoken as approved (they may be in English).
import type { ElementRef, ElementView, LinkView, VisualPack } from './types';

const CATEGORIES: Record<string, [string, string]> = {
  node: ['العقدة', 'العقد'],
  resistor: ['مقاومة', 'مقاومات'],
  'voltage source': ['مصدر جهد', 'مصادر جهد'],
  'current source': ['مصدر تيار', 'مصادر تيار'],
  capacitor: ['مكثف', 'مكثفات'],
  inductor: ['ملف', 'ملفات'],
  start: ['البداية', 'البدايات'],
  end: ['النهاية', 'النهايات'],
  process: ['خطوة', 'خطوات'],
  decision: ['قرار', 'قرارات'],
  input: ['خطوة إدخال', 'خطوات إدخال'],
  output: ['خطوة إخراج', 'خطوات إخراج'],
};

function cat(category: string, plural = false): string {
  const known = CATEGORIES[category.toLowerCase()];
  if (known) return plural ? known[1] : known[0];
  return category;
}

const end = (text: string) => (/[.!?؟]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
const catAfter = (label: string, category: string) => (label.trim() === cat(category) ? '' : `، ${cat(category)}`);

function join(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;
}

function place(ref: ElementRef): string {
  return ref.category === 'node' ? `العقدة ${ref.label}` : ref.label;
}

function short(ref: ElementRef): string {
  return `${ref.label} (${cat(ref.category)}${ref.primary ? `، ${ref.primary}` : ''})`;
}

function optionName(o: LinkView): string {
  if (o.via) return o.via.label;
  if (o.label) return `${o.label}، إلى ${o.to.label}`;
  return o.to.label;
}

function outgoingText(view: ElementView): string {
  const out = view.out;
  if (view.docType === 'circuit') return out.length ? `موصولة بـ ${join(out.map((o) => o.via?.label ?? place(o.to)))}.` : 'لا يوجد شيء موصول هنا.';
  if (!out.length) return view.element.category === 'end' ? 'هذه نهاية من نهايات المخطط.' : 'لا يخرج سهم من هذه الخطوة.';
  if (out.length === 1 && !out[0].label) return end(`التالي: ${out[0].to.label}`);
  return end(`الأسهم: ${out.map((o) => `${o.label ?? 'بلا عنوان'}، إلى ${o.to.label}`).join('؛ ')}`);
}

function describe(view: ElementView, level: 'brief' | 'detailed'): string {
  const e = view.element;
  const detailed = level === 'detailed';
  let text: string;
  if (e.role === 'link') {
    text = `${e.label}، ${cat(e.category)}${e.primary ? `، ${e.primary}` : ''}. يصل بين ${join(view.ends.map(place))}.`;
  } else if (view.docType === 'circuit') {
    text = detailed && view.out.length
      ? `العقدة ${e.label}. ${view.out.map((o) => `${o.via ? short(o.via) : ''} يؤدي إلى ${place(o.to)}`).join('؛ ')}.`
      : `العقدة ${e.label}. ${outgoingText(view)}`;
  } else {
    text = `${end(`${e.label}${catAfter(e.label, e.category)}`)} ${outgoingText(view)}`;
  }
  if (detailed) {
    const more: string[] = [];
    for (const a of e.attributes.slice(1)) more.push(`${a.name}: ${a.value}.`);
    if (e.detail) more.push(e.detail.trim());
    if (view.incoming.length) more.push(`الأسهم الداخلة من: ${join(view.incoming.map((r) => r.label))}.`);
    if (more.length) text += ` ${more.join(' ')}`;
  }
  return text + (e.uncertain ? ' مُعلَّم كغير مؤكد في المخطط المعتمد.' : '');
}

export const visualAr: VisualPack = {
  commands: {
    tourStart: ['ابدأ الجولة', 'ابدأ جولة', 'جولة في المخطط', 'خذني في جولة', 'عرفني على المخطط', 'جولة في الدائرة'],
    tourNext: ['الجزء التالي', 'الخطوة التالية', 'العنصر التالي', 'تابع الجولة'],
    tourPrev: ['الجزء السابق', 'الخطوة السابقة', 'العنصر السابق'],
    tourRepeat: ['أعد هذا الجزء', 'كرر هذا الجزء', 'أعد الجزء', 'كرر الجزء'],
    tourRestart: ['ارجع إلى البداية', 'عد إلى البداية', 'من البداية', 'أعد الجولة من البداية', 'أعد الجولة'],
    tourStop: ['أوقف الجولة', 'أنه الجولة', 'إنهاء الجولة', 'اخرج من الجولة'],
    where: ['أين أنا', 'أين أنا في المخطط', 'أين أنا في الجولة'],
    whatHere: ['ما المتصل هنا', 'ماذا يوجد هنا', 'ما الموجود هنا', 'ما المتصل بهذه العقدة'],
    whatNext: ['ماذا يحدث بعد ذلك', 'ماذا بعد', 'إلى أين يؤدي', 'ماذا يأتي بعد ذلك'],
    elseHere: ['ماذا يوجد أيضا هنا', 'ما المتصل أيضا هنا', 'هل يوجد شيء آخر هنا'],
    stepBack: ['ارجع خطوة', 'عد خطوة', 'خطوة للخلف', 'ارجع إلى حيث كنت'],
    cameFrom: ['من أين أتيت', 'أين كنت', 'من أين جئت'],
    brief: ['باختصار', 'صف باختصار', 'الوضع المختصر', 'عد إلى الوضع المختصر', 'اختصر'],
    detailed: ['مزيد من التفاصيل', 'بالتفصيل', 'أعطني تفاصيل أكثر', 'تفاصيل أكثر', 'الوضع المفصل'],
  },
  goTo: ['ابدأ من', 'ابدأ عند', 'اذهب إلى', 'انتقل إلى', 'خذني إلى'],
  follow: ['اتبع', 'تتبع', 'اسلك'],
  refFillers: ['فرع', 'الفرع', 'مسار', 'المسار', 'السلك', 'عبر', 'سهم', 'السهم'],
  categories: CATEGORIES,
  responses: {
    category: cat,
    describe,
    here: (view) => {
      if (view.docType === 'circuit') {
        return view.out.length
          ? `عند العقدة ${view.element.label}: ${view.out.map((o) => `${o.via ? short(o.via) : ''} إلى ${place(o.to)}`).join('؛ ')}.`
          : `لا يوجد شيء موصول بالعقدة ${view.element.label}.`;
      }
      return `عند ${view.element.label}: ${outgoingText(view)}`;
    },
    tourIntro: (summary, count) =>
      `${summary ? `${summary} ` : ''}في الجولة ${count} ${count === 1 ? 'جزء' : 'أجزاء'}. قل الجزء التالي للمتابعة، أو أوقف الجولة في أي وقت.`,
    tourPart: (k, n, body) => `الجزء ${k} من ${n}. ${body}`,
    tourEnd: 'كان هذا الجزء الأخير. قل ارجع إلى البداية لسماع الجولة مرة أخرى، أو أوقف الجولة.',
    tourAtFirst: 'هذا هو الجزء الأول. قل الجزء التالي للمتابعة.',
    tourNotActive: 'لم تبدأ الجولة بعد. قل ابدأ الجولة.',
    tourStopped: 'توقفت الجولة. ما زال بإمكانك السؤال عن أي جزء، أو قل ابدأ الجولة.',
    tourRestart: (body) => `من البداية. ${body}`,
    emptyDiagram: 'لا يحتوي هذا المخطط على أجزاء لاستكشافها.',
    where: (tour, at) => {
      const parts = [
        tour ? `في الجولة: الجزء ${tour.position} من ${tour.count}، ${tour.label}.` : '',
        at ? `أنت عند ${at}.` : '',
      ].filter(Boolean);
      return parts.length ? parts.join(' ') : 'لم تبدأ استكشاف أي جزء بعد. قل ابدأ الجولة، أو ابدأ من ثم اسم الجزء.';
    },
    noPosition: 'اختر نقطة البداية أولاً: قل ابدأ من ثم اسم الجزء.',
    moved: (body) => body,
    followed: (link, body) => `${link.via ? `بالمتابعة عبر ${link.via.label}` : link.label ? `باتباع سهم ${link.label}` : 'باتباع السهم'}. ${body}`,
    atLink: (link, ends) =>
      `${link.label} ${cat(link.category)} يصل بين ${join(ends.map(place))}.${ends.length ? ` قل ابدأ من ${place(ends[0])} للاستكشاف من هناك.` : ''}`,
    chooseLink: (at, options) => `من ${place(at)} يمكنك اتباع ${join(options.map(optionName))}. قل اتبع ثم أحدها.`,
    noSuchLink: (ref, at, options) =>
      options.length ? `${ref} غير موصول بـ ${place(at)}. من هنا يمكنك اتباع ${join(options.map(optionName))}.` : `لا يؤدي شيء إلى أبعد من ${place(at)}.`,
    deadEnd: (at) => (at.category === 'node' ? `لا يوجد شيء آخر موصول بـ ${place(at)}.` : `لا يخرج سهم من ${at.label}.`),
    elseHere: (at, options) => `أيضاً عند ${place(at)}: ${join(options.map(optionName))}.`,
    nothingElse: (at) => `لا يوجد شيء آخر عند ${place(at)}.`,
    stepBack: (body) => `رجوع. ${body}`,
    nothingToGoBack: 'لا يوجد موضع سابق للرجوع إليه.',
    cameFrom: (prev, via, incoming) =>
      `${prev ? `أتيت من ${place(prev)}${via ? ` عبر ${via.label}` : ''}.` : 'هنا بدأت الاستكشاف.'}${
        incoming.length ? ` الأسهم الداخلة إلى هذه الخطوة تأتي من ${join(incoming.map((r) => r.label))}.` : ''
      }`,
    notFound: (ref, examples) => `لا يوجد ${ref} في هذا المخطط. من الأجزاء: ${join(examples.map((e) => (e.category === 'node' ? place(e) : e.label)))}.`,
    ambiguous: (ref, matches) => `أكثر من جزء يطابق ${ref}: ${join(matches.map((m) => m.label))}. قل الاسم الكامل.`,
    briefOn: 'أوصاف مختصرة.',
    detailedOn: 'أوصاف مفصلة.',
  },
};
