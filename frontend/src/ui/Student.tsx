import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UiError } from './errors';
import type { MathTranscription, Session } from '../../../contracts/types';
import type { ExamApi } from './api';
import { AnswerList, WorkspaceIntro, confirmedAnswer } from './components';
import { QuestionPanel, ReviewPanel, SessionPanel, VoiceControls } from './StudentPanels';
import type { Confirmation } from './StudentPanels';
import { Icon } from './icons';
import MicrophoneCheck from './MicrophoneCheck';
import { useRequest } from './useRequest';
import { useVoice } from './voice';
import type { AnswerDraft, AnswerState, DiagramExplorer, VoiceApi, VoiceOutput } from './voice';

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

type MathReview = MathTranscription | { status: 'unavailable'; message: string };

function mathReviewMessage(result: MathReview | undefined) {
  if (result?.status === 'ambiguous') return `${result.clarification} Dictate the full expression again.`;
  if (result?.status === 'rejected') return 'Only mathematical transcription is available. Dictate your expression again.';
  if (result?.status === 'unavailable') return `${result.message} You can retry or confirm the original transcript.`;
}

export default function Student({ api, suggestedExamId, visible, onSessionActive, openAccessibility }: StudentProps) {
  const [enteredId, setEnteredId] = useState<string>();
  const [checkingMicrophone, setCheckingMicrophone] = useState(false);
  const [session, setSession] = useState<Session>();
  const [mathAvailable, setMathAvailable] = useState(false);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState(() => new Map<string, string>());
  const [mathReviews, setMathReviews] = useState(() => new Map<string, MathReview>());
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [status, setStatus] = useState<string>();
  const { busy, pending, error, run } = useRequest();
  const [output, setOutput] = useState<VoiceOutput>('screenReader');
  const voice = useVoice(visible, output);
  const editHistory = useRef(new Map<string, AnswerDraft>());
  const explorer = useRef<{ id: string; instance: DiagramExplorer } | undefined>(undefined);
  const visited = useRef(new Set<string>());
  const lastArrival = useRef<string | undefined>(undefined);
  const startInput = useRef<HTMLInputElement>(null);
  const restarting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const focusEditor = useRef(false);

  useLayoutEffect(() => {
    if (!visible) setCheckingMicrophone(false);
  }, [visible]);

  const sessionId = session?.id;
  const sessionStatus = session?.status;
  useLayoutEffect(() => {
    if (!visible) return;
    if (!sessionId) {
      if (restarting.current) {
        restarting.current = false;
        startInput.current?.focus();
      }
      return;
    }
    const target = focusEditor.current && !confirmation ? editor.current : heading.current;
    focusEditor.current = false;
    target?.focus();
  }, [visible, sessionId, sessionStatus, index, confirmation]);

  const examId = enteredId ?? suggestedExamId;
  const questions = session?.exam.questions ?? [];
  const question = questions[index];
  const saved = question ? confirmedAnswer(session, question.id) : undefined;
  const answer = question ? drafts.get(question.id) ?? saved ?? '' : '';
  const mathReview = question ? mathReviews.get(question.id) : undefined;
  const mathNotation = mathReview?.status === 'ok' ? mathReview : undefined;
  const mathMessage = mathReviewMessage(mathReview);
  const mathNeedsRetry = mathReview?.status === 'ambiguous' || mathReview?.status === 'rejected';
  const canDictateMath = Boolean(mathAvailable && api.transcribeMath && question && question.type !== 'mcq');
  const questionStates = questions.map(item => {
    const confirmed = confirmedAnswer(session, item.id);
    return {
      confirmed: confirmed !== undefined,
      edited: mathReviews.get(item.id)?.status === 'ok' || (drafts.has(item.id) && drafts.get(item.id) !== (confirmed ?? '')),
    };
  });
  const answerStatus = questionStates[index]?.edited ? 'Unconfirmed edit' : saved === undefined ? 'Awaiting a confirmed answer' : 'Answer confirmed';
  const answered = questionStates.filter(item => item.confirmed).length;
  const unanswered = questions.length - answered;
  const unconfirmed = questionStates.filter(item => item.edited).length;
  const unansweredSummary = `${unanswered} of ${questions.length} questions unanswered.`;
  const editWarning = unconfirmed ? ` Submitting will discard ${unconfirmed} unconfirmed ${unconfirmed === 1 ? 'edit' : 'edits'}.` : '';
  const submitMessage = `${unansweredSummary}${editWarning} Submission locks your confirmed answers.`;
  const locked = busy || Boolean(voice.activity);
  const voiceFeedback = voice.activity?.phase === 'speaking' ? undefined : voice.activity?.label;
  const announcement = error ?? voice.announcement ?? voiceFeedback ?? (voice.result ? undefined : voice.error ?? pending ?? status);

  function updateAnswer(id: string, text: string) {
    editHistory.current.get(id)?.replaceAll(text);
    setDrafts(current => new Map(current).set(id, text));
    clearMathReview(id);
  }

  function clearMathReview(id: string) {
    setMathReviews(current => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }

  function startExam() {
    void run('Starting exam…', async () => {
      if (!examId.trim()) throw new UiError('Enter a student exam ID.');
      onSessionActive(true);
      try {
        const started = checkSession(await api.startSession(examId.trim()), 'active');
        // Offer math dictation only when the server can actually format math.
        setMathAvailable(await (api.mathTranscriptionAvailable?.().catch(() => false) ?? false));
        setIndex(0);
        setSession(started);
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
    explorer.current = undefined;
    voice.clear();
    setIndex(next);
  }

  function saveAnswer(onSaved?: () => Promise<void>) {
    if (!session || !question || confirmation !== 'answer' || !answer.trim() || mathNeedsRetry) return;
    return run('Saving your answer…', async () => {
      voice.clear();
      setStatus(undefined);
      const notation = mathNotation && { latex: mathNotation.latex, spoken: mathNotation.spoken };
      setSession(checkSession(await api.saveAnswer(session.id, question.id, answer, notation), 'active', session.id));
      setDrafts(current => {
        const next = new Map(current);
        next.delete(question.id);
        return next;
      });
      editHistory.current.delete(question.id);
      clearMathReview(question.id);
      setConfirmation(null);
      setStatus(`Answer confirmed for question ${index + 1}.`);
      await onSaved?.();
    });
  }

  function submitExam(onSubmitted?: () => Promise<void>) {
    if (!session || confirmation !== 'submit') return;
    return run('Submitting exam…', async () => {
      voice.clear();
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
      setMathReviews(new Map());
      editHistory.current.clear();
      setConfirmation(null);
      onSessionActive(false);
      await onSubmitted?.();
    });
  }

  function cancelReview() {
    focusEditor.current = confirmation === 'answer';
    setConfirmation(null);
    setStatus(confirmation ? 'Returned to the question.' : 'You are on the question.');
  }

  function stateAt(position: number): AnswerState {
    const state = questionStates[position];
    return state?.edited ? 'draft' : state?.confirmed ? 'saved' : 'none';
  }

  function readQuestion(api: VoiceApi, position: number, arrival = false) {
    const item = questions[position];
    if (!item) return;
    const firstVisit = arrival && !visited.current.has(item.id);
    if (arrival) {
      lastArrival.current = item.id;
      visited.current.add(item.id);
    }
    return voice.speak(api, api.questionSpeech(item, position, questions.length, { firstVisit, status: stateAt(position) }));
  }

  useEffect(() => {
    if (!visible || sessionStatus !== 'active' || !question || lastArrival.current === question.id) return;
    if (output === 'screenReader') {
      lastArrival.current = question.id;
      visited.current.add(question.id);
      return;
    }
    void voice.run('Preparing question…', async api => { await readQuestion(api, index, true); });
  }, [visible, sessionStatus, question?.id, output]);

  function stopVoice() {
    const stopped = voice.stop();
    voice.clear();
    if (confirmation === 'submit' && !busy) cancelReview();
    else if (stopped) setStatus('Voice stopped. Any unsaved draft is kept.');
    heading.current?.focus();
  }

  useEffect(() => {
    if (!visible || sessionStatus !== 'active') return;
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (voice.activity || confirmation === 'submit') {
        event.preventDefault();
        stopVoice();
      }
    }
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [visible, sessionStatus, voice.activity, confirmation]);

  function getExplorer(api: VoiceApi) {
    if (!explorer.current || explorer.current.id !== question.id) {
      explorer.current = { id: question.id, instance: api.createDiagramExplorer(question.diagram) };
    }
    return explorer.current.instance;
  }

  function startReview(api: VoiceApi, text: string, message = api.prompts.readBack(text)) {
    updateAnswer(question.id, text);
    setConfirmation(text.trim() ? 'answer' : null);
    return voice.speak(api, message);
  }

  async function dictate(voiceApi: VoiceApi, isCurrent: () => boolean, signal: AbortSignal, math = false) {
    const id = question.id;
    if (!editHistory.current.has(id)) editHistory.current.set(id, new voiceApi.AnswerDraft(answer));
    let transcript: string;
    try {
      transcript = await voice.listen(voiceApi, 'dictation');
    } catch (failure) {
      const partial = voiceApi.isVoiceError(failure) ? failure.partialTranscript : undefined;
      if (partial?.trim()) {
        if (isCurrent()) {
          await startReview(voiceApi, partial, `${voiceApi.recoveryPrompt(failure)} ${voiceApi.prompts.readBack(partial)}`);
        } else {
          updateAnswer(id, partial);
          setStatus(voiceApi.prompts.draftKept);
        }
      } else if (isCurrent()) {
        throw failure;
      }
      return;
    }
    if (!isCurrent()) return;
    if (!math || !api.transcribeMath || !session) {
      await startReview(voiceApi, transcript);
      return;
    }

    updateAnswer(id, transcript);
    setConfirmation('answer');
    voice.processing('Formatting your dictated expression…');
    let result: MathReview;
    try {
      result = await api.transcribeMath(session.id, transcript, signal);
    } catch (failure) {
      if (!isCurrent()) return;
      result = { status: 'unavailable', message: failure instanceof UiError ? failure.message : 'Math transcription is unavailable.' };
    }
    if (!isCurrent()) return;
    setMathReviews(current => new Map(current).set(id, result));
    await voice.speak(voiceApi, result.status === 'ok'
      ? `Interpreted expression. ${result.spoken} Say confirm to save it, or dictate the expression again.`
      : mathReviewMessage(result) ?? '');
  }

  async function command(api: VoiceApi, isCurrent: () => boolean, signal: AbortSignal) {
    const transcript = await voice.listen(api, 'command');
    if (!isCurrent()) return;
    const say = (text: string) => voice.speak(api, text);
    const moveTo = async (position: number) => {
      if (position < 0) return say(api.prompts.firstQuestion);
      if (position >= questions.length) return say(api.prompts.lastQuestion);
      if (position !== index) {
        setConfirmation(null);
        move(position - index);
        if (output === 'screenReader') return;
      }
      await readQuestion(api, position, position !== index);
    };
    const keepAnswer = async () => {
      if (mathNeedsRetry) return say(mathMessage ?? '');
      if (!questionStates[index]?.edited || !answer.trim()) return say(api.prompts.nothingToConfirm);
      if (confirmation === 'answer') await saveAnswer(() => say(api.prompts.saved(index)));
      else if (mathNotation) {
        setConfirmation('answer');
        await say(mathNotation.spoken);
      } else await startReview(api, answer);
    };
    const readSubmission = () => api.prompts.submitConfirm(answered, questions.length,
      questionStates.flatMap((state, position) => state.edited ? [position + 1] : []));

    if (confirmation === 'submit') {
      const parsed = api.parseCommand(transcript);
      const explicitConfirm = /^confirm[.!?]*$/i.test(transcript.trim());
      if (parsed.type === 'confirm' && explicitConfirm) await submitExam(() => say(api.prompts.submitted));
      else if (parsed.type === 'cancel') {
        cancelReview();
        await say(api.prompts.submitCancelled);
      } else if (parsed.type === 'repeat') await say(readSubmission());
      else await say(api.prompts.submitReminder);
      return;
    }

    if (canDictateMath && /^dictate (?:math|(?:the )?expression)(?: again)?[.!?]*$/i.test(transcript.trim())) {
      await say(api.prompts.dictationStart);
      if (isCurrent()) await dictate(api, isCurrent, signal, true);
      return;
    }

    const nav = api.parseNavigation(transcript);
    if (nav) {
      switch (nav.type) {
        case 'next': await moveTo(index + 1); return;
        case 'previous': await moveTo(index - 1); return;
        case 'goto': {
          const position = nav.question === -1 ? questions.length - 1 : nav.question - 1;
          if (position < 0 || position >= questions.length) await say(api.prompts.noSuchQuestion(nav.question, questions.length));
          else await moveTo(position);
          return;
        }
        case 'repeatLast': await say(voice.lastMessage.current || api.prompts.nothingToRepeat); return;
        case 'repeatQuestion': await readQuestion(api, index); return;
        case 'readOptions': await say(api.prompts.options(question)); return;
        case 'progress': {
          const progress = api.prompts.progress(index, questions.length, questionStates.map(state => state.confirmed));
          const diagram = getExplorer(api);
          await say(diagram.exploring ? `${progress} ${diagram.where()}` : progress);
          return;
        }
        case 'answerStatus': await say(api.prompts.answerStatus(index, stateAt(index))); return;
        case 'readAnswer': {
          const position = nav.question === undefined ? index : nav.question - 1;
          const item = questions[position];
          if (!item) {
            await say(api.prompts.noSuchQuestion(position + 1, questions.length));
            return;
          }
          const unsaved = drafts.get(item.id);
          const dictated = mathReviews.get(item.id);
          if (stateAt(position) === 'draft' && unsaved !== undefined) {
            await say(dictated?.status === 'ok' ? dictated.spoken : api.prompts.draftAnswer(position, unsaved));
          } else {
            const savedNotation = session?.math_answers?.[item.id];
            await say(savedNotation?.spoken ?? api.prompts.savedAnswer(position, confirmedAnswer(session, item.id)));
          }
          return;
        }
        case 'time': await say(api.prompts.timeUnavailable); return;
        case 'help': await say(api.prompts.help); return;
        case 'redictate': await say(api.prompts.dictationStart); if (isCurrent()) await dictate(api, isCurrent, signal, canDictateMath && (question.type === 'math' || Boolean(mathReview))); return;
        case 'saveAnswer': await keepAnswer(); return;
        case 'selectOption': {
          const position = api.matchOption(question, nav.choice);
          if (position === null) await say(api.prompts.noSuchOption(nav.choice, question));
          else {
            if (!editHistory.current.has(question.id)) editHistory.current.set(question.id, new api.AnswerDraft(answer));
            const option = question.options[position];
            await startReview(api, option, api.prompts.optionChosen(option));
          }
          return;
        }
      }
    }

    const edit = api.parseEditCommand(transcript);
    if (edit) {
      const history = editHistory.current.get(question.id) ?? new api.AnswerDraft(answer);
      editHistory.current.set(question.id, history);
      const result = history.apply(edit);
      const message = api.editResultPrompt(result);
      if (result.ok && result.changed) await startReview(api, result.text, message);
      else await say(message);
      return;
    }

    const parsed = api.parseCommand(transcript);
    switch (parsed.type) {
      case 'confirm': await keepAnswer(); return;
      case 'cancel':
        if (/^discard\b/i.test(transcript.trim()) && questionStates[index]?.edited) {
          const history = editHistory.current.get(question.id) ?? new api.AnswerDraft(answer);
          editHistory.current.set(question.id, history);
          history.replaceAll(saved ?? '');
          clearMathReview(question.id);
          setDrafts(current => {
            const next = new Map(current);
            next.delete(question.id);
            return next;
          });
          if (confirmation === 'answer') cancelReview();
          await say('Draft discarded. Your saved answer is unchanged. Say undo to restore the draft.');
        } else {
          if (confirmation === 'answer') cancelReview();
          await say('Cancelled. Any unsaved draft is kept.');
        }
        return;
      case 'repeat':
        if (confirmation === 'answer') await say(mathNotation?.spoken ?? mathMessage ?? api.prompts.readBack(answer));
        else await readQuestion(api, index);
        return;
      case 'next': await moveTo(index + 1); return;
      case 'previous': await moveTo(index - 1); return;
      case 'dictate': await say(api.prompts.dictationStart); if (isCurrent()) await dictate(api, isCurrent, signal, canDictateMath && question.type === 'math'); return;
      case 'submit': setConfirmation('submit'); await say(readSubmission()); return;
      case 'explore': await say(getExplorer(api).ask(parsed.query)); return;
      case 'unknown': await say('I can navigate the exam, take dictation, or read approved circuit facts. Say help for commands.'); return;
    }
  }

  function readAloud(message: (api: VoiceApi) => string) {
    void voice.run('Preparing to read aloud…', api => voice.speak(api, message(api)));
  }

  function startMathDictation() {
    void voice.run('Preparing to dictate math…', (api, isCurrent, signal) => dictate(api, isCurrent, signal, true));
  }

  const voiceControls = <VoiceControls available={voice.available} activity={voice.activity}
    busy={busy} keyboardOnly={voice.keyboardOnly} reviewing={Boolean(confirmation)}
    output={output} setOutput={next => {
      voice.clear();
      setOutput(next);
    }}
    dictate={() => void voice.run('Preparing to dictate…', dictate)}
    dictateMath={canDictateMath ? startMathDictation : undefined}
    read={() => confirmation ? readAloud(api => confirmation === 'answer'
      ? mathNotation?.spoken ?? mathMessage ?? api.readBackText(answer)
      : [submitMessage, ...questions.map((item, position) =>
          `Question ${position + 1}. ${session?.math_answers?.[item.id]?.spoken ?? api.readBackText(confirmedAnswer(session, item.id) ?? 'Unanswered.')}`)].join(' '))
      : void voice.run('Preparing question…', async api => { await readQuestion(api, index); })}
    listen={() => void voice.run('Preparing voice controls…', command)} stop={stopVoice} retry={voice.retry} />;

  return (
    <div className="reading-column">
      <WorkspaceIntro title={session ? <bdi>{session.exam.title}</bdi> : 'Student workspace'} headingId={session ? 'student-exam-title' : undefined}
        description={session ? <>Student session <bdi>{session.id}</bdi></> : 'Use the exam ID provided by your professor.'} />
      <p className="visually-hidden" role="status" aria-atomic="true">{announcement}</p>
      <p className="feedback-status" data-pending={busy || undefined}>
        {pending || voice.activity?.label || (voice.result !== voice.error ? voice.result : undefined) || status}
      </p>
      <p className="feedback-error">{error || voice.error}</p>
      {visible && checkingMicrophone && !session && <MicrophoneCheck onCancel={() => setCheckingMicrophone(false)} onContinue={() => {
        setCheckingMicrophone(false);
        startExam();
      }} />}
      {!session ? (
        <section className="panel start-panel" aria-labelledby="start-heading">
          <h3 id="start-heading">Start an exam</h3>
          <p className="exam-instructions">The microphone check is optional. Review and confirm each answer to save it.
            When you finish, review any unanswered questions before submitting.</p>
          <form noValidate onSubmit={event => {
            event.preventDefault();
            if (examId.trim()) setCheckingMicrophone(true);
            else startExam();
          }}>
            <label>Student exam ID<input ref={startInput} required dir="auto" value={examId} disabled={busy} onChange={event => setEnteredId(event.target.value)} /></label>
            <button className="primary" disabled={busy}>Start exam <Icon name="arrow" /></button>
          </form>
        </section>
      ) : session.status === 'submitted' ? (
        <section className="panel submitted-panel" aria-labelledby="submitted-heading">
          <h3 id="submitted-heading" ref={heading} tabIndex={-1}>Exam submitted</h3>
          <p>Your confirmed answers are locked.</p>
          <AnswerList session={session} />
          <button type="button" disabled={locked} onClick={() => {
            restarting.current = true;
            visited.current.clear();
            lastArrival.current = undefined;
            explorer.current = undefined;
            setEnteredId(undefined);
            setStatus(undefined);
            voice.clear();
            setSession(undefined);
          }}>Start another exam</button>
        </section>
      ) : (
        <div className="student-layout">
          {confirmation ? (
            <ReviewPanel confirmation={confirmation} answer={answer} session={session} submitMessage={submitMessage} heading={heading}
              math={mathNotation} mathMessage={mathMessage} confirmDisabled={mathNeedsRetry}
              retryMath={mathReview && voice.available && !voice.keyboardOnly ? startMathDictation : undefined}
              locked={locked} confirm={() => { void (confirmation === 'answer' ? saveAnswer() : submitExam()); }} returnToQuestion={() => {
                voice.clear();
                cancelReview();
              }}
              voiceControls={voiceControls} />
          ) : (
            <QuestionPanel question={question} index={index} total={questions.length} answer={answer}
              answerStatus={answerStatus} locked={locked} heading={heading} editor={editor}
              change={text => updateAnswer(question.id, text)} move={move}
              reviewAnswer={() => { voice.clear(); setConfirmation('answer'); }}
              reviewSubmission={() => { voice.clear(); setConfirmation('submit'); }}
              voiceControls={voiceControls} />
          )}
          {!confirmation && <SessionPanel answered={answered} questions={questionStates} current={index}
            selectQuestion={target => target !== index && move(target - index)} locked={locked} />}
          <div className="exam-tools">
            <button type="button" className="quiet" aria-haspopup="dialog" aria-controls="accessibility-studio"
              onClick={event => openAccessibility(event.currentTarget)}>Exam accessibility</button>
          </div>
        </div>
      )}
    </div>
  );
}
