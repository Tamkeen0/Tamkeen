import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { applyPreferences, contrastRatio, defaultPreferences, isHex, ranges, readPreferences, STORAGE_KEY, themes } from './accessibilityPreferences';
import type { Preferences, ReadingColors } from './accessibilityPreferences';
import { Icon } from './icons';
import './accessibilityStudio.css';

type RangeKey = keyof typeof ranges;
export type AccessibilityStudioHandle = { open: (origin: HTMLButtonElement) => void };

const numberLabels: Record<RangeKey, string> = {
  textSize: 'Text size',
  lineHeight: 'Line spacing',
  letterSpacing: 'Letter spacing',
  wordSpacing: 'Word spacing',
};

function RangeSetting({ setting, value, change }: { setting: RangeKey; value: number; change: (value: number) => void }) {
  const id = useId();
  const { min, max, step } = ranges[setting];
  const size = setting === 'textSize';
  const display = size ? value + '%' : setting === 'lineHeight' ? value.toFixed(2) + '×' : value.toFixed(2) + ' em';
  const spoken = size ? value + ' percent' : setting === 'lineHeight' ? value.toFixed(2) + ' times' : display;

  return (
    <div className="studio-range">
      <div className="studio-range-label"><label htmlFor={id}>{numberLabels[setting]}</label><span aria-hidden="true">{display}</span></div>
      <div className="studio-range-controls">
        {size && <button type="button" aria-label="Decrease text size" aria-disabled={value <= min} onClick={() => {
          if (value > min) change(value - step);
        }}>−</button>}
        <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={spoken}
          onChange={event => change(event.currentTarget.valueAsNumber)} />
        {size && <button type="button" aria-label="Increase text size" aria-disabled={value >= max} onClick={() => {
          if (value < max) change(value + step);
        }}>+</button>}
      </div>
    </div>
  );
}

function Toggle({ checked, change, label, hint }: { checked: boolean; change: (enabled: boolean) => void; label: string; hint: string }) {
  const id = useId();
  return (
    <label className="studio-toggle">
      <input type="checkbox" checked={checked} onChange={event => change(event.currentTarget.checked)} aria-labelledby={id} aria-describedby={id + '-hint'} />
      <span><span className="studio-toggle-label" id={id}>{label}</span><small id={id + '-hint'}>{hint}</small></span>
    </label>
  );
}

function ReadingColor({ label, value, fallback, change }: { label: string; value: string; fallback: string; change: (value: string) => void }) {
  const id = useId();
  return (
    <div className="studio-color">
      <label htmlFor={id}>{label}</label>
      <div className="studio-color-row">
        <input type="color" aria-label={label + ' color picker'} value={isHex(value) ? value : fallback} onChange={event => change(event.target.value.toUpperCase())} />
        <input type="text" id={id} value={value} autoComplete="off" spellCheck={false} maxLength={7}
          aria-invalid={!isHex(value)} onChange={event => change(event.target.value)} />
      </div>
    </div>
  );
}

function LivePreview() {
  const [second, setSecond] = useState(false);
  return (
    <section className="studio-preview" aria-labelledby="studio-preview-heading">
      <h3 id="studio-preview-heading" tabIndex={-1}>Live preview</h3>
      <p className="studio-help">Sample content for trying your settings.</p>
      <div className="studio-preview-card">
        <span className="tag">Sample question {second ? 2 : 1}</span>
        <p className="studio-preview-question reading-surface">{second ? 'How would you describe the connection between nodes A and B?' : 'Explain how the current changes when the resistance increases.'}</p>
        <label>Sample answer<textarea className="reading-surface" rows={2} placeholder="Type here to try your settings." /></label>
        <button id="studio-sample-navigation" type="button" onClick={() => setSecond(current => !current)}>{second ? 'Previous sample question' : 'Next sample question'} <Icon name={second ? 'back' : 'arrow'} /></button>
        <a href="#studio-sample-navigation" onClick={event => {
          event.preventDefault();
          document.getElementById('studio-sample-navigation')?.focus();
        }}>Try the keyboard focus outline</a>
      </div>
    </section>
  );
}

