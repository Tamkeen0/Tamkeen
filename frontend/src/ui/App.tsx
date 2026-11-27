import { useLayoutEffect, useRef, useState } from 'react';
import AccessibilityStudio from './AccessibilityStudio';
import type { AccessibilityStudioHandle } from './AccessibilityStudio';
import { createMockApi, demoExamId, liveApi } from './api';
import brandMark from './brand-mark.svg';
import Professor from './Professor';
import Student from './Student';
import Welcome from './Welcome';
import './styles.css';

export default function App() {
  const [source, setSource] = useState<'demo' | 'live'>('demo');
  const [mode, setMode] = useState<'welcome' | 'professor' | 'student'>('welcome');
  const [examId, setExamId] = useState(demoExamId);
  const [demoApi, setDemoApi] = useState(createMockApi);
  const [locked, setLocked] = useState(false);
  const [professorBusy, setProfessorBusy] = useState(false);
  const main = useRef<HTMLElement>(null);
  const studio = useRef<AccessibilityStudioHandle>(null);
  const previousMode = useRef(mode);

  useLayoutEffect(() => {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = brandMark;
    document.head.append(favicon);
    return () => favicon.remove();
  }, []);

  useLayoutEffect(() => {
    if (previousMode.current !== mode) {
      const target = main.current?.querySelector<HTMLElement>(':scope > section:not([hidden]) h2') ?? main.current;
      target?.focus();
    }
    previousMode.current = mode;
  }, [mode]);

  function changeSource(next: typeof source) {
    setSource(next);
    setExamId(next === 'demo' ? demoExamId : '');
    if (next === 'demo') setDemoApi(createMockApi());
  }

  const api = source === 'demo' ? demoApi : liveApi;
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="shell header-content">
          <div className="brand">
            <img className="brand-mark" src={brandMark} width="40" height="40" alt="" />
            <h1>Tamkeen</h1>
          </div>
          <nav aria-label="Exam workspaces" className="workspace-nav">
            <button type="button" aria-current={mode === 'welcome' ? 'page' : undefined} onClick={() => setMode('welcome')}>Welcome</button>
            <button type="button" aria-current={mode === 'professor' ? 'page' : undefined} onClick={() => setMode('professor')}>Professor</button>
            <button type="button" aria-current={mode === 'student' ? 'page' : undefined} onClick={() => setMode('student')}>Student</button>
          </nav>
          <div className="header-controls">
            <AccessibilityStudio studioRef={studio} />
            <label className="source">Data source
              <select value={source} disabled={locked || professorBusy} onChange={event => changeSource(event.target.value === 'demo' ? 'demo' : 'live')}>
                <option value="demo">Demo fixture</option>
                <option value="live">Real API</option>
              </select>
            </label>
          </div>
        </div>
      </header>
      <main className={'shell workspace' + (mode === 'welcome' ? ' welcome-workspace' : '')} id="main" tabIndex={-1} ref={main} key={source}>
        {mode === 'welcome' && <section aria-label="Welcome to Tamkeen"><Welcome demo={source === 'demo'} enter={setMode} /></section>}
        <section hidden={mode !== 'professor'} aria-label="Professor workspace">
          <Professor api={api} demo={source === 'demo'} visible={mode === 'professor'} onPublish={setExamId} onBusyChange={setProfessorBusy} />
        </section>
        <section hidden={mode !== 'student'} aria-label="Student workspace">
          <Student api={api} suggestedExamId={examId} visible={mode === 'student'} onSessionActive={setLocked}
            openAccessibility={trigger => studio.current?.open(trigger)} />
        </section>
      </main>
    </>
  );
}
