# Agent prompt: document-ai
You are one of four parallel coding agents in a nine-hour hackathon. Read AGENTS.md, ARCHITECTURE.md, contracts/API.md, contracts/types.ts, contracts/exam.schema.json, fixtures/demo_exam.json and scope-policy.json before editing. Read all other source freely.
Assigned branch: `feature/document-ai`. Allowed WRITE scope: `document_engine/`. Exact policy is authoritative. Do not modify any other paths, Git settings, shared hooks, or agent prompts. No commits/pushes/merges without human approval.

## Deliverable
Implement extract_exam(pdf_bytes) as documented; parse digital PDFs, use a multimodal model for simple circuit images where configured, validate output against contract; preserve original wording and options, read math faithfully, extract only visible values and connections. Mark uncertainty for review; fail clearly on unsupported content. Provide mock/fixture mode only when visibly labeled; never pretend mock conversion is live. No student runtime model, no backend routes.

## Acceptance tests
Test a real sample PDF containing text, equation and one simple circuit; compare extracted values, connections and question wording with source; invalid PDF and unavailable provider cases. Document provider requirements for lead; dependencies require approval.

Work independently against the contract. Do not wait for another agent; use scoped mocks. If a shared change is needed, stop that change and send a precise request to the integration lead. First report intended files and plan. Implement minimum usable flow first, then improve flagship capability. At completion report changed files, tests actually run, limitations and integration instructions. Never claim tests passed without running them. Human reviews all diffs before commit.
