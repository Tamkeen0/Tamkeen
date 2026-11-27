import { useLayoutEffect, useRef } from 'react';
import type { FormEvent, Ref } from 'react';
import { UiError } from './errors';
import type { Diagram, Exam, Question } from '../../../contracts/types';
import { Feedback } from './components';
import { Icon } from './icons';

const lines = (value: string) => value.split(/\r?\n/).filter(line => line.trim());

function DiagramFields({ diagram, change }: { diagram: Diagram; change: (diagram: Diagram) => void }) {
  return (
    <fieldset className="circuit-editor">
      <legend>Circuit facts</legend>
      <div className="fields-grid">
        <label>Description<textarea dir="auto" required value={diagram.description} onChange={event => change({ ...diagram, description: event.target.value })} /></label>
        <label>Nodes, one per line<textarea dir="auto" defaultValue={diagram.nodes.join('\n')} onChange={event => change({ ...diagram, nodes: lines(event.target.value) })} /></label>
      </div>
      <div className="component-grid">
        {diagram.components.map((component, index) => {
          function update(next: typeof component) {
            change({ ...diagram, components: diagram.components.map((item, position) => position === index ? next : item) });
          }
          return (
            <fieldset className="component-editor" key={index}>
              <legend>Component {index + 1}</legend>
              <label>ID<input dir="auto" required value={component.id} onChange={event => update({ ...component, id: event.target.value })} /></label>
              <label>Kind<input dir="auto" required value={component.kind} onChange={event => update({ ...component, kind: event.target.value })} /></label>
              <label>Visible value<input dir="auto" required value={component.value} onChange={event => update({ ...component, value: event.target.value })} /></label>
              <div className="terminal-fields">
                <label>First terminal node<input dir="auto" required value={component.terminals[0]} onChange={event => update({ ...component, terminals: [event.target.value, component.terminals[1]] })} /></label>
                <label>Second terminal node<input dir="auto" required value={component.terminals[1]} onChange={event => update({ ...component, terminals: [component.terminals[0], event.target.value] })} /></label>
              </div>
              <button type="button" className="quiet" onClick={() => change({ ...diagram, components: diagram.components.filter((_, position) => index !== position) })}>Remove component {index + 1}</button>
            </fieldset>
          );
        })}
      </div>
      <button type="button" onClick={() => change({ ...diagram, components: [...diagram.components, { id: '', kind: '', value: '', terminals: ['', ''] }] })}>Add component</button>
    </fieldset>
  );
}

function QuestionFields({ question, index, active, group, change }: {
  question: Question; index: number; active: boolean; group?: Ref<HTMLFieldSetElement>; change: (question: Question) => void;
}) {
  return (
    <fieldset className="question-editor" id={'draft-question-' + (index + 1)} hidden={!active} tabIndex={-1} ref={group}>
      <legend>Question {index + 1}</legend>
      <label className="type-control">Type
        <select value={question.type} onChange={event => change({ ...question, type: event.target.value as Question['type'] })}>
          <option value="mcq">Multiple choice</option>
          <option value="text">Text</option>
          <option value="math">Math</option>
          <option value="diagram">Diagram</option>
        </select>
      </label>
      <div className="fields-grid wording-comparison">
        <div className="wording-field wording-source">
          <label>Original wording<textarea dir="auto" required value={question.text} onChange={event => change({ ...question, text: event.target.value })} /></label>
          <p>Verify against the source exam.</p>
        </div>
        <div className="wording-field wording-accessible">
          <label>Accessible wording<textarea dir="auto" required value={question.accessible_text} onChange={event => change({ ...question, accessible_text: event.target.value })} /></label>
          <p>This is the wording students receive.</p>
        </div>
      </div>
      <label>Options, one per line<textarea dir="auto" defaultValue={question.options.join('\n')} onChange={event => change({ ...question, options: lines(event.target.value) })} /></label>
      {question.diagram && <DiagramFields diagram={question.diagram} change={diagram => change({ ...question, diagram })} />}
      {question.diagram
        ? <button type="button" className="quiet" onClick={() => change({ ...question, diagram: null })}>Remove circuit</button>
        : <button type="button" onClick={() => change({ ...question, diagram: { description: '', nodes: [], components: [] } })}>Add circuit</button>}
    </fieldset>
  );
}

export class DraftQuestionError extends UiError {
  constructor(message: string, readonly index: number) { super(message); }
}

