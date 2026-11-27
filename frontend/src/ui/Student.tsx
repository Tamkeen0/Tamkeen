import { useLayoutEffect, useRef, useState } from 'react';
import { UiError } from './errors';
import type { Question, Session } from '../../../contracts/types';
import type { ExamApi } from './api';
import { AnswerList, Feedback, WorkspaceIntro, confirmedAnswer } from './components';
import { QuestionPanel, ReviewPanel, SessionPanel } from './StudentPanels';
import type { Confirmation } from './StudentPanels';
import { Icon } from './icons';
import MicrophoneCheck from './MicrophoneCheck';
import { useRequest } from './useRequest';
import { useVoice } from './voice';
import type { VoiceApi } from './voice';

function questionText(question: Question) {
  return [question.accessible_text, ...question.options].join('\n');
}

function checkSession(session: Session, expectedStatus: Session['status'], id?: string): Session {
  if (session?.status !== expectedStatus || session.exam?.status !== 'published' ||
      !Array.isArray(session.exam.questions) || !session.exam.questions.length ||
      !session.answers || (id !== undefined && session.id !== id)) {
    throw new UiError('The exam server returned an invalid session. Try again.');
  }
  return session;
}

type StudentProps = {
  api: ExamApi;
  suggestedExamId: string;
  visible: boolean;
  onSessionActive: (active: boolean) => void;
  openAccessibility: (trigger: HTMLButtonElement) => void;
};

