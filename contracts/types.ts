export type Component = { id: string; kind: string; value: string; terminals: [string, string] };
export type Diagram = { description: string; nodes: string[]; components: Component[] };
export type Question = { id: string; type: 'mcq'|'text'|'math'|'diagram'; text: string; accessible_text: string; options: string[]; diagram: Diagram|null };
export type Exam = { id: string; title: string; status: 'draft'|'published'; needs_review: boolean; warnings: string[]; questions: Question[] };
export type Session = { id: string; exam: Exam; answers: Record<string,string>; status: 'active'|'submitted' };
export type VoiceCommand = { type: 'next'|'previous'|'repeat'|'dictate'|'confirm'|'cancel'|'submit'|'unknown' } | { type: 'explore'; query: string };
