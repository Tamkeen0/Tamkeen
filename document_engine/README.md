# Document AI

Run from the repository root with Python 3.11 or newer. The backend imports the extractor directly.

```python
from document_engine import extract_exam

draft = extract_exam(pdf_bytes)
```

The result is a schema-validated Exam with ID `draft` and status `draft`. The module reads the shared schema from `contracts/exam.schema.json` at runtime. The backend assigns the persistent ID and keeps the draft in the professor workflow until explicit approval. A malformed, encrypted or damaged PDF raises `ValueError`. An extraction that cannot produce a draft, such as an image-only scan or a missing parser dependency, raises `RuntimeError`.

## Backend integration

- Lead approval is needed to add `PyMuPDF` and `jsonschema` to the backend runtime dependency list. Tested with PyMuPDF 1.26.6 and jsonschema 4.26.0. Include `document_engine/` and `contracts/exam.schema.json` alongside the backend.
- Call `extract_exam` for the professor's PDF upload. Extraction is synchronous and may make an outbound request, so use a worker thread if the upload handler is asynchronous. Handle the two documented exception types and retain `warnings` and `needs_review` on partial drafts.
- Circuit extraction uses the OpenAI Chat Completions API. For an approved synthetic demo, set the existing server-side variables `AI_API_KEY` and `AI_MODEL` to an authorized key and a model supporting image inputs and JSON mode. The request sends the cropped PNG with visible labels. Local question text and option fields come from the PDF text layer.
- If the service is missing, fails, or returns unusable circuit data, the draft keeps the question wording and options and sets the affected diagram to `null` with a manual-entry warning. Every extracted circuit also requires professor verification. The professor must check the source PDF, resolve warnings, and approve before publishing. Student routes consume the approved data.
- The fixture in `fixtures/demo_exam.json` is synthetic mock data. The tests use it as an expected result and mock the provider. If the backend offers it as a demo fallback, label that mode visibly as mock data.

## Supported input

Use a single-column digital English PDF with numbered prompts such as `1. Prompt` or `Question 1: Prompt` and separately lettered options such as `A. Option`. The first line above the questions supplies the title. Compare additional introductory instructions with the PDF during review. The extractor joins wrapped lines and provides literal readings for basic equations. Complex notation and mathematical options need manual review. Scanned pages require manual conversion.

Circuit extraction covers one simple figure per question with visible node labels, resistors and voltage sources. It can crop embedded raster images and vector figures. Layout heuristics work best with the figure below its prompt and separate from options and other graphics. Unsupported or unclear figures require manual entry. Validation checks data shape, labels, values and terminal references. The professor compares those facts with the source.

## Tests

```sh
python -B -m unittest discover -s document_engine -v
```

The tests generate a synthetic PDF with real text, an equation and circuit artwork. They check text and option fidelity, the circuit crop, mocked provider values and connections, invalid PDF handling and unavailable provider behavior. Live model accuracy remains to be tested with the lead-approved provider and synthetic PDF.
