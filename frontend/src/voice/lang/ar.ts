import type { Component } from '../../../../contracts/types';
import type { LanguagePack } from './types';

// Modern Standard Arabic with a few common colloquial forms. Phrases are
// normalised at load time (hamza/taa marbuta/diacritics folded), so they can
// be written naturally here. Diagram values and descriptions come from the
// approved exam data and are read verbatim (they may be in English).

const KIND_NAMES: Record<string, [string, string]> = {
  resistor: ['مقاومة', 'مقاومات'],
  'voltage source': ['مصدر جهد', 'مصادر جهد'],
  'current source': ['مصدر تيار', 'مصادر تيار'],
  capacitor: ['مكثف', 'مكثفات'],
  inductor: ['ملف', 'ملفات'],
  diode: ['ثنائي', 'ثنائيات'],
  battery: ['بطارية', 'بطاريات'],
  switch: ['مفتاح', 'مفاتيح'],
  ground: ['أرضي', 'أرضي'],
  lamp: ['مصباح', 'مصابيح'],
};

function kindName(kind: string, count = 1): string {
  const names = KIND_NAMES[kind.toLowerCase()];
  if (!names) return kind;
  return count === 1 ? names[0] : names[1];
}

function join(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;
}

function short(c: Component): string {
  return `${c.id} (${kindName(c.kind)}، ${c.value})`;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?؟]$/.test(t) ? t : `${t}.`;
}

