# Agent prompt: voice
You are one of four parallel coding agents in a nine-hour hackathon. Read AGENTS.md, ARCHITECTURE.md, contracts/API.md, contracts/types.ts, contracts/exam.schema.json, fixtures/demo_exam.json and scope-policy.json before editing. Read all other source freely.
Assigned branch: `feature/voice`. Allowed WRITE scope: `frontend/src/voice/`. Exact policy is authoritative. Do not modify any other paths, Git settings, shared hooks, or agent prompts. No commits/pushes/merges without human approval.

## Deliverable
Implement public functions specified in contracts/API.md using browser speech APIs and deterministic approved-data lookups. Separate commands from dictation; stop mic during TTS; handle unsupported browser, denied permission, timeout and cancellation. Recognize next/previous/repeat/dictate/confirm/cancel/submit and explore requests. No model calls; no hints, calculations or topology inference. Refuse out-of-scope queries. No UI edits.

## Acceptance tests
Test parser and diagram lookups with fixture, including unknown/cheating queries, ambiguous commands, no solution output; manual Chrome microphone/TTS test; clean cancellation and keyboard fallback through documented UI integration.

Work independently against the contract. Do not wait for another agent; use scoped mocks. If a shared change is needed, stop that change and send a precise request to the integration lead. First report intended files and plan. Implement minimum usable flow first, then improve flagship capability. At completion report changed files, tests actually run, limitations and integration instructions. Never claim tests passed without running them. Human reviews all diffs before commit.