export function checkDraft(exam: Exam, publishing: boolean) {
  if (!exam.title.trim()) throw new UiError('Enter an exam title.');
  if (!exam.questions.length) throw new UiError('The draft needs at least one question.');
  exam.questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    const invalid = (message: string) => new DraftQuestionError(`${label} ${message}`, index);
    if (!question.text.trim() || !question.accessible_text.trim()) throw invalid('needs both versions of the wording.');
    if (publishing && question.type === 'mcq' && !question.options.length) throw invalid('needs its multiple-choice options before publication.');
    if (publishing && question.type === 'diagram' && !question.diagram) throw invalid('needs circuit facts before publication.');
    const diagram = question.diagram;
    if (!diagram) return;
    if (publishing && question.type === 'diagram' && (!diagram.nodes.length || !diagram.components.length)) {
      throw invalid('needs the circuit nodes and components before publication.');
    }
    if (!diagram.description.trim()) throw invalid('needs a circuit description.');
    if (diagram.components.some(component => [component.id, component.kind, component.value, ...component.terminals].some(value => !value.trim()))) {
      throw invalid('needs an ID, kind, visible value, and two terminals for each circuit component.');
    }
    if (!publishing) return;
    if (new Set(diagram.nodes).size !== diagram.nodes.length) throw invalid('lists a node more than once.');
    if (new Set(diagram.components.map(component => component.id.trim())).size !== diagram.components.length) {
      throw invalid('lists a component ID more than once.');
    }
    if (diagram.components.some(component => component.terminals.some(terminal => !diagram.nodes.includes(terminal)))) {
      throw invalid('has a component terminal that does not match a listed circuit node.');
    }
  });
}

type DraftEditorProps = {
  exam: Exam;
  activeQuestion: number;
  selectQuestion: (index: number) => void;
  busy: boolean;
  approved: boolean;
  dirty: boolean;
  demo: boolean;
  status?: string;
  error?: string;
  change: (exam: Exam) => void;
  approve: (approved: boolean) => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};

export default function DraftEditor({ exam, activeQuestion, selectQuestion, busy, approved, dirty, demo, status, error, change, approve, submit }: DraftEditorProps) {
  const group = useRef<HTMLFieldSetElement>(null);
  const previousQuestion = useRef(activeQuestion);
  useLayoutEffect(() => {
    if (previousQuestion.current !== activeQuestion) group.current?.focus();
    previousQuestion.current = activeQuestion;
  }, [activeQuestion]);

  return (
    <form noValidate onSubmit={submit}>
      {(exam.needs_review || demo || exam.warnings.length > 0) && (
        <div className="review-warning">
          <h4>Review warnings</h4>
          {exam.needs_review && <p>Verify the extracted content and resolve all review items before publishing.</p>}
          {(demo || exam.warnings.length > 0) && <ul>
            {demo && <li>This draft uses the demo fixture. Review the wording and circuit facts before publishing.</li>}
            {exam.warnings.map((warning, index) => <li key={index}><bdi dir="auto">{warning}</bdi></li>)}
          </ul>}
        </div>
      )}
      <fieldset disabled={busy} className="draft-fields">
        <legend className="visually-hidden">Exam content</legend>
        <div className="draft-toolbar">
          <label className="exam-title-control">Exam title<input dir="auto" required value={exam.title} onChange={event => change({ ...exam, title: event.target.value })} /></label>
          {dirty && <span className="tag tag-demo">Unsaved changes</span>}
        </div>
        <nav className="review-navigation" aria-label="Draft questions">
          {exam.questions.map((question, index) => (
            <button key={question.id} type="button" aria-current={index === activeQuestion ? 'step' : undefined}
              aria-controls={'draft-question-' + (index + 1)} onClick={() => selectQuestion(index)}>Question {index + 1}</button>
          ))}
        </nav>
        <Feedback status={status} error={error} pending={busy} />
        {exam.questions.map((question, index) => (
          <QuestionFields key={question.id} question={question} index={index} active={index === activeQuestion}
            group={index === activeQuestion ? group : undefined} change={next => change({
            ...exam, questions: exam.questions.map((item, position) => position === index ? next : item),
          })} />
        ))}
        <div className="approval">
          <h4><Icon name="check" /> Publication approval</h4>
          <label className="check">
            <input type="checkbox" checked={approved} onChange={event => approve(event.target.checked)} />
            I verified the accessible content against the source exam and resolved all review items.
          </label>
          <div className="actions">
            <button value="save">Save draft</button>
            <button className="primary" value="publish" disabled={!approved}>Publish exam</button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
