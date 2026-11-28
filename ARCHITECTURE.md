# Architecture (v1, frozen until lead approves changes)
Working name Tamkeen. Single React/TypeScript frontend and Python/FastAPI backend; SQLite or in-memory storage for prototype (lead decides); Vite proxies /api to port 8000. Document engine is imported by backend as Python package, not its own server. Voice engine is a TypeScript module imported by UI, not its own service. One lead controls dependency installs and lockfiles. Browser speech APIs first, optional provider only with lead approval. Chrome demo target; keyboard fallback mandatory.

| Module | Owner | Boundary |
|---|---|---|
| frontend/src/ui/ | frontend | UI, API calls, review form, student navigation and rendering |
| frontend/src/voice/ | voice | speech adapter and deterministic command interpreter |
| document_engine/ | document | PDF -> validated exam draft; no database or routes |
| backend/ | lead | routes, state, document integration, validation, persistence |
| contracts/, fixtures/, root scaffold | lead | interfaces and mock data |

## Sequence
Professor uploads PDF -> backend calls document_engine.extract_exam(pdf_bytes) -> draft (original wording and approved factual accessibility representation) -> professor reviews and corrects -> publish -> student starts session -> receives published content -> voice or keyboard selects question -> records literal answer -> reads back/edits -> explicit confirm saves -> explicit submit locks -> professor views submission. Student cannot access draft or answers of others through student UI; prototype has no production auth, so do not claim adversarial isolation.

Diagram engine returns nodes and components with terminal node IDs and visible values. Avoid inferred topology labels when identifying them is part of the assessment; student may ask for visible facts only. If extraction is uncertain, set needs_review true, include warnings and require manual resolution before publication. Student speech commands are explicit and separate from dictation. Pause recognition while TTS speaks and require explicit submission confirmation.

Math dictation uses a dedicated backend route. It sends only the expression transcript to the configured Groq model and returns optional notation for student review. Saving keeps the literal transcript and attaches notation after explicit confirmation. Diagram exploration and commands continue to use approved exam data and local rules.

Shared interfaces live in contracts/. API contract is authoritative; fixture intentionally lacks answers. All four agents can develop against fixture without waiting. No dependency changes without lead. Local setup uses Python 3.11+ and Node 20+ (22 recommended); implementation agents must coordinate versions. No production accessibility/security claims until tested with real users and approved infrastructure.
