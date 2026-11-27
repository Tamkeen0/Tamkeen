import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '../../../contracts/types';
import { Icon } from './icons';
import type { IconName } from './icons';

export function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useLayoutEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}

export function WorkspaceIntro({ title, description, label, icon }: {
  title: ReactNode; description: ReactNode; label?: string; icon?: IconName;
}) {
  return (
    <div className="intro">
      {label && <p className="overline">{icon && <Icon name={icon} />}{label}</p>}
      <h2 tabIndex={-1}>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function Feedback({ status, error, pending = false }: { status?: string; error?: string; pending?: boolean }) {
  return (
    <div className="feedback">
      <p className="feedback-status" role="status" aria-atomic="true" data-pending={pending || undefined}>
        {status && <>{pending && <span className="loading-mark" aria-hidden="true" />}{status}</>}
      </p>
      <p className="feedback-error" role="alert" aria-atomic="true">{error && <bdi>{error}</bdi>}</p>
    </div>
  );
}

export function confirmedAnswer(session: Session | undefined, questionId: string) {
  return session && Object.hasOwn(session.answers, questionId) ? session.answers[questionId] : undefined;
}

export function AnswerList({ session, showQuestionText = false }: { session: Session; showQuestionText?: boolean }) {
  return (
    <dl className="answer-list">
      {session.exam.questions.map((question, index) => {
        const answer = confirmedAnswer(session, question.id);
        return (
          <div key={question.id}>
            <dt>{showQuestionText ? <>{index + 1}. <bdi>{question.text}</bdi></> : `Question ${index + 1}`}</dt>
            <dd className="literal">{answer === undefined ? 'Unanswered' : <bdi>{answer}</bdi>}</dd>
          </div>
        );
      })}
    </dl>
  );
}
