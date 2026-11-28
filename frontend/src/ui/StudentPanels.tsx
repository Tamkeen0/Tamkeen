import type { ReactNode, Ref } from 'react';
import type { Diagram, Question, Session } from '../../../contracts/types';
import { AnswerList } from './components';
import { Icon } from './icons';
import type { VoiceActivity, VoiceOutput } from './voice';

export type Confirmation = 'answer' | 'submit' | null;
function Circuit({ diagram }: { diagram: Diagram }) {
  return (
    <details className="circuit">
      <summary>Explore circuit facts</summary>
      <p dir="auto"><bdi>{diagram.description}</bdi></p>
      {diagram.nodes.length > 0 && (
        <>
          <h4>Nodes</h4>
          <ul className="nodes" role="list">{diagram.nodes.map(node => <li key={node}><bdi>{node}</bdi></li>)}</ul>
        </>
      )}
      {diagram.components.length > 0 && (
        <>
          <h4>Components and terminals</h4>
          <dl className="answer-list">{diagram.components.map(component => (
            <div key={component.id}>
              <dt><bdi>{component.id}</bdi> · <bdi>{component.kind}</bdi></dt>
              <dd><bdi>{component.value}</bdi>. Terminals at <bdi>{component.terminals[0]}</bdi> and <bdi>{component.terminals[1]}</bdi>.</dd>
            </div>
          ))}</dl>
        </>
      )}
    </details>
  );
}

type QuestionPanelProps = {
  question: Question;
  index: number;
  total: number;
  answer: string;
  answerStatus: string;
  locked: boolean;
  heading: Ref<HTMLHeadingElement>;
  editor: Ref<HTMLTextAreaElement>;
  change: (text: string) => void;
  move: (offset: number) => void;
  reviewAnswer: () => void;
  reviewSubmission: () => void;
  voiceControls: ReactNode;
};

export function QuestionPanel({ question, index, total, answer, answerStatus, locked, heading, editor, change, move,
  reviewAnswer, reviewSubmission, voiceControls }: QuestionPanelProps) {
  return (
    <section className="panel question" aria-labelledby="question-heading">
      <h3 id="question-heading" ref={heading} tabIndex={-1}
        aria-describedby={index === 0 ? 'student-exam-title' : undefined}>Question {index + 1} of {total}</h3>
      <p className="question-text" dir="auto"><bdi>{question.accessible_text}</bdi></p>
      {question.diagram && <Circuit key={question.id} diagram={question.diagram} />}
      {question.options.length > 0 && (
        <fieldset disabled={locked} className="option-fieldset">
          <legend>Answer options</legend>
          <ul className="options" role="list">{question.options.map((option, position) => (
            <li key={position}><button type="button" aria-pressed={answer === option} onClick={() => change(option)}><bdi>{option}</bdi>
              {answer === option && <Icon name="check" />}</button></li>
          ))}</ul>
        </fieldset>
      )}
      <label className="answer-field">Your answer<textarea aria-describedby="answer-status" dir="auto" ref={editor} value={answer} readOnly={locked} onChange={event => change(event.target.value)} /></label>
      {voiceControls}
      <p className="answer-status" id="answer-status">{answerStatus}</p>
      <div className="actions">
        <button className="primary" type="button" disabled={locked || !answer.trim()} onClick={reviewAnswer}>Review answer</button>
      </div>
      <nav className="question-nav" aria-label="Question navigation">
        <div className="actions">
          <button type="button" disabled={locked || index === 0} onClick={() => move(-1)}><Icon name="back" /> Previous question</button>
          <button type="button" disabled={locked || index === total - 1} onClick={() => move(1)}>Next question <Icon name="arrow" /></button>
        </div>
        <button className="quiet" type="button" disabled={locked} onClick={reviewSubmission}>Review submission</button>
      </nav>
    </section>
  );
}