export const ar: LanguagePack = {
  commands: {
    next: ['التالي', 'السؤال التالي', 'بعده', 'اللي بعده'],
    previous: ['السابق', 'السؤال السابق', 'رجوع', 'ارجع', 'قبله', 'اللي قبله'],
    repeat: ['أعد', 'كرر', 'إعادة', 'تكرار', 'أعد السؤال', 'كرر السؤال', 'اقرأ السؤال', 'مرة أخرى', 'أعد القراءة'],
    dictate: ['إملاء', 'إجابة', 'أجب', 'جاوب', 'ابدأ الإجابة', 'سجل الإجابة', 'اكتب الإجابة'],
    confirm: ['تأكيد', 'أكد', 'احفظ', 'حفظ', 'تأكيد الإجابة', 'احفظ الإجابة'],
    cancel: ['إلغاء', 'ألغ', 'ألغي', 'توقف', 'قف', 'لا', 'تراجع'],
    submit: ['تسليم', 'سلم', 'سلّم الامتحان', 'تسليم الامتحان', 'سلم الاختبار', 'تسليم الاختبار'],
  },
  fillers: ['من', 'فضلك', 'لو', 'سمحت', 'رجاء', 'رجاءً', 'الآن', 'طيب', 'يلا', 'حسنا'],
  negations: ['لا', 'لن', 'لم', 'مش', 'ما', 'ليس', 'بلاش', 'بدون', 'متسلمش'],
  commandKeywords: [
    'التالي', 'السابق', 'رجوع', 'ارجع', 'أعد', 'كرر', 'إملاء', 'إجابة', 'أجب', 'تأكيد', 'أكد', 'احفظ', 'حفظ',
    'إلغاء', 'توقف', 'تسليم', 'سلم', 'تسلم',
  ],
  exploreStarters: [
    'استكشف', 'صف', 'اوصف', 'أخبرني', 'اعرض', 'اذكر', 'ما', 'ماذا', 'ماهو', 'ماهي', 'أين', 'وين', 'كم', 'هل',
    'عقدة', 'العقدة', 'العقد', 'المكونات', 'مكونات', 'الدائرة', 'دائرة', 'المخطط', 'مخطط', 'بين', 'قيمة', 'المقاومة',
    'مقاومة', 'المقاومات', 'المصدر', 'مصدر',
  ],
  exploreStrip: ['استكشف'],

  numberWords: {
    صفر: '0', واحد: '1', واحدة: '1', اثنين: '2', اثنان: '2', ثلاثة: '3', أربعة: '4', خمسة: '5', ستة: '6',
    سبعة: '7', ثمانية: '8', تسعة: '9', عشرة: '10',
  },
  letterAliases: {
    // Spoken Latin letter names as Arabic speech recognisers often write them.
    ايه: 'a', بي: 'b', سي: 'c', دي: 'd', ار: 'r', في: 'v',
    // Arabic exam labels أ ب ج د used for nodes A B C D.
    أ: 'a', ب: 'b', ج: 'c', د: 'd',
  },
  refusalWords: [
    'حل', 'الحل', 'حلها', 'احسب', 'حساب', 'احسبي', 'التيار', 'تيار', 'الجواب', 'جواب', 'الإجابة', 'إجابة',
    'تلميح', 'تلميحات', 'القدرة', 'قدرة', 'مكافئ', 'المكافئة', 'توالي', 'التوالي', 'توازي', 'التوازي',
    'قانون', 'معادلة', 'معادلات', 'صيغة', 'هبوط', 'لماذا', 'اشرح', 'فرق', 'صحيح', 'صح', 'خطأ', 'النتيجة',
    'نتيجة', 'الخطوات', 'خطوات', 'طريقة', 'كيرشوف', 'الكلية', 'كلية', 'الكلي', 'كلي',
    // possessive / feminine forms
    'إجابتي', 'إجابتك', 'جوابي', 'جوابك', 'حلي', 'حلك', 'صحيحة', 'خاطئة', 'خاطئ',
  ],
  refusalPhrases: ['كيف احل', 'كيف أجد', 'ماذا افعل', 'المقاومة الكلية', 'المقاومة المكافئة'],
  helpWords: ['مساعدة', 'ساعدني', 'أوامر', 'خيارات'],
  nodeWords: ['عقدة', 'العقدة', 'عقد', 'العقد', 'نقطة', 'النقطة'],
  componentWords: ['مكون', 'مكونات', 'المكونات', 'عنصر', 'عناصر', 'العناصر', 'أجزاء', 'جزء'],
  overviewWords: ['مخطط', 'المخطط', 'دائرة', 'الدائرة', 'رسم', 'الرسم', 'شكل', 'وصف', 'صف', 'اوصف', 'استكشف', 'كل', 'ملخص'],
  stopWords: [
    'ما', 'ماذا', 'ماهو', 'ماهي', 'هو', 'هي', 'هل', 'في', 'من', 'عن', 'إلى', 'على', 'كم', 'عدد', 'قيمة', 'القيمة',
    'اعرض', 'اذكر', 'قل', 'لي', 'أخبرني', 'هذا', 'هذه', 'ذلك', 'يوجد', 'توجد', 'موصول', 'موصولة', 'متصل', 'متصلة',
    'بماذا', 'يتصل', 'تتصل', 'ب', 'و', 'أو', 'مع', 'نوع', 'هنا', 'أين', 'وين', 'فضلك', 'لو', 'سمحت', 'رجاء',
    'الآن', 'اقرأ',
  ],
  betweenWords: ['بين'],
  andWords: ['و'],
  ordinals: { الأول: 1, الأولى: 1, الثاني: 2, الثانية: 2, الثالث: 3, الثالثة: 3, الرابع: 4, الخامس: 5, الأخير: -1, الأخيرة: -1 },
  // Arabic pronouns are mostly attached suffixes (قيمته); contextual pronouns are English-only for now.
  pronouns: [],
  otherWords: ['الآخر', 'الأخرى', 'آخر', 'أخرى'],
  placePronouns: ['هناك'],
  existentialWords: ['هل', 'يوجد', 'توجد'],
  terminalWords: ['طرف', 'الطرف', 'أطراف', 'نهاية'],
  attributeWords: ['قيمة', 'القيمة', 'نوع', 'النوع'],
  unsupportedWords: [
    'حل', 'الحل', 'احسب', 'حساب', 'تلميح', 'تلميحات', 'معادلة', 'قانون', 'توالي', 'التوالي', 'توازي', 'التوازي',
    'مكافئ', 'المكافئة', 'اشرح', 'كيرشوف',
  ],
  unsupportedPhrases: ['ما الإجابة', 'ما هو الجواب', 'التيار في', 'التيار المار'],
  unitWords: { أوم: 'ohm', فولت: 'volt', أمبير: 'amp', واط: 'watt', فاراد: 'farad', هنري: 'henry', هرتز: 'hertz' },
  kindNames: KIND_NAMES,

  responses: {
    noDiagram: 'لا يوجد مخطط لهذا السؤال.',
    refusal:
      'يمكنني فقط وصف ما يظهر في المخطط: المكونات وقيمها والعقد التي تتصل بها. لا يمكنني الحل أو الحساب أو إعطاء تلميحات.',
    help: (ex) =>
      `يمكنك أن تسأل عن مكون مثل "${ex.component}"، أو عقدة مثل "العقدة ${ex.node}"، أو "بين العقدة ${ex.node} والعقدة ${ex.otherNode}"، أو "المكونات"، أو "العقد". أصف فقط ما يظهر في المخطط، ولا يمكنني الحل أو الحساب أو إعطاء تلميحات.`,
    unknown: (ex) =>
      `لم أجد ذلك في هذا المخطط. اسأل عن مكون مثل ${ex.component}، أو عقدة مثل العقدة ${ex.node}، أو قل "المكونات".`,
    componentNotFound: (label, cs) => `لا يوجد ${label} في هذا المخطط. المكونات هي ${join(cs.map((c) => c.id))}.`,
    nodeNotFound: (label, nodes) => `لا توجد عقدة ${label} في هذا المخطط. العقد هي ${join(nodes)}.`,
    component: (c) =>
      `${c.id}: ${kindName(c.kind)}، القيمة ${c.value}، موصول بين العقدة ${c.terminals[0]} والعقدة ${c.terminals[1]}.`,
    node: (n, cs) =>
      cs.length ? `العقدة ${n} موصولة بـ ${join(cs.map(short))}.` : `لا توجد مكونات موصولة بالعقدة ${n} في هذا المخطط.`,
    between: (a, b, cs) =>
      cs.length
        ? `بين العقدة ${a} والعقدة ${b}: ${join(cs.map(short))}.`
        : `لا يوجد مكون موصول مباشرة بين العقدة ${a} والعقدة ${b}.`,
    nodeList: (nodes) => `عدد العقد في المخطط: ${nodes.length}، وهي ${join(nodes)}.`,
    componentList: (cs) =>
      `عدد المكونات في المخطط: ${cs.length}، وهي ${join(cs.map((c) => `${c.id} (${kindName(c.kind)})`))}.`,
    kindList: (kind, cs) =>
      `عدد ${kindName(kind, 2)}: ${cs.length}. ${cs.map((c) => ar.responses.component(c)).join(' ')}`,
    whichOne: (ex) => `أي مكون تقصد؟ قل اسمه، مثل ${ex.component}.`,
    matches: (cs) => `يطابق ${cs.length} مكونات: ${join(cs.map(short))}. قل اسم المكون، مثل ${cs[0]?.id ?? 'R1'}، لمعرفة التفاصيل.`,
    noMatch: (cs) => `لا يوجد مكون في هذا المخطط يطابق ذلك. المكونات هي ${join(cs.map((c) => c.id))}.`,
    noneAtNode: (kind, n) => `لا يوجد ${kindName(kind)} موصول بالعقدة ${n}.`,
    noOther: (kind) => `لا يوجد ${kindName(kind)} آخر في هذا المخطط.`,
    whichNode: (ex) => `أي عقدة تقصد؟ قل مثلاً العقدة ${ex.node}.`,
    whichAtNode: (n, cs) => `العقدة ${n} موصولة بـ ${cs.length} مكونات: ${join(cs.map((c) => c.id))}. أيها تقصد؟`,
    othersAtNode: (n, excluded, cs) => {
      const lead = excluded ? `غير ${excluded}، العقدة ${n}` : `العقدة ${n}`;
      return cs.length ? `${lead} موصولة بـ ${join(cs.map(short))}.` : `${lead} ليس لها مكونات أخرى.`;
    },
    overview: (d, nodes, cs) =>
      `${sentence(d.description)} ${ar.responses.nodeList(nodes)} ${ar.responses.componentList(cs)}${
        cs.length && nodes.length ? ` اسأل عن مكون مثل ${cs[0].id} أو عن عقدة مثل العقدة ${nodes[0]}.` : ''
      }`,
  },

  errors: {
    recognitionUnsupported: 'التعرف على الكلام غير متاح في هذا المتصفح. استخدم لوحة المفاتيح.',
    speechUnsupported: 'تحويل النص إلى كلام غير متاح في هذا المتصفح. استخدم قارئ الشاشة أو لوحة المفاتيح.',
    permissionDenied: 'تم رفض إذن الميكروفون. اسمح بالميكروفون في المتصفح أو استخدم لوحة المفاتيح.',
    speechBlocked: 'منع المتصفح تشغيل الكلام. اضغط على مفتاح أو انقر على الصفحة ثم حاول مرة أخرى.',
    noSpeech: 'لم يتم التعرف على أي كلام. حاول مرة أخرى.',
    timeout: 'انتهى وقت الاستماع دون كلام.',
    cancelled: 'تم إلغاء الاستماع.',
    audioCapture: 'لم يتم العثور على ميكروفون أو تعذر تشغيله.',
    network: 'تعذر الوصول إلى خدمة الكلام. تحقق من الاتصال أو استخدم لوحة المفاتيح.',
    busy: 'الاستماع قيد التشغيل بالفعل.',
    languageUnavailable: 'لا يوجد صوت مثبت للغة المختارة في هذا المتصفح.',
    startFailed: 'تعذر تشغيل الميكروفون.',
    speechFailed: 'فشل تحويل النص إلى كلام.',
    unknown: 'حدث خطأ غير متوقع في الكلام.',
  },
};
