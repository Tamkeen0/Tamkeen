import { useLayoutEffect, useRef, useState } from 'react';
import { UiError } from './errors';
import type { FormEvent } from 'react';
import type { Exam, Session } from '../../../contracts/types';
import type { ExamApi } from './api';
import { demoExamId } from './api';
import CameraScan from './CameraScan';
import { AnswerList, Feedback, WorkspaceIntro, useObjectUrl } from './components';
import DraftEditor, { checkDraft, DraftQuestionError } from './DraftEditor';
import { Icon } from './icons';
import { createScanPdf } from './scanPdf';
import type { ScanImage } from './scanPdf';
import { useRequest } from './useRequest';

type ProfessorProps = {
  api: ExamApi;
  demo: boolean;
  visible: boolean;
  onPublish: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
};

export default function Professor({ api, demo, visible, onPublish, onBusyChange }: ProfessorProps) {
  const { busy, pending, error, run } = useRequest(onBusyChange);
  const [file, setFile] = useState<File>();
  const [draftSource, setDraftSource] = useState<{ examId: string; pdf: Blob }>();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookupId, setLookupId] = useState(demo ? demoExamId : '');
  const [exam, setExam] = useState<Exam>();
  const [approved, setApproved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [reviewQuestion, setReviewQuestion] = useState(0);
  const [status, setStatus] = useState<string>();
  const [feedbackArea, setFeedbackArea] = useState<'entry' | 'exam' | 'scan'>('entry');
  const [results, setResults] = useState<Session[]>();
  const examHeading = useRef<HTMLHeadingElement>(null);
  const scannerTrigger = useRef<HTMLButtonElement>(null);
  const sourceUrl = useObjectUrl(draftSource?.pdf);

  useLayoutEffect(() => {
    if (editorVersion) examHeading.current?.focus();
  }, [editorVersion]);

  function open(next: Exam, pdf?: Blob | null) {
    setExam(next);
    setDraftSource(current => {
      if (next.status === 'published' || pdf === null) return undefined;
      return pdf ? { examId: next.id, pdf } : current?.examId === next.id ? current : undefined;
    });
    setLookupId(next.id);
    setApproved(false);
    setDirty(false);
    setEditorVersion(version => version + 1);
    setReviewQuestion(0);
    setResults(undefined);
    if (next.status === 'published') onPublish(next.id);
  }

  function request(area: typeof feedbackArea, pending: string, work: () => Promise<void>) {
    return run(pending, async () => {
      setFeedbackArea(area);
      setStatus(undefined);
      await work();
    });
  }

  async function uploadPdf(pdf: File | undefined) {
    if (!pdf?.size || !/\.pdf$/i.test(pdf.name)) throw new UiError('Choose a nonempty PDF file.');
    const draft = await api.upload(pdf);
    const prefix = await pdf.slice(0, 5).text().catch(() => '');
    open(draft, prefix === '%PDF-' ? pdf.slice(0, pdf.size, 'application/pdf') : null);
    setFeedbackArea('entry');
    setStatus(`Draft ${draft.id} loaded for review.`);
  }

  function uploadScan(images: readonly ScanImage[]) {
    void request('scan', 'Preparing and uploading scanned PDF…', async () => {
      let pdf: File;
      try {
        pdf = createScanPdf(images);
      } catch (failure) {
        if (failure instanceof UiError) throw failure;
        throw new UiError('The scanned PDF could not be created. Your captured pages are still available.');
      }
      await uploadPdf(pdf);
      setScannerOpen(false);
    });
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!exam) return;
    const publish = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'publish';
    void request('exam', publish ? 'Publishing exam…' : 'Saving draft…', async () => {
      if (publish && !approved) throw new UiError('Confirm your review before publishing.');
      try {
        checkDraft(exam, publish);
      } catch (failure) {
        if (failure instanceof DraftQuestionError) setReviewQuestion(failure.index);
        throw failure;
      }
      const saved = await api.saveDraft(publish ? { ...exam, needs_review: false } : exam);
      setExam(saved);
      setDirty(false);
      if (!publish) {
        setStatus(`Draft ${saved.id} saved.`);
        return;
      }

      let published: Exam;
      try {
        published = await api.publish(saved.id);
      } catch (failure) {
        const current = await api.getExam(saved.id).catch(() => undefined);
        if (current?.status !== 'published') throw failure;
        published = current;
      }
      if (published.status !== 'published') throw new UiError('The server has not published the exam.');
      open(published);
      setStatus(`Exam ${published.id} published. It is ready in the Student workspace.`);
    });
  }

  return (
    <>
      <WorkspaceIntro title="Professor workspace"
        description="Prepare an accessible exam, verify what students will receive, and review their submissions." />
      {exam && <p className="professor-shortcut"><a href={exam.status === 'draft' ? '#draft-heading' : '#results-heading'}>
        {exam.status === 'draft' ? 'Jump to draft review' : 'Jump to submissions'}
      </a></p>}
      <Feedback status={feedbackArea === 'entry' ? pending || status : undefined} error={feedbackArea === 'entry' ? error : undefined} pending={feedbackArea === 'entry' && busy} />

      <div className="panels professor-entry">
        <section className="panel upload-panel" aria-labelledby="upload-heading">
          <h3 id="upload-heading">Upload an exam</h3>
          <p>{demo ? 'Demo uploads open the sample draft for review. Demo work resets on reload or when you change data sources.' : 'Use an existing PDF or scan paper pages to send for review.'}</p>
          <div className="exam-input-options">
            <form noValidate onSubmit={event => {
              event.preventDefault();
              void request('entry', 'Uploading PDF…', () => uploadPdf(file));
            }}>
              <h4><Icon name="document" /> PDF file</h4>
              <div className="file-field">
                <label htmlFor="exam-pdf">Exam PDF</label>
                <div className="file-control">
                  <input id="exam-pdf" required type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => setFile(event.target.files?.[0])} />
                  <span aria-hidden="true" className="file-display">
                    <span className="file-action">Choose PDF</span>
                    {file ? <bdi dir="auto" className="file-name">{file.name}</bdi> : <span>No file selected</span>}
                  </span>
                </div>
              </div>
              <button className="primary" disabled={busy}>Upload PDF <Icon name="arrow" /></button>
            </form>
            <div className="camera-option">
              <h4><Icon name="camera" /> Paper pages</h4>
              <p>Capture paper pages with your device camera and combine them into one PDF.</p>
              <button type="button" ref={scannerTrigger} disabled={busy} aria-expanded={scannerOpen}
                aria-controls={scannerOpen ? 'camera-scan' : undefined} onClick={() => {
                  if (scannerOpen) {
                    document.getElementById('scan-heading')?.focus();
                  } else {
                    setFeedbackArea('entry');
                    setScannerOpen(true);
                  }
                }}>Scan with Camera</button>
            </div>
          </div>
        </section>
        <form className="panel lookup-panel" noValidate onSubmit={event => {
          event.preventDefault();
          void request('entry', 'Opening exam…', async () => {
            const id = lookupId.trim();
            if (!id) throw new UiError('Enter a professor exam ID.');
            const loaded = await api.getExam(id);
            open(loaded);
            setStatus(`Exam ${loaded.id} loaded.`);
          });
        }}>
          <h3>Open an existing exam</h3>
          <p>Return to a draft or find submissions for a published exam.</p>
          <label>Professor exam ID<input required dir="auto" value={lookupId} disabled={busy} onChange={event => setLookupId(event.target.value)} /></label>
          <button disabled={busy}>Open exam <Icon name="arrow" /></button>
        </form>
      </div>

      {scannerOpen && <CameraScan visible={visible && !busy} busy={busy} demo={demo}
        uploadStatus={feedbackArea === 'scan' ? pending : undefined}
        uploadError={feedbackArea === 'scan' ? error : undefined}
        onContinue={uploadScan} onClose={() => {
          setScannerOpen(false);
          scannerTrigger.current?.focus();
        }} />}

      {exam?.status === 'draft' && (
        <section className="panel exam-panel" aria-labelledby="draft-heading">
          <div className="section-heading">
            <div className="section-title"><span className="icon-tile"><Icon name="document" /></span><h3 id="draft-heading" tabIndex={-1} ref={examHeading}>Review draft</h3></div>
            <div className="status-line"><span className="tag">Draft</span><p className="identifier">Exam ID <strong><bdi>{exam.id}</bdi></strong></p></div>
          </div>
          {sourceUrl && <a className="source-preview-link" href={sourceUrl} target="_blank" rel="noreferrer">
            <Icon name="document" /> View source PDF (opens in a new tab)
          </a>}
          <DraftEditor key={editorVersion} exam={exam} activeQuestion={reviewQuestion} selectQuestion={setReviewQuestion}
            busy={busy} dirty={dirty} approved={approved} demo={demo}
            status={feedbackArea === 'exam' ? pending || status : undefined}
            error={feedbackArea === 'exam' ? error : undefined}
            approve={setApproved} submit={review} change={next => {
              setExam(next);
              setDirty(true);
              setApproved(false);
            }} />
        </section>
      )}

      {exam?.status === 'published' && (
        <section className="panel exam-panel" aria-labelledby="results-heading">
          <div className="section-heading">
            <div className="section-title"><span className="icon-tile teal"><Icon name="inbox" /></span><h3 id="results-heading" tabIndex={-1} ref={examHeading}>Submissions for <bdi>{exam.title}</bdi></h3></div>
            <div className="status-line"><span className="tag tag-live"><Icon name="check" /> Published</span><p className="identifier">Published exam ID <strong><bdi>{exam.id}</bdi></strong></p></div>
          </div>
          <Feedback status={feedbackArea === 'exam' ? pending || status : undefined} error={feedbackArea === 'exam' ? error : undefined} pending={feedbackArea === 'exam' && busy} />
          <button type="button" disabled={busy} onClick={() => void request('exam', 'Loading submissions…', async () => {
            const submissions = await api.getSubmissions(exam.id);
            setResults(submissions);
            setStatus(`${submissions.length} ${submissions.length === 1 ? 'submission' : 'submissions'} loaded.`);
          })}>{results ? 'Refresh submissions' : 'Load submissions'}</button>
          {results?.length === 0 && <div className="empty-state"><span className="icon-tile"><Icon name="inbox" /></span><p>No submissions yet. Submitted exams will appear here.</p></div>}
          {results?.map(session => (
            <article key={session.id} className="submission">
              <h4>Session <bdi>{session.id}</bdi></h4>
              <AnswerList session={session} showQuestionText />
            </article>
          ))}
        </section>
      )}
    </>
  );
}