export function ReviewPanel({ confirmation, answer, session, submitMessage, heading, locked, confirm, returnToQuestion, voiceControls }: {
  confirmation: Exclude<Confirmation, null>; answer: string; session: Session; submitMessage: string; heading: Ref<HTMLHeadingElement>;
  locked: boolean; confirm: () => void; returnToQuestion: () => void; voiceControls: ReactNode;
}) {
  const reviewingAnswer = confirmation === 'answer';
  return (
    <section className="panel review-panel" aria-labelledby="review-heading">
      <h3 id="review-heading" ref={heading} tabIndex={-1}>{reviewingAnswer ? 'Review your answer' : 'Review your submission'}</h3>
      {reviewingAnswer
        ? <p className="literal receipt" dir="auto"><bdi dir="auto">{answer}</bdi></p>
        : <><p className="submission-message">{submitMessage}</p><AnswerList session={session} /></>}
      <div className="actions">
        <button type="button" className="primary" disabled={locked} onClick={confirm}>{reviewingAnswer ? 'Confirm answer' : 'Submit exam'}</button>
        <button type="button" disabled={locked} onClick={returnToQuestion}>{reviewingAnswer ? 'Edit answer' : 'Return to questions'}</button>
      </div>
      {voiceControls}
    </section>
  );
}

export function SessionPanel({ answered, questions, current, selectQuestion, locked }: {
  answered: number; questions: { confirmed: boolean; edited: boolean }[]; current: number;
  selectQuestion: (index: number) => void; locked: boolean;
}) {
  return (
    <details className="exam-progress">
      <summary>Exam progress: {answered} of {questions.length} confirmed</summary>
      <nav className="question-map" aria-label="Jump to a question">
        {questions.map(({ confirmed, edited }, index) => {
          const label = edited ? 'Unconfirmed edit' : confirmed ? 'Confirmed' : 'Unanswered';
          return <button key={index} type="button" aria-current={index === current ? 'step' : undefined}
            disabled={locked} onClick={() => selectQuestion(index)}>
            <span>Question {index + 1}</span><small>{label}</small>
          </button>;
        })}
      </nav>
    </details>
  );
}

export function VoiceControls({ available, activity, busy, keyboardOnly, reviewing, output, setOutput, dictate, read, listen, stop, retry }: {
  available: boolean; activity?: VoiceActivity; busy: boolean; keyboardOnly: boolean; reviewing: boolean;
  output: VoiceOutput; setOutput: (output: VoiceOutput) => void; dictate: () => void; read: () => void;
  listen: () => void; stop: () => void; retry: () => void;
}) {
  if (!available) return null;
  const locked = busy || Boolean(activity);
  return (
    <div className="voice-panel">
      {!reviewing && !keyboardOnly && <button type="button" aria-disabled={locked} onClick={() => { if (!locked) dictate(); }}><Icon name="microphone" /> Dictate answer</button>}
      {activity && <button type="button" disabled={busy} onClick={stop}>Stop voice</button>}
      <details>
        <summary>Voice commands and settings</summary>
        <p>{keyboardOnly ? 'You can continue with the keyboard.' : reviewing
          ? 'Say “confirm” to confirm the current review or “cancel” to return.'
          : 'Say “help” for available commands.'}</p>
        <div className="actions">
          {keyboardOnly
            ? <button type="button" disabled={locked} onClick={retry}>Retry microphone</button>
            : <button type="button" aria-disabled={locked} onClick={() => { if (!locked) listen(); }}>Listen for command</button>}
          <button type="button" aria-disabled={locked} onClick={() => { if (!locked) read(); }}>{reviewing ? 'Read review aloud' : 'Read question aloud'}</button>
        </div>
        <label className="voice-output">Voice feedback
          <select value={output} disabled={locked} onChange={event => setOutput(event.target.value as VoiceOutput)}>
            <option value="screenReader">Screen reader</option>
            <option value="app">App voice</option>
            <option value="both">App voice, then screen reader</option>
          </select>
        </label>
      </details>
    </div>
  );
}