export default function Student({ api, suggestedExamId, visible, onSessionActive, openAccessibility }: StudentProps) {
  const [enteredId, setEnteredId] = useState<string>();
  const [checkingMicrophone, setCheckingMicrophone] = useState(false);
  const [session, setSession] = useState<Session>();
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState(() => new Map<string, string>());
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [status, setStatus] = useState<string>();
  const { busy, pending, error, run } = useRequest();
  const voice = useVoice(visible);
  const heading = useRef<HTMLHeadingElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const focusEditor = useRef(false);

  useLayoutEffect(() => {
    if (!visible) setCheckingMicrophone(false);
  }, [visible]);

  const sessionId = session?.id;
  const sessionStatus = session?.status;
  useLayoutEffect(() => {
    if (!sessionId) return;
    const target = focusEditor.current && !confirmation ? editor.current : heading.current;
    focusEditor.current = false;
    target?.focus();
  }, [sessionId, sessionStatus, index, confirmation]);

  const examId = enteredId ?? suggestedExamId;
  const questions = session?.exam.questions ?? [];
  const question = questions[index];
  const saved = question ? confirmedAnswer(session, question.id) : undefined;
  const answer = question ? drafts.get(question.id) ?? saved ?? '' : '';
  const questionStates = questions.map(item => {
    const confirmed = confirmedAnswer(session, item.id);
    return { confirmed: confirmed !== undefined, edited: drafts.has(item.id) && drafts.get(item.id) !== (confirmed ?? '') };
  });
  const answerStatus = questionStates[index]?.edited ? 'Unconfirmed edit' : saved === undefined ? 'Awaiting a confirmed answer' : 'Answer confirmed';
  const answered = questionStates.filter(item => item.confirmed).length;
  const unanswered = questions.length - answered;
  const unconfirmed = questionStates.filter(item => item.edited).length;
  const unansweredSummary = `${unanswered} of ${questions.length} questions ${unanswered === 1 ? 'is' : 'are'} unanswered.`;
  const editWarning = unconfirmed ? ` Submitting will discard ${unconfirmed} unconfirmed ${unconfirmed === 1 ? 'edit' : 'edits'}.` : '';
  const submitMessage = `${unansweredSummary}${editWarning} Submission locks your confirmed answers.`;
  const locked = busy || Boolean(voice.activity);

  function updateAnswer(id: string, text: string) {
    setDrafts(current => new Map(current).set(id, text));
  }

  function startExam() {
    void run('Starting exam…', async () => {
      if (!examId.trim()) throw new UiError('Enter a student exam ID.');
      onSessionActive(true);
      try {
        setSession(checkSession(await api.startSession(examId.trim()), 'active'));
        setStatus('Exam started.');
      } catch (failure) {
        onSessionActive(false);
        throw failure;
      }
    });
  }

  function move(offset: number) {
    const next = index + offset;
    if (next < 0 || next >= questions.length) {
      setStatus(offset < 0 ? 'You are on the first question.' : 'You are on the last question.');
      return;
    }
    setStatus(undefined);
    voice.setResult(undefined);
    setIndex(next);
  }

  function saveAnswer() {
    if (!session || !question || confirmation !== 'answer' || !answer.trim()) return;
    return run('Saving your answer…', async () => {
      setStatus(undefined);
      setSession(checkSession(await api.saveAnswer(session.id, question.id, answer), 'active', session.id));
      setDrafts(current => {
        const next = new Map(current);
        next.delete(question.id);
        return next;
      });
      setConfirmation(null);
      setStatus(`Answer confirmed for question ${index + 1}.`);
    });
  }

  function submitExam() {
    if (!session || confirmation !== 'submit') return;
    return run('Submitting exam…', async () => {
      setStatus(undefined);
      let submitted: Session;
      try {
        submitted = checkSession(await api.submit(session.id), 'submitted', session.id);
      } catch (failure) {
        // A response can be lost after the server has locked the submission.
        const current = await api.getSession(session.id).catch(() => undefined);
        if (current?.status !== 'submitted') throw failure;
        submitted = checkSession(current, 'submitted', session.id);
      }
      setSession(submitted);
      setDrafts(new Map());
      setConfirmation(null);
      setStatus('Exam submitted. Your answers are locked.');
      onSessionActive(false);
    });
  }

  function cancelReview() {
    focusEditor.current = confirmation === 'answer';
    setConfirmation(null);
    setStatus(confirmation ? 'Returned to the question.' : 'You are on the question.');
  }

  async function dictate(api: VoiceApi, isCurrent: () => boolean) {
    if (!question) return;
    voice.setActivity({ phase: 'listening', label: 'Listening for your answer…' });
    const transcript = await api.listenOnce();
    if (!isCurrent()) return;
    if (!transcript.trim()) throw new UiError('No answer was heard.');
    updateAnswer(question.id, transcript);
    setConfirmation('answer');
    await voice.speak(api, `Review your answer. ${transcript}. Confirm to save, or choose Edit answer.`);
  }

  async function command(api: VoiceApi, isCurrent: () => boolean) {
    voice.setActivity({ phase: 'listening', label: 'Listening for a command…' });
    const transcript = await api.listenOnce();
    if (!isCurrent() || !question) return;
    voice.setActivity({ phase: 'processing', label: 'Processing the command…' });
    const parsed = api.parseCommand(transcript);
    switch (parsed.type) {
      case 'confirm':
        if (confirmation === 'submit') await submitExam();
        else if (confirmation === 'answer') await saveAnswer();
        else await voice.speak(api, 'Open a review step before confirming.');
        return;
      case 'cancel':
        cancelReview();
        return;
      case 'repeat':
        await voice.speak(api, confirmation === 'submit' ? submitMessage : confirmation === 'answer' ? answer : questionText(question));
        return;
      case 'next':
      case 'previous': {
        if (confirmation) break;
        const offset = parsed.type === 'next' ? 1 : -1;
        const next = questions[index + offset];
        move(offset);
        await voice.speak(api, next ? `Question ${index + offset + 1}. ${questionText(next)}` : offset < 0 ? 'You are on the first question.' : 'You are on the last question.');
        return;
      }
      case 'dictate':
        if (confirmation) break;
        await dictate(api, isCurrent);
        return;
      case 'submit':
        if (confirmation) break;
        setConfirmation('submit');
        await voice.speak(api, `${submitMessage} Confirm to submit, or cancel to return to the exam.`);
        return;
      case 'explore': {
        if (confirmation) break;
        const response = question.diagram ? api.describeDiagram(question.diagram, parsed.query) : 'This question has no circuit to explore.';
        voice.setResult(response);
        await voice.speak(api, response);
        return;
      }
      case 'unknown':
        break;
    }
    await voice.speak(api, confirmation ? 'While reviewing, say confirm, cancel, or repeat.' : 'I can navigate questions, take dictation, or read approved circuit facts. I cannot provide answers or solve exam questions.');
  }

  function readAloud(text: string) {
    void voice.run('Preparing to read aloud…', api => voice.speak(api, text));
  }

  return (
    <>
      <WorkspaceIntro label={session ? (session.status === 'submitted' ? 'Completed assessment' : 'Assessment session') : 'Take an assessment'}
        icon="person" title={session ? <bdi>{session.exam.title}</bdi> : 'Student workspace'}
        description={session ? <>Student session <bdi>{session.id}</bdi></> : 'Open a published exam and work through it with your keyboard or available voice controls.'} />
      {session?.status === 'active' && <div className="exam-tools">
        <button type="button" className="quiet" aria-haspopup="dialog" aria-controls="accessibility-studio"
          onClick={event => openAccessibility(event.currentTarget)}><Icon name="accessibility" /> Exam accessibility</button>
      </div>}
      <Feedback status={pending || status} error={error} pending={busy} />
      <Feedback status={voice.activity?.label ?? voice.result} error={voice.error} />
      {visible && checkingMicrophone && !session && <MicrophoneCheck onCancel={() => setCheckingMicrophone(false)} onContinue={() => {
        setCheckingMicrophone(false);
        startExam();
      }} />}
      {!session ? (
        <div className="panels student-entry">
          <form className="panel start-panel" noValidate onSubmit={event => {
            event.preventDefault();
            if (examId.trim()) setCheckingMicrophone(true);
            else startExam();
          }}>
            <div className="section-title"><span className="icon-tile"><Icon name="document" /></span><h3>Start an exam</h3></div>
            <p>Use the exam ID provided by your professor.</p>
            <label>Student exam ID<input required dir="auto" value={examId} disabled={busy} onChange={event => setEnteredId(event.target.value)} /></label>
            <button className="primary" disabled={busy}>Start exam <Icon name="arrow" /></button>
          </form>
          <section className="panel student-guide" aria-labelledby="exam-guide">
            <div className="section-title"><span className="icon-tile teal"><Icon name="check" /></span><h3 id="exam-guide">During the exam</h3></div>
            <ol className="exam-guide-list">
              <li><strong>Navigate with your keyboard</strong><p>Use Tab to move between controls and Enter to activate a button.</p></li>
              <li><strong>Confirm each answer</strong><p>Review and confirm each answer to save it.</p></li>
              <li><strong>Review before submitting</strong><p>Your confirmed answers lock when you submit.</p></li>
            </ol>
          </section>
        </div>
      ) : session.status === 'submitted' ? (
        <section className="panel submitted-panel" aria-labelledby="submitted-heading">
          <div className="section-title"><span className="icon-tile teal"><Icon name="check" /></span><h3 id="submitted-heading" ref={heading} tabIndex={-1}>Exam submitted</h3></div>
          <p>Your confirmed answers are locked.</p>
          <AnswerList session={session} />
        </section>
      ) : (
        <div className="student-layout">
          {confirmation ? (
            <ReviewPanel confirmation={confirmation} answer={answer} submitMessage={submitMessage} heading={heading}
              locked={locked} confirm={confirmation === 'answer' ? saveAnswer : submitExam} returnToQuestion={cancelReview}
              readBack={voice.available ? () => readAloud(confirmation === 'answer' ? answer : submitMessage) : undefined} />
          ) : (
            <QuestionPanel question={question} index={index} total={questions.length} answer={answer}
              answerStatus={answerStatus} locked={locked} heading={heading} editor={editor}
              change={text => updateAnswer(question.id, text)} move={move}
              reviewAnswer={() => setConfirmation('answer')} reviewSubmission={() => setConfirmation('submit')}
              dictate={voice.available ? () => void voice.run('Preparing to dictate…', dictate) : undefined}
              readQuestion={voice.available ? () => readAloud(questionText(question)) : undefined} />
          )}
          <SessionPanel answered={answered} questions={questionStates} current={index} reviewOpen={Boolean(confirmation)}
            selectQuestion={target => move(target - index)} busy={busy} voicePhase={voice.activity?.phase}
            voiceAvailable={voice.available} voiceError={Boolean(voice.error)}
            listen={() => void voice.run('Preparing voice controls…', command)}
            stop={() => {
              voice.stop();
              setStatus('Voice stopped.');
            }} />
        </div>
      )}
    </>
  );
}