export default function AccessibilityStudio({ studioRef }: { studioRef: Ref<AccessibilityStudioHandle> }) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [colorDraft, setColorDraft] = useState(preferences.colors);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const ratio = isHex(colorDraft.foreground) && isHex(colorDraft.background) ? contrastRatio(colorDraft) : undefined;
  const validColors = ratio !== undefined && ratio >= 4.5;
  const activeRatio = contrastRatio(preferences.colors);

  const show = useCallback((origin: HTMLButtonElement) => {
    if (!dialog.current || dialog.current.open) return;
    returnFocus.current = origin;
    setAnnouncement('');
    dialog.current.showModal();
    title.current?.focus();
  }, []);
  useImperativeHandle(studioRef, () => ({ open: show }), [show]);

  useLayoutEffect(() => {
    applyPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      setStorageAvailable(false);
    }
  }, [preferences]);

  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences(current => ({ ...current, [key]: value }));
  }

  function changeColor(key: keyof ReadingColors, value: string) {
    const colors = { ...colorDraft, [key]: value };
    setColorDraft(colors);
    if (isHex(colors.foreground) && isHex(colors.background) && contrastRatio(colors) >= 4.5) set('colors', colors);
  }

  function reset() {
    setPreferences(defaultPreferences);
    setColorDraft(defaultPreferences.colors);
    setAnnouncement('Accessibility preferences reset to defaults.');
  }

  return (
    <div className="studio-entry">
      <button type="button" ref={trigger} className="studio-trigger" aria-haspopup="dialog" aria-controls="accessibility-studio"
        onClick={event => show(event.currentTarget)}><Icon name="accessibility" /> Accessibility</button>
      <dialog ref={dialog} id="accessibility-studio" className="studio-dialog" aria-labelledby="studio-title" aria-describedby="studio-subtitle"
        onClose={() => (returnFocus.current?.isConnected ? returnFocus.current : trigger.current)?.focus()}>
        <div className="studio-shell">
          <div className="studio-header">
            <div className="section-title"><span className="icon-tile"><Icon name="accessibility" /></span>
              <div><h2 ref={title} id="studio-title" tabIndex={-1}>Accessibility Studio</h2><p id="studio-subtitle">Your exam, your way.</p></div>
            </div>
            <button type="button" aria-label="Close Accessibility Studio" onClick={() => dialog.current?.close()}>Close</button>
          </div>

          <div className="studio-intro">
            <p>Changes apply immediately. {storageAvailable ? 'Your preferences are saved in this browser.' : 'Browser storage is unavailable. Changes apply for this visit.'}</p>
            <a href="#studio-preview-heading">Jump to live preview</a>
          </div>

          <div className="studio-layout">
            <div className="studio-settings">
              <fieldset className="studio-section">
                <legend>Reading and typography</legend>
                {(Object.keys(ranges) as RangeKey[]).map(key => <RangeSetting key={key} setting={key} value={preferences[key]} change={value => set(key, value)} />)}
              </fieldset>

              <fieldset className="studio-section">
                <legend>Color and contrast</legend>
                <div className="studio-themes">
                  {themes.map(theme => <label key={theme.id} className="studio-theme-tile">
                    <input type="radio" name="studio-theme" value={theme.id} checked={theme.id === preferences.theme} onChange={() => set('theme', theme.id)} />
                    <span className="studio-theme-sample" data-preset={theme.id} aria-hidden="true"><span>Aa</span><i /></span>
                    <span className="studio-theme-name">{theme.name}</span>
                  </label>)}
                </div>
                <Toggle checked={preferences.customColors} change={value => set('customColors', value)} label="Custom reading colors"
                  hint="Personalize exam text and answer surfaces. Controls keep their preset colors." />
                {preferences.customColors && (
                  <div className="studio-custom">
                    <div className="studio-color-grid">
                      <ReadingColor label="Reading text" value={colorDraft.foreground} fallback={preferences.colors.foreground} change={value => changeColor('foreground', value)} />
                      <ReadingColor label="Reading background" value={colorDraft.background} fallback={preferences.colors.background} change={value => changeColor('background', value)} />
                    </div>
                    <p className="studio-contrast" role="status" aria-atomic="true" data-valid={validColors}>
                      {validColors ? 'Applied. Text contrast is ' + ratio.toFixed(2) + ':1.'
                        : (ratio === undefined ? 'Enter a six-digit hex color, such as #192344.' : 'Contrast is ' + ratio.toFixed(2) + ':1. Choose at least 4.5:1.')
                        + ' Keeping your last accessible colors (' + activeRatio.toFixed(2) + ':1).'}
                    </p>
                  </div>
                )}
              </fieldset>

              <fieldset className="studio-section">
                <legend>Focus and visibility</legend>
                <Toggle checked={preferences.enhancedFocus} change={value => set('enhancedFocus', value)} label="Enhanced keyboard focus" hint="Use a thicker, higher contrast outline." />
                <Toggle checked={preferences.reduceMotion} change={value => set('reduceMotion', value)} label="Reduce motion" hint="Turn off decorative transitions and animations." />
                <Toggle checked={preferences.underlinedLinks} change={value => set('underlinedLinks', value)} label="Underlined links" hint="Use a stronger underline on links." />
                <Toggle checked={preferences.enhancedBorders} change={value => set('enhancedBorders', value)} label="Enhanced control boundaries" hint="Thicken the borders around fields and buttons." />
                <Toggle checked={preferences.questionSeparation} change={value => set('questionSeparation', value)} label="Separate questions and answers" hint="Add clear boundaries around exam prompts and answer areas." />
              </fieldset>
              <div className="studio-reset"><button type="button" onClick={reset}>Reset to defaults</button><p role="status">{announcement}</p></div>
            </div>
            <LivePreview />
          </div>
        </div>
      </dialog>
    </div>
  );
}
