// Text normalisation shared by the command parser and the diagram lookup.
// Pure functions; no browser APIs.

const ARABIC_CHAR = /[؀-ۿ]/;

/**
 * Lower-case, strip punctuation and collapse whitespace. Also folds Arabic
 * spelling variants (hamza forms, taa marbuta, alef maqsura, diacritics,
 * tatweel) and Arabic-Indic digits so that recognised speech compares
 * reliably. Apostrophes are dropped so "don't" becomes "dont".
 */
export function normalizeText(input: string): string {
  let s = String(input ?? '').normalize('NFKC').toLowerCase();
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(/[ً-ٰٟـ]/g, '');
  s = s
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
  s = s.replace(/['’‘`]/g, '');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  // Separate Arabic script from adjacent Latin letters/digits ("وR2" -> "و r2").
  s = s
    .replace(/([؀-ۿ])([a-z0-9])/g, '$1 $2')
    .replace(/([a-z0-9])([؀-ۿ])/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(' ') : [];
}

export function hasArabic(text: string): boolean {
  return ARABIC_CHAR.test(String(text ?? ''));
}

const ARABIC_PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال'];

/** Strip a leading Arabic definite-article prefix; Latin tokens are unchanged. */
export function stemToken(token: string): string {
  if (!ARABIC_CHAR.test(token)) return token;
  for (const p of ARABIC_PREFIXES) {
    if (token.startsWith(p) && token.length - p.length >= 2) return token.slice(p.length);
  }
  return token;
}

export function normalizeAndStem(text: string): string[] {
  return tokenize(normalizeText(text)).map(stemToken);
}
