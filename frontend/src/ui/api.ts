import type { Exam, MathNotation, MathTranscription, Session } from '../../../contracts/types';
import { UiError } from './errors';
import fixture from '../../../fixtures/demo_exam.json';

export const demoExamId = fixture.id;

export interface ExamApi {
  upload(file: File): Promise<Exam>;
  getExam(id: string): Promise<Exam>;
  saveDraft(exam: Exam): Promise<Exam>;
  publish(id: string): Promise<Exam>;
  startSession(examId: string): Promise<Session>;
  getSession(id: string): Promise<Session>;
  saveAnswer(sessionId: string, questionId: string, text: string, math?: MathNotation): Promise<Session>;
  transcribeMath?(sessionId: string, transcript: string, signal: AbortSignal): Promise<MathTranscription>;
  submit(sessionId: string): Promise<Session>;
  getSubmissions(examId: string): Promise<Session[]>;
}

const examPath = (id: string) => `/exams/${encodeURIComponent(id)}`;
const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;

async function request<T>(path: string, method = 'GET', body?: FormData | object, signal?: AbortSignal): Promise<T> {
  const multipart = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, signal,
      body: multipart ? body : JSON.stringify(body),
      headers: { Accept: 'application/json', ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new UiError('Could not reach the exam server. Check the connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const detail = data?.detail;
    const messages = Array.isArray(detail) ? detail.map(item => item?.msg).filter(message => typeof message === 'string') : [];
    const original = typeof detail === 'string' ? detail : messages.join(' ');
    const status = response.status;
    const reason = status === 413 ? 'The file exceeds the exam server upload limit. Upload a smaller PDF.'
      : status === 400 || status === 422 ? 'The exam server could not accept the supplied information. Check it and try again.'
      : status === 404 ? 'The exam server could not find the requested item.'
      : status === 409 ? 'The exam server cannot complete this action in its current state.'
      : `The exam server returned an unexpected response (${status}).`;
    throw new UiError(original || reason);
  }
  return data as T;
}

export const liveApi: ExamApi = {
  upload(file) {
    const form = new FormData();
    form.append('file', file);
    return request('/exams', 'POST', form);
  },
  getExam: id => request(examPath(id)),
  saveDraft: exam => request(examPath(exam.id), 'PUT', exam),
  publish: id => request(`${examPath(id)}/publish`, 'POST', { approved: true }),
  startSession: id => request(`${examPath(id)}/sessions`, 'POST', {}),
  getSession: id => request(sessionPath(id)),
  saveAnswer: (id, questionId, text, math) =>
    request(`${sessionPath(id)}/answers/${encodeURIComponent(questionId)}`, 'PUT', { text, math }),
  transcribeMath: (id, transcript, signal) =>
    request(`${sessionPath(id)}/math-transcription`, 'POST', { transcript }, signal),
  submit: id => request(`${sessionPath(id)}/submit`, 'POST', { confirmed: true }),
  async getSubmissions(id) {
    const result = await request<{ submissions: Session[] }>(`${examPath(id)}/submissions`);
    return result.submissions;
  },
};

export function createMockApi(): ExamApi {
  const sample = fixture as Exam;
  const exams = new Map([[sample.id, structuredClone(sample)]]);
  const sessions = new Map<string, Session>();

  function getExam(id: string) {
    const exam = exams.get(id);
    if (!exam) throw new UiError('Exam ID was not found.');
    return exam;
  }

  function getDraft(id: string) {
    const exam = getExam(id);
    if (exam.status !== 'draft') throw new UiError('Only drafts can be edited or published.');
    return exam;
  }

  function getSession(id: string) {
    const session = sessions.get(id);
    if (!session) throw new UiError('Session ID was not found.');
    return session;
  }

  function getActiveSession(id: string) {
    const session = getSession(id);
    if (session.status !== 'active') throw new UiError('This session has already been submitted.');
    return session;
  }

  return {
    async upload(file) {
      if (!file.size || !/\.pdf$/i.test(file.name)) throw new UiError('Choose a nonempty PDF file.');
      const exam: Exam = {
        ...structuredClone(sample), id: `demo-${exams.size}`, status: 'draft', needs_review: true,
      };
      exams.set(exam.id, exam);
      return structuredClone(exam);
    },
    async getExam(id) { return structuredClone(getExam(id)); },
    async saveDraft(exam) {
      getDraft(exam.id);
      const draft: Exam = { ...structuredClone(exam), status: 'draft' };
      exams.set(draft.id, draft);
      return structuredClone(draft);
    },
    async publish(id) {
      const draft = getDraft(id);
      if (draft.needs_review) throw new UiError('Resolve review items before publishing.');
      draft.status = 'published';
      return structuredClone(draft);
    },
    async startSession(id) {
      const exam = getExam(id);
      if (exam.status !== 'published') throw new UiError('This exam is awaiting publication.');
      const session: Session = { id: `session-${sessions.size + 1}`, exam: structuredClone(exam), answers: {}, status: 'active' };
      sessions.set(session.id, session);
      return structuredClone(session);
    },
    async getSession(id) { return structuredClone(getSession(id)); },
    async saveAnswer(id, questionId, text) {
      const session = getActiveSession(id);
      if (!session.exam.questions.some(question => question.id === questionId)) throw new UiError('Question ID was not found.');
      session.answers = { ...session.answers, [questionId]: text };
      return structuredClone(session);
    },
    async submit(id) {
      const session = getActiveSession(id);
      session.status = 'submitted';
      return structuredClone(session);
    },
    async getSubmissions(id) {
      getExam(id);
      return [...sessions.values()].filter(session => session.exam.id === id && session.status === 'submitted').map(session => structuredClone(session));
    },
  };
}
