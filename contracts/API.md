# API contract v1 (lead-owned)
JSON UTF-8; all IDs strings; HTTP 400 malformed, 404 unknown, 409 illegal state. All routes use /api. No correct answers in exam payload. Mock fixture: fixtures/demo_exam.json. Exam object matches exam.schema.json. Server assigns IDs (document engine uses temporary ID draft). Student-facing exam content only published. Prototype is single-exam/single-device demo; no production authentication.

| Method + path | Request | Response |
|---|---|---|
| POST /api/exams | multipart `file` PDF | 201 Exam (draft) |
| GET /api/exams/{id} | none | Exam (professor) |
| PUT /api/exams/{id} | full Exam draft, professor edits | Exam (draft); same ID |
| POST /api/exams/{id}/publish | {"approved":true} | Exam (published); reject unresolved needs_review |
| POST /api/exams/{id}/sessions | {} | 201 Session, published exam only |
| GET /api/sessions/{id} | none | Session |
| PUT /api/sessions/{id}/answers/{question_id} | {"text":"literal confirmed answer"} | Session (idempotent overwrite) |
| POST /api/sessions/{id}/submit | {"confirmed":true} | Session (submitted, immutable) |
| GET /api/exams/{id}/submissions | none | {"submissions":[Session,...]} |
| GET /api/health | none | {"ok":true} |

Session: {id: string, exam: Exam, answers: Record<string,string>, status: "active"|"submitted"}. Answers stored verbatim, including math dictation; optional formatting never changes meaning. Unanswered questions allowed after explicit confirmation. Backend rejects updates after submission. Errors: {"detail":"message"} (FastAPI validation detail may be array). No live AI assistant endpoint. Use mock data until endpoints available. The UI has a professor mode and student mode, not production authentication. Do not expose actual confidential exams.

Python document module public interface: `from document_engine import extract_exam`; `extract_exam(pdf_bytes: bytes) -> dict` returns draft Exam conforming to schema. Raise ValueError for invalid PDF, RuntimeError for unavailable extraction. Provider key from environment. No provider key in frontend. Warnings must describe uncertainty; review is mandatory for every upload, even if needs_review false.

Voice public interface in `frontend/src/voice/index.ts` (see contracts/types.ts for data types): `speak(text: string): Promise<void>`; `stopSpeaking(): void`; `listenOnce(): Promise<string>` (reject unavailable/permission/timeout, no silent failures); `stopListening(): void`; `parseCommand(text: string): VoiceCommand`; `describeDiagram(diagram: Diagram, query: string): string` (approved factual lookup only, refuse unsupported/solution requests). UI owns state, invokes functions and confirms all saves/submissions. Voice owns implementation, not UI. Explicit dictation mode bypasses command parsing. UI never interprets transcript as a command in dictation mode.
