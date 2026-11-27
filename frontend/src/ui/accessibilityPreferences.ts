export const STORAGE_KEY = 'tamkeen.accessibility.v1';

export const themes = [
  { id: 'default', name: 'Default' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'contrast-dark', name: 'High Contrast Dark' },
  { id: 'contrast-light', name: 'High Contrast Light' },
  { id: 'warm-paper', name: 'Warm Paper' },
  { id: 'soft-blue', name: 'Soft Blue' },
] as const;

export type Theme = typeof themes[number]['id'];

export const ranges = {
  textSize: { min: 100, max: 200, step: 5 },
  lineHeight: { min: 1.4, max: 2.4, step: .05 },
  letterSpacing: { min: 0, max: .12, step: .01 },
  wordSpacing: { min: 0, max: .16, step: .01 },
};

export type ReadingColors = { foreground: string; background: string };

export const defaultPreferences = {
  theme: 'default' as Theme,
  textSize: 100,
  lineHeight: 1.55,
  letterSpacing: 0,
  wordSpacing: 0,
  customColors: false,
  colors: { foreground: '#192344', background: '#FFFFFF' } as ReadingColors,
  enhancedFocus: false,
  reduceMotion: false,
  underlinedLinks: false,
  enhancedBorders: false,
  questionSeparation: false,
};

export type Preferences = typeof defaultPreferences;
export const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

function luminance(hex: string) {
  const coefficients = [.2126, .7152, .0722];
  return coefficients.reduce((total, weight, index) => {
    const channel = Number.parseInt(hex.slice(index * 2 + 1, index * 2 + 3), 16) / 255;
    const linear = channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    return total + weight * linear;
  }, 0);
}

export function contrastRatio(colors: ReadingColors) {
  const first = luminance(colors.foreground);
  const second = luminance(colors.background);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

export function readPreferences(): Preferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaultPreferences;

    function number(key: keyof typeof ranges) {
      const { min, max, step } = ranges[key];
      const value = stored[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return defaultPreferences[key];
      return Number((min + Math.round((value - min) / step) * step).toFixed(2));
    }

    const foreground = stored.colors?.foreground;
    const background = stored.colors?.background;
    const colors = isHex(foreground) && isHex(background) && contrastRatio({ foreground, background }) >= 4.5
      ? { foreground: foreground.toUpperCase(), background: background.toUpperCase() }
      : defaultPreferences.colors;

    return {
      theme: themes.find(theme => theme.id === stored.theme)?.id ?? defaultPreferences.theme,
      textSize: number('textSize'),
      lineHeight: number('lineHeight'),
      letterSpacing: number('letterSpacing'),
      wordSpacing: number('wordSpacing'),
      customColors: stored.customColors === true && colors !== defaultPreferences.colors,
      colors,
      enhancedFocus: stored.enhancedFocus === true,
      reduceMotion: stored.reduceMotion === true,
      underlinedLinks: stored.underlinedLinks === true,
      enhancedBorders: stored.enhancedBorders === true,
      questionSeparation: stored.questionSeparation === true,
    };
  } catch {
    return defaultPreferences;
  }
}

export function applyPreferences(preferences: Preferences, root: HTMLElement = document.documentElement) {
  root.dataset.studioTheme = preferences.theme;
  root.toggleAttribute('data-studio-large-text', preferences.textSize >= 150);
  root.toggleAttribute('data-studio-focus', preferences.enhancedFocus);
  root.toggleAttribute('data-studio-reduce-motion', preferences.reduceMotion);
  root.toggleAttribute('data-studio-links', preferences.underlinedLinks);
  root.toggleAttribute('data-studio-borders', preferences.enhancedBorders);
  root.toggleAttribute('data-studio-separation', preferences.questionSeparation);
  root.toggleAttribute('data-studio-reading', preferences.customColors);
  root.style.setProperty('--studio-text-scale', String(preferences.textSize / 100));
  if (preferences.lineHeight !== defaultPreferences.lineHeight) root.style.setProperty('--studio-line-height', String(preferences.lineHeight));
  else root.style.removeProperty('--studio-line-height');
  if (preferences.letterSpacing) root.style.setProperty('--studio-letter', preferences.letterSpacing + 'em');
  else root.style.removeProperty('--studio-letter');
  if (preferences.wordSpacing) root.style.setProperty('--studio-word', preferences.wordSpacing + 'em');
  else root.style.removeProperty('--studio-word');
  if (preferences.customColors) {
    root.style.setProperty('--studio-reading-fg', preferences.colors.foreground);
    root.style.setProperty('--studio-reading-bg', preferences.colors.background);
  } else {
    root.style.removeProperty('--studio-reading-fg');
    root.style.removeProperty('--studio-reading-bg');
  }
}
