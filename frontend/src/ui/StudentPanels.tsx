import type { Ref } from 'react';
import type { Diagram, Question } from '../../../contracts/types';
import { Icon } from './icons';
import type { VoiceActivity } from './voice';

export type Confirmation = 'answer' | 'submit' | null;
const questionTypes: Record<Question['type'], string> = { mcq: 'Multiple choice', text: 'Written response', math: 'Mathematics', diagram: 'Circuit diagram' };
const voiceStates: Record<VoiceActivity['phase'], string> = {
  preparing: 'Preparing', listening: 'Listening', speaking: 'Speaking', processing: 'Processing command',
};

function Circuit({ diagram }: { diagram: Diagram }) {
  return (
    <details className="circuit">
      <summary><span><Icon name="circuit" /> Explore circuit facts</span></summary>
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
  dictate?: () => void;
  readQuestion?: () => void;
};

export function QuestionPanel({ question, index, total, answer, answerStatus, locked, heading, editor, change, move,
  reviewAnswer, reviewSubmission, dictate, readQuestion }: QuestionPanelProps) {
  return (
    <section className="panel question" aria-labelledby="question-heading">
      <div className="section-heading">
        <h3 id="question-heading" ref={heading} tabIndex={-1}>Question {index + 1} of {total}</h3>
        <span className={'tag answer-status' + (answerStatus === 'Answer confirmed' ? ' tag-live' : '')}>
          {answerStatus === 'Answer confirmed' && <Icon name="check" />}{answerStatus}
        </span>
      </div>
      <p className="question-kind">{questionTypes[question.type]}</p>
      <p className="question-text" dir="auto"><bdi>{question.accessible_text}</bdi></p>
      {question.options.length > 0 && (
        <fieldset disabled={locked} className="option-fieldset">
          <legend>Answer options</legend>
          <ul className="options" role="list">{question.options.map((option, position) => (
            <li key={position}><button type="button" aria-pressed={answer === option} onClick={() => change(option)}><bdi>{option}</bdi>
              {answer === option && <Icon name="check" />}</button></li>
          ))}</ul>
        </fieldset>
      )}
      {question.diagram && <Circuit key={question.id} diagram={question.diagram} />}
      <label className="answer-field">Your answer<textarea dir="auto" ref={editor} value={answer} readOnly={locked} onChange={event => change(event.target.value)} /></label>
      <div className="actions">
        <button className="primary" type="button" disabled={locked || !answer.trim()} onClick={reviewAnswer}>Review answer</button>
        {dictate && <button type="button" disabled={locked} onClick={dictate}><Icon name="microphone" /> Dictate answer</button>}
        {readQuestion && <button type="button" disabled={locked} onClick={readQuestion}><Icon name="sound" /> Read question aloud</button>}
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

export function ReviewPanel({ confirmation, answer, submitMessage, heading, locked, confirm, returnToQuestion, readBack }: {
  confirmation: Exclude<Confirmation, null>; answer: string; submitMessage: string; heading: Ref<HTMLHeadingElement>;
  locked: boolean; confirm: () => void; returnToQuestion: () => void; readBack?: () => void;
}) {
  const reviewingAnswer = confirmation === 'answer';
  return (
    <section className="panel review-panel" aria-labelledby="review-heading">
      <div className="section-title"><span className="icon-tile"><Icon name={reviewingAnswer ? 'check' : 'inbox'} /></span>
        <h3 id="review-heading" ref={heading} tabIndex={-1}>{reviewingAnswer ? 'Review your answer' : 'Review your submission'}</h3></div>
      {reviewingAnswer ? <p className="literal receipt" dir="auto"><bdi dir="auto">{answer}</bdi></p> : <p className="submission-message">{submitMessage}</p>}
      <div className="actions">
        <button type="button" className="primary" disabled={locked} onClick={confirm}>{reviewingAnswer ? 'Confirm answer' : 'Submit exam'}</button>
        <button type="button" disabled={locked} onClick={returnToQuestion}>{reviewingAnswer ? 'Edit answer' : 'Return to questions'}</button>
        {readBack && <button type="button" disabled={locked} onClick={readBack}>Read review aloud</button>}
      </div>
    </section>
  );
}

export function SessionPanel({ answered, questions, current, reviewOpen, selectQuestion, busy, voiceAvailable, voicePhase, voiceError, listen, stop }: {
  answered: number; questions: { confirmed: boolean; edited: boolean }[]; current: number; reviewOpen: boolean;
  selectQuestion: (index: number) => void; busy: boolean; voiceAvailable: boolean; voicePhase?: VoiceActivity['phase'];
  voiceError: boolean; listen: () => void; stop: () => void;
}) {
  const total = questions.length;
  const confirmedCount = `${answered} of ${total} confirmed`;
  const voiceState = !voiceAvailable ? 'Unavailable' : voicePhase ? voiceStates[voicePhase]
    : voiceError ? 'Voice error' : reviewOpen ? 'Confirmation required' : 'Ready';
  return (
    <aside className="panel session-panel" aria-labelledby="progress-heading">
      <h3 id="progress-heading">Exam progress</h3>
      <p className="progress-count"><strong>{answered} of {total}</strong> confirmed</p>
      <progress aria-label="Confirmed answers" aria-valuetext={confirmedCount} value={answered} max={total} />
      {!reviewOpen && <nav className="question-map" aria-label="Jump to a question">
        {questions.map(({ confirmed, edited }, index) => {
          const label = edited ? 'Unconfirmed edit' : confirmed ? 'Confirmed' : 'Unanswered';
          return <button key={index} type="button" aria-current={index === current ? 'step' : undefined}
            disabled={busy || Boolean(voicePhase)} onClick={() => selectQuestion(index)}>
            <span>Question {index + 1}</span><small>{confirmed && !edited && <Icon name="check" />}{label}</small>
          </button>;
        })}
      </nav>}
      <div className="voice-panel">
        <div className="voice-heading"><h4><Icon name={voicePhase === 'speaking' ? 'sound' : 'microphone'} /> Voice controls</h4>
          <span className="voice-state" data-active={Boolean(voicePhase) || undefined}>{voiceState}</span></div>
        {voiceAvailable ? (
          <>
            <p>Use a voice command to navigate, review, or ask for circuit facts.</p>
            <div className="actions">
              <button type="button" disabled={busy || Boolean(voicePhase)} onClick={listen}>Listen for command</button>
              <button type="button" disabled={!voicePhase || busy} onClick={stop}>Stop voice</button>
            </div>
          </>
        ) : <p>Voice is unavailable in this build. You can complete the exam with your keyboard.</p>}
      </div>
    </aside>
  );
}
